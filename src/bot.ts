import { Client, ClientUser, Guild, GatewayIntentBits, Options, TextBasedChannel, User, TextChannel, ActivityType, Snowflake } from 'discord.js';
import { getRSNFormat } from 'osrs-json-hiscores';
import { PlayerHiScores, TimeoutType } from './types';
import { sendUpdateMessage, getQuantityWithUnits, getThumbnail, getNextFridayEvening, updatePlayer, sanitizeRSN } from './util';
import { TimeoutManager, PastTimeoutStrategy, randInt, getDurationString, sleep, MultiLoggerLevel, naturalJoin, chance } from 'evanw555.js';
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
    let text = `ScapeBot online after **${getDurationString(downtimeMillis)}** of downtime. `
        + `In **${client.guilds.cache.size}** guild(s) tracking **${state.getNumGloballyTrackedPlayers()}** player(s) (**${state.getNumActivePlayers()}** active).`;
    // Add refresh duration info
    text += `\nℹ️ Current refresh durations: ${state.getRefreshDurationString()}.`;
    // TODO: Temp logging while we're still populating display names into PG
    if (state.getNumPlayerDisplayNames() < state.getNumGloballyTrackedPlayers()) {
        const displayNamesRemaining = state.getNumGloballyTrackedPlayers() - state.getNumPlayerDisplayNames();
        text += `\nℹ️ Loaded **${state.getNumPlayerDisplayNames()}** display names from PG, need to populate **${displayNamesRemaining}** more.`;
    }
    // TODO: Temp logic to log how many RSNs are unsanitized
    const numUnsanitizedRSNs = state.getAllGloballyTrackedPlayers().filter(rsn => rsn !== sanitizeRSN(rsn)).length;
    if (numUnsanitizedRSNs > 0) {
        text += `\nℹ️ There are still **${numUnsanitizedRSNs}** unsanitized RSNs!`;
    }
    // Add timeout manager info
    if (timeoutManager.toStrings().length > 0) {
        text += '\nℹ️ **Timeouts scheduled:**\n' + timeoutManager.toStrings().join('\n');
    }
    await logger.log(text, MultiLoggerLevel.Fatal);
    await logger.log(client.guilds.cache.toJSON().map((guild, i) => {
        return `**${i + 1}.** _${guild.name}_ with **${state.getAllTrackedPlayers(guild.id).length}**`
            + (state.hasTrackingChannel(guild.id) ? ` in \`#${state.getTrackingChannel(guild.id).name}\`` : '')
            + (state.hasPrivilegedRole(guild.id) ? ` with role \`${state.getPrivilegedRole(guild.id).name}\`` : '');
    }).join('\n'), MultiLoggerLevel.Warn);
    // TODO: Use this if you need to troubleshoot...
    // await logger.log(state.toDebugString());
}

const getGuildName = (guildId: Snowflake): string => {
    // This function is overly cautious, perhaps unreasonably so...
    try {
        return client.guilds.cache.get(guildId)?.name ?? guildId;
    } catch (err) {
        return guildId;
    }
};

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

    const playerActivityTimestamps = await pgStorageClient.fetchAllPlayerActivityTimestamps();
    for (const [ rsn, timestamp ] of Object.entries(playerActivityTimestamps)) {
        state.markPlayerAsActive(rsn, timestamp);
    }

    const playerDisplayNames = await pgStorageClient.fetchAllPlayerDisplayNames();
    for (const [ rsn, displayName ] of Object.entries(playerDisplayNames)) {
        state.setDisplayName(rsn, displayName);
    }

    const trackingChannels = await pgStorageClient.fetchAllTrackingChannels();
    for (const [ guildId, trackingChannelId ] of Object.entries(trackingChannels)) {
        try {
            const trackingChannel = await client.channels.fetch(trackingChannelId);
            if (trackingChannel instanceof TextChannel) {
                state.setTrackingChannel(guildId, trackingChannel);
            } else {
                await logger.log(`Could not fetch tracking channel \`${trackingChannelId}\` for guild \`${guildId}\`: expected _TextChannel_ but found \`${trackingChannel}\``, MultiLoggerLevel.Error);
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
    const winnerLogs = [];
    for (const guildId of state.getAllRelevantGuilds()) {
        if (state.hasTrackingChannel(guildId)) {
            try {
                // Get the top 3 XP earners for this guild
                const winners: string[] = sortedPlayers.filter(rsn => state.isTrackingPlayer(guildId, rsn)).slice(0, 3);

                // Only send out a message if there are any XP earners
                if (winners.length !== 0) {
                    // TODO: Temp logic for logging
                    winnerLogs.push(`_${getGuildName(guildId)}_: ` + naturalJoin(winners.map(rsn => `**${rsn}** (${getQuantityWithUnits(totalXpDiffs[rsn])})`), { conjunction: '&' }));

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
                } else {
                    // TODO: Temp logic for logging
                    winnerLogs.push(`~~_${getGuildName(guildId)}_~~`);
                }
            } catch (err) {
                await logger.log(`Failed to compute and send weekly XP info for guild \`${guildId}\`: \`${err}\``, MultiLoggerLevel.Error);
            }
        }
    }

    // Commit the changes
    try {
        await pgStorageClient.writeWeeklyXpSnapshots(newTotalXpValues);
    } catch (err) {
        await logger.log(`Unable to write weekly XP snapshots to PG: \`${err}\``, MultiLoggerLevel.Error);
    }

    // TODO: Temp logging to see how this is working
    await logger.log(winnerLogs.join('\n'), MultiLoggerLevel.Warn);

    // Log all the data used to compute these values
    // TODO: Not needed for now, re-enable?
    // await logger.log(`Old Total XP:\n\`\`\`${JSON.stringify(oldTotalXpValues, null, 2)}\`\`\``, MultiLoggerLevel.Warn);
    // await logger.log(`New Total XP:\n\`\`\`${JSON.stringify(newTotalXpValues, null, 2)}\`\`\``, MultiLoggerLevel.Warn);
    // await logger.log(`Total XP Diff:\n\`\`\`${JSON.stringify(totalXpDiffs, null, 2)}\`\`\``, MultiLoggerLevel.Warn);
};

client.on('ready', async () => {
    // (when not testing...) Add one logger just for logging to terminal
    logger.addOutput(async (text: string) => {
        console.log(text);
    }, MultiLoggerLevel.Info);

    try {
        logger.log(`Logged in as: ${client.user?.tag}`);
        logger.log(`Config=${JSON.stringify(CONFIG)}`);

        // Read the maintainer user IDs
        if (AUTH.maintainerUserIds) {
            for (const maintainerUserId of AUTH.maintainerUserIds) {
                state.addMaintainerId(maintainerUserId);
            }
        } else {
            await logger.log('No maintainer user IDs were specified in auth.json!', MultiLoggerLevel.Warn);
        }

        // Set up channel loggers
        if (AUTH.channelLoggers) {
            for (const channelLoggerConfig of AUTH.channelLoggers) {
                let channelLogger: TextBasedChannel | undefined = undefined;
                try {
                    if (channelLoggerConfig.dm) {
                        // Set up this channel logger via DM
                        const loggerUser: User = await client.users.fetch(channelLoggerConfig.id);
                        channelLogger = await loggerUser.createDM();
                    } else {
                        // Set up this channel logger via a guild TextChannel
                        const fetchedChannel = await client.channels.fetch(channelLoggerConfig.id);
                        if (fetchedChannel instanceof TextChannel) {
                            channelLogger = fetchedChannel;
                        } else {
                            throw new Error(`ID \`${channelLoggerConfig.id}\` does not refer to a TextChannel`);
                        }
                    }
                } catch (err) {
                    await logger.log(`Unable to set up channel logger with config \`${JSON.stringify(channelLoggerConfig)}\`: \`${err}\``);
                }
                // If a channel was properly fetched, add the logger
                if (channelLogger) {
                    const channelLoggerToUse = channelLogger;
                    logger.addOutput(async (text: string) => {
                        await channelLoggerToUse.send(text);
                    }, channelLoggerConfig.level);
                }
            }
        } else {
            await logger.log('No channel loggers were specified in auth.json!', MultiLoggerLevel.Warn);
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
            const globalCommands = commandHandler.buildCommands();
            // Send built commands in request to Discord to set global commands
            const results = await client.application.commands.set(globalCommands);
            await logger.log(`Refreshed ${results.size} application (/) commands`, MultiLoggerLevel.Warn);
        }

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
                try {
                    await updatePlayer(nextPlayer);
                    await pgStorageClient.writeMiscProperty('timestamp', new Date().toJSON());
                } catch (err) {
                    // Emergency fallback in case of unhandled errors
                    await logger.log(`Unhandled error while updating **${nextPlayer}**: \`${err}\``, MultiLoggerLevel.Error);
                }
                // TODO: Temp logic to populate display name data (odds of repopulating are proportional to percentage of names populated)
                if (!state.hasDisplayName(nextPlayer)) {
                    try {
                        const displayName = await getRSNFormat(nextPlayer);
                        state.setDisplayName(nextPlayer, displayName);
                        await pgStorageClient.writePlayerDisplayName(nextPlayer, displayName);
                        await logger.log(`(Loop) Fetched display name for **${nextPlayer}** as **${displayName}** (**${state.getNumPlayerDisplayNames()}**/**${state.getNumGloballyTrackedPlayers()}** complete)`, MultiLoggerLevel.Warn);
                    } catch (err) {
                        await logger.log(`(Loop) Failed to fetch display name for **${nextPlayer}**: \`${err}\``, MultiLoggerLevel.Info);
                    }
                }
            } else {
                // No players being tracked
            }
        }
    }, CONFIG.refreshInterval);

    // Set a timeout interval for updating the bot user activity
    // TODO: should this use the timeout manager?
    setInterval(() => {
        if (client.user) {
            if (state.isDisabled()) {
                client.user.setPresence({
                    status: 'dnd',
                    activities: [{
                        name: '🔧 Undergoing maintenance...',
                    }]
                });
            } else {
                const numTracked = state.getNumGloballyTrackedPlayers();
                client.user.setPresence({
                    status: 'online',
                    activities: [{
                        name: `${numTracked} player${numTracked === 1 ? '' : 's'} grind`,
                        type: ActivityType.Watching
                    }]
                });
            }
        }
    }, CONFIG.presenceUpdateInterval);
});

client.on('guildCreate', async (guild) => {
    const systemChannel = guild.systemChannel;
    if (systemChannel) {
        // Apparently, the bot can still lack message sending permissions to the system channel even if it's populated here
        try {
            await systemChannel.send(`Thanks for adding ${client.user} to your server! Admins: to get started, please use **/channel**`
                + ' in the text channel that should receive player updates and **/help** for a list of useful commands.');
        } catch (err) {
            await logger.log(`Failed to send welcome message to system channel of guild _${guild.name}_: \`${err}\``, MultiLoggerLevel.Error);
            // TODO: Can we default to a DM to the guild's owner?
        }
    } else {
        // Can this even happen?
        await logger.log(`There is no system channel defined for guild ${guild.id}`, MultiLoggerLevel.Warn);
    }
    // TODO: Reduce this back down to debug once we see how this plays out
    await logger.log(`Bot has been added to guild _${guild.name}_, now in **${client.guilds.cache.size}** guilds`, MultiLoggerLevel.Error);
});

client.on('guildDelete', async (guild) => {
    // TODO: Reduce this back down to debug once we see how this plays out
    await logger.log(`Bot has been removed from guild _${guild.name}_, now in **${client.guilds.cache.size}** guilds`, MultiLoggerLevel.Error);
    try {
        // Purge all data related to this guild from PG and from the state
        const purgeGuildResult = await pgStorageClient.purgeGuildData(guild.id);
        state.clearAllTrackedPlayers(guild.id);
        state.clearTrackingChannel(guild.id);
        state.clearPrivilegedRole(guild.id);
        // Now that some players may be globally untracked, run the player purging procedure
        const purgePlayersResult = await pgStorageClient.purgeUntrackedPlayerData();
        await logger.log(`Purged guild rows: \`${JSON.stringify(purgeGuildResult)}\`\nPurged player rows: \`${JSON.stringify(purgePlayersResult)}\``, MultiLoggerLevel.Warn);
    } catch (err) {
        await logger.log(`Failed to purge \`${guild.id}\` guild data from state/PG: \`${err}\``, MultiLoggerLevel.Error);
    }
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
        } else if (state.isMaintainer(msg.author.id)) {
            // Else, process the command as normal
            commandReader.read(msg);
        }
    }
});

client.on('interactionCreate', (interaction) =>
    commandHandler.handleChatInputCommand(interaction));

client.on('interactionCreate', (interaction) =>
    commandHandler.handleAutocomplete(interaction));

// Login!!!
client.login(AUTH.token);
