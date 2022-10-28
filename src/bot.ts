import { Client, ClientUser, Guild, GatewayIntentBits, Options, TextBasedChannel, User } from 'discord.js';
import { PlayerHiScores, TimeoutType } from './types';
import { sendUpdateMessage, getQuantityWithUnits, getThumbnail, getNextFridayEvening, updatePlayer, guildCommandRolePermissionsManager } from './util';
import { TimeoutManager, PastTimeoutStrategy, randInt, getDurationString, sleep, MultiLoggerLevel } from 'evanw555.js';
import CommandReader from './command-reader';
import CommandHandler from './command-handler';
import commands from './commands';
import { fetchHiScores } from './hiscores';
import TimeoutStorage from './timeout-storage';

import { AUTH, CONFIG, TIMEOUTS_PROPERTY } from './constants';

import state from './instances/state';
import logger from './instances/logger';
import pgStorageClient from './instances/pg-storage-client';

// TODO: Deprecate CommandReader in favor of CommandHandler
const commandReader: CommandReader = new CommandReader();
const commandHandler: CommandHandler = new CommandHandler(commands);

export async function sendRestartMessage(downtimeMillis: number): Promise<void> {
    const text = `ScapeBot online after **${getDurationString(downtimeMillis)}** of downtime. In **${client.guilds.cache.size}** guild(s).\n`;
    await logger.log(text + timeoutManager.toStrings().join('\n') || '_none._', MultiLoggerLevel.Warn);
    await logger.log(client.guilds.cache.toJSON().map((guild, i) => `**${i + 1}.** _${guild.name}_ with **${state.getAllTrackedPlayers(guild.id).length}** in ${state.hasTrackingChannel(guild.id) ? state.getTrackingChannel(guild.id) : 'N/A'}`).join('\n'), MultiLoggerLevel.Warn);
    // TODO: Use this if you need to troubleshoot...
    // await logger.log(state.toDebugString());
}

const timeoutCallbacks = {
    [TimeoutType.WeeklyXpUpdate]: async (): Promise<void> => {
        await timeoutManager.registerTimeout(TimeoutType.WeeklyXpUpdate, getNextFridayEvening(), { pastStrategy: PastTimeoutStrategy.Invoke });
        await weeklyTotalXpUpdate();
    }
};
const timeoutManager = new TimeoutManager<TimeoutType>(new TimeoutStorage(), timeoutCallbacks, { fileName: TIMEOUTS_PROPERTY });

const loadState = async (): Promise<void> => {
    // TODO: Eventually, the whole "deserialize" thing won't be needed. We'll just need one method for loading up all stuff from PG on startup
    const trackedPlayers = await pgStorageClient.fetchAllTrackedPlayers();
    for (const [ guildId, players ] of Object.entries(trackedPlayers)) {
        for (const rsn of players) {
            state.addTrackedPlayer(guildId, rsn);
        }
    }
    const trackingChannels = await pgStorageClient.fetchAllTrackingChannels();
    for (const [ guildId, trackingChannelId ] of Object.entries(trackingChannels)) {
        try {
            const trackingChannel = (await client.channels.fetch(trackingChannelId) as TextBasedChannel);
            if (trackingChannel) {
                state.setTrackingChannel(guildId, trackingChannel);
            }
        } catch (err) {
            if (err instanceof Error) {
                // TODO: Handle cleanup if DiscordApiError[50001]: Missing Access; once 'guildDelete'
                // event handler is set up, this should only happen if the bot is kicked while the
                // bot client is down.
                logger.log(`Failed to set tracking channel for guild ${guildId} due to: ${err.toString()}`, MultiLoggerLevel.Error);
            }
        }
    }
    const playersOffHiScores: string[] = await pgStorageClient.fetchAllPlayersWithHiScoreStatus(false);
    const privilegedRoles = await pgStorageClient.fetchAllPrivilegedRoles();
    for (const [ guildId, roleId ] of Object.entries(privilegedRoles)) {
        try {
            // Initial guild fetch happens in 'ready' event handler before loadState is invoked
            const guild = client.guilds.cache.find(g => g.id === guildId);
            if (!guild) {
                logger.log(`Bot is not connected to guildId '${guildId} for privileged role '${roleId}'`);
                break;
            }
            const privilegedRole = guild.roles.cache.find(r => r.id === roleId);
            if (privilegedRole) {
                state.setPrivilegedRole(guildId, privilegedRole);
            }
        } catch (err) {
            if (err instanceof Error) {
                // TODO: Handle cleanup if DiscordApiError[50001]: Missing Access; once 'guildDelete'
                // event handler is set up, this should only happen if the bot is kicked while the
                // bot client is down.
                logger.log(`Failed to set privileged role for guild ${guildId} due to: ${err.toString()}`, MultiLoggerLevel.Error);
            }
        }
    }
    for (const rsn of playersOffHiScores) {
        state.removePlayerFromHiScores(rsn);
    }
    state.setAllLevels(await pgStorageClient.fetchAllPlayerLevels());
    state.setAllBosses(await pgStorageClient.fetchAllPlayerBosses());
    state.setAllClues(await pgStorageClient.fetchAllPlayerClues());
    state.setBotCounters(await pgStorageClient.fetchBotCounters());
    state.setDisabled((await pgStorageClient.fetchMiscProperty('disabled') ?? 'false') === 'true');
    state.setTimestamp(new Date(await pgStorageClient.fetchMiscProperty('timestamp') ?? new Date()));

    // Now that the state has been loaded, mark it as valid
    state.setValid(true);
};

// Initialize Discord Bot
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages
    ],
    makeCache: Options.cacheWithLimits({
        MessageManager: {
            maxSize: 10
        }
    })
});

const weeklyTotalXpUpdate = async () => {
    // Abort is disabled
    if (state.isDisabled()) {
        return;
    }
    // Get old total XP values
    let oldTotalXpValues: Record<string, number> | undefined;
    try {
        oldTotalXpValues = await pgStorageClient.fetchWeeklyXpSnapshots();
    } catch (err) {
        await logger.log(`Unable to fetch weekly XP snapshots from PG: \`${err}\``, MultiLoggerLevel.Error);
        return;
    }

    // Get new total XP values
    const newTotalXpValues: Record<string, number> = {};
    for (const rsn of state.getAllGloballyTrackedPlayers()) {
        try {
            const data: PlayerHiScores = await fetchHiScores(rsn);
            const totalXp: number = data.totalXp ?? 0;
            // Use some arbitrary threshold like 10xp to ensure inactive users aren't included
            if (totalXp > 10) {
                newTotalXpValues[rsn] = totalXp;
            }
        } catch (err) {
            // TODO: Log error?
            continue;
        }
    }

    // For each player appearing in both last week's and this week's mapping, determine the change in total XP
    const playersToCompare: string[] = Object.keys(oldTotalXpValues).filter(rsn => rsn in newTotalXpValues);
    const totalXpDiffs: Record<string, number> = {};
    for (const rsn of playersToCompare) {
        totalXpDiffs[rsn] = newTotalXpValues[rsn] - oldTotalXpValues[rsn];
    }

    // For each player with a non-zero diff, sort descending
    const sortedPlayers: string[] = playersToCompare
        .filter(rsn => totalXpDiffs[rsn] > 0)
        .sort((x, y) => totalXpDiffs[y] - totalXpDiffs[x]);

    // Compute the winners and send out an update for each guild
    for (const guildId of state.getAllRelevantGuilds()) {
        if (state.hasTrackingChannel(guildId)) {
            // Get the top 3 XP earners for this guild
            const winners: string[] = sortedPlayers.filter(rsn => state.isTrackingPlayer(guildId, rsn)).slice(0, 3);

            // Send the message to the tracking channel
            const medalNames = ['gold', 'silver', 'bronze'];
            await state.getTrackingChannel(guildId).send({
                content: '**Biggest XP earners over the last week:**',
                embeds: winners.map((rsn, i) => {
                    return {
                        description: `**${rsn}** with **${getQuantityWithUnits(totalXpDiffs[rsn])} XP**`,
                        thumbnail: getThumbnail(medalNames[i])
                    };
                })
            });
        }
    }

    // Commit the changes
    try {
        await pgStorageClient.writeWeeklyXpSnapshots(newTotalXpValues);
    } catch (err) {
        await logger.log(`Unable to write weekly XP snapshots to PG: \`${err}\``, MultiLoggerLevel.Error);
    }

    // Log all the data used to compute these values
    await logger.log(`Old Total XP:\n\`\`\`${JSON.stringify(oldTotalXpValues, null, 2)}\`\`\``, MultiLoggerLevel.Warn);
    await logger.log(`New Total XP:\n\`\`\`${JSON.stringify(newTotalXpValues, null, 2)}\`\`\``, MultiLoggerLevel.Warn);
    await logger.log(`Total XP Diff:\n\`\`\`${JSON.stringify(totalXpDiffs, null, 2)}\`\`\``, MultiLoggerLevel.Warn);
};

client.on('ready', async () => {
    // (when not testing...) Add one logger just for logging to terminal
    logger.addOutput(async (text: string) => {
        console.log(text);
    }, MultiLoggerLevel.Info);

    try {
        logger.log(`Logged in as: ${client.user?.tag}`);
        logger.log(`Config=${JSON.stringify(CONFIG)}`);

        // Determine the admin user and the admin user's DM channel
        if (AUTH.adminUserId) {
            const admin: User = await client.users.fetch(AUTH.adminUserId);
            if (admin) {
                state.setAdminId(admin.id);
                const adminDmChannel: TextBasedChannel = await admin.createDM();
                logger.log(`Determined admin user: ${admin.username}`);
                // The admin DM channel should only be used for WARN and above logs
                logger.addOutput(async (text: string) => {
                    await adminDmChannel.send(text);
                }, MultiLoggerLevel.Warn);
            } else {
                await logger.log('Could not fetch the admin user!', MultiLoggerLevel.Error);
            }
        } else {
            await logger.log('No admin user ID was specified in auth.json!', MultiLoggerLevel.Error);
        }

        // Fetch guilds to load them into the cache
        await client.guilds.fetch();

        // Attempt to initialize the PG client
        await pgStorageClient.connect();
        await logger.log(`PG storage client connected: \`${pgStorageClient.toString()}\``);

        // Ensure all necessary tables exist, initialize those that don't
        await pgStorageClient.initializeTables();

        // Deserialize it and load it into the state object
        await loadState();
        let downtimeMillis = 0;
        if (state.hasTimestamp()) {
            downtimeMillis = new Date().getTime() - state.getTimestamp().getTime();
        }

        // Log how many guilds are missing tracking channels
        const guildsWithoutTrackingChannels: Guild[] = client.guilds.cache.toJSON()
            .filter(guild => !state.hasTrackingChannel(guild.id));
        if (guildsWithoutTrackingChannels.length > 0) {
            await logger.log(`This bot is in **${client.guilds.cache.size}** guilds, but a tracking channel is missing for **${guildsWithoutTrackingChannels.length}** of them`, MultiLoggerLevel.Warn);
        }

        // Load the existing timeouts from storage (this must happen after the PG client connects, since it leverages PG for storage)
        await timeoutManager.loadTimeouts();
        // Start the weekly loop if the right timeout isn't already scheduled (get next Friday at 5:10pm)
        if (!timeoutManager.hasTimeout(TimeoutType.WeeklyXpUpdate)) {
            await timeoutManager.registerTimeout(TimeoutType.WeeklyXpUpdate, getNextFridayEvening(), { pastStrategy: PastTimeoutStrategy.Invoke });
        }

        // Register global slash commands on startup
        if (client.application) {
            // Builds the command using static command data and SlashCommandBuilder
            const globalCommands = commandHandler.buildGlobalCommands();
            // Send built commands in request to Discord to set global commands
            const results = await client.application.commands.set(globalCommands);
            await logger.log(`Refreshed ${results.size} application (/) commands`);
        }

        // Register guild slash command on startup, first build the commands
        const guildCommands = commandHandler.buildGuildCommands();
        // For each guild, set the guild commands and permissions if necessary
        const results = await Promise.all(client.guilds.cache.map(async (guild) => {
            // Send built commands in request to Discord to set guild commands
            const results = await guild.commands.set(guildCommands);
            // If a privileged role exists, call the command permissions update endpoint
            if (state.hasPrivilegedRole(guild.id)) {
                await guildCommandRolePermissionsManager.update(guild);
            }
            return results;
        }));
        await logger.log(`Refreshed ${guildCommands.length} guild (/) commands for ${results.length} guilds`);

        // Notify the admin that the bot has restarted
        sendRestartMessage(downtimeMillis);
    } catch (err) {
        await logger.log(`Failed to boot:\n\`\`\`\n${(err as Error).stack}\n\`\`\`\nThe process will exit in 30 seconds...`, MultiLoggerLevel.Fatal);
        await sleep(30000);
        process.exit(1);
    }

    // Regardless of whether loading the players/channel was successful, start the update loop
    // TODO: Use timeout manager
    setInterval(async () => {
        if (!state.isDisabled()) {
            const nextPlayer = state.nextTrackedPlayer();
            if (nextPlayer) {
                await updatePlayer(nextPlayer);
                await pgStorageClient.writeMiscProperty('timestamp', new Date().toJSON());
            } else {
                // No players being tracked
            }
        }
    }, CONFIG.refreshInterval);
});

client.on('guildCreate', async (guild) => {
    try {
        const results = await guild.commands.set(commandHandler.buildGuildCommands());
        if (state.hasPrivilegedRole(guild.id)) {
            await guildCommandRolePermissionsManager.update(guild);
        }
        await logger.log(`Registered ${results.size} (/) commands for guild '${guild.id}'`, MultiLoggerLevel.Debug);

        const systemChannel = guild.systemChannel;
        if (systemChannel) {
            systemChannel.send(`Thanks for adding ${client.user} to your server! Use **/track** to start tracking `
                + 'scapers, and **/help** for a list of useful commands.');
        } else {
            // Can this even happen?
            logger.log(`There is no system channel defined for guild ${guild.id}`, MultiLoggerLevel.Warn);
        }
    } catch (err) {
        if (err instanceof Error) {
            logger.log(`Failed to handle guildCreate event due to: ${err.toString()}`, MultiLoggerLevel.Error);
        }
    }
});

client.on('guildDelete', (guild) => {
    logger.log(`Bot has been removed from guild ${guild.id}`, MultiLoggerLevel.Debug);
});

client.on('messageCreate', async (msg) => {
    // Only process messages from other users mentions
    if (msg.mentions.has(client.user as ClientUser) && msg.author.id !== client.user?.id) {
        // If the message was sent by another bot, troll epic style 😈
        if (msg.author.bot) {
            state.incrementBotCounter(msg.author.id);
            await pgStorageClient.writeBotCounter(msg.author.id, state.getBotCounter(msg.author.id));
            // Wait up to 1.5 seconds before sending the message to make it feel more organic
            setTimeout(() => {
                const replyText = `**<@${msg.author.id}>** has gained a level in **botting** and is now level **${state.getBotCounter(msg.author.id)}**`;
                sendUpdateMessage([msg.channel], replyText, 'overall');
            }, randInt(0, 1500));
            return;
        }
        // Else, process the command as normal
        commandReader.read(msg);
    }
});

client.on('interactionCreate', (interaction) =>
    commandHandler.handleChatInputCommand(interaction));

client.on('interactionCreate', (interaction) =>
    commandHandler.handleAutocomplete(interaction));

// Login!!!
client.login(AUTH.token);
