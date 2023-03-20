import { Client, ClientUser, Guild, GatewayIntentBits, Options, TextBasedChannel, User, TextChannel, ActivityType, Snowflake, PermissionFlagsBits } from 'discord.js';
import { PlayerHiScores, TimeoutType } from './types';
import { sendUpdateMessage, getQuantityWithUnits, getThumbnail, getNextFridayEvening, updatePlayer, sanitizeRSN, sendDMToGuildOwner, botHasRequiredPermissionsInChannel, getNextEvening, getMissingRequiredChannelPermissionNames } from './util';
import { TimeoutManager, PastTimeoutStrategy, randInt, getDurationString, sleep, MultiLoggerLevel, naturalJoin } from 'evanw555.js';
import CommandReader from './command-reader';
import CommandHandler from './command-handler';
import commands from './commands';
import { fetchHiScores } from './hiscores';
import TimeoutStorage from './timeout-storage';

import { AUTH, CONFIG, TIMEOUTS_PROPERTY } from './constants';

import state from './instances/state';
import logger from './instances/logger';
import pgStorageClient from './instances/pg-storage-client';
import timeSlotInstance from './instances/timeslot';

// TODO: Deprecate CommandReader in favor of CommandHandler
const commandReader: CommandReader = new CommandReader();
const commandHandler: CommandHandler = new CommandHandler(commands);

export async function sendRestartMessage(downtimeMillis: number): Promise<void> {
    let text = `ScapeBot online after **${getDurationString(downtimeMillis)}** of downtime. `
        + `In **${client.guilds.cache.size}** guild(s) tracking **${state.getNumGloballyTrackedPlayers()}** player(s) (${state.getPlayerQueueDebugString()}).`;
    // Add refresh duration info
    text += `\nℹ️ Current refresh durations: ${state.getRefreshDurationString()}.`;
    // TODO: Temp logging while we're still populating display names into PG
    if (state.getNumPlayerDisplayNames() < state.getNumGloballyTrackedPlayers()) {
        const displayNamesRemaining = state.getNumGloballyTrackedPlayers() - state.getNumPlayerDisplayNames();
        text += `\nℹ️ Loaded **${state.getNumPlayerDisplayNames()}** display names from PG, need to populate **${displayNamesRemaining}** more.`;
    }
    // TODO: Temp logic to log how many players are off the hiscores
    text += `\nℹ️ **${state.getNumPlayersOffHiScores()}** players are off the hiscores (**${Math.floor(100 * state.getNumPlayersOffHiScores() / state.getNumGloballyTrackedPlayers())}%**)`;
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
    // Log all guilds with basic info (sorted by num players tracked)
    const sortedGuilds = client.guilds.cache.toJSON().sort((x, y) => state.getNumTrackedPlayers(y.id) - state.getNumTrackedPlayers(x.id));
    await logger.log(sortedGuilds.map((guild, i) => {
        return `**${i + 1}.** _${guild.name}_ with **${state.getNumTrackedPlayers(guild.id)}**`
            + (state.hasTrackingChannel(guild.id) ? ` in \`#${state.getTrackingChannel(guild.id).name}\`` : '')
            + (state.hasPrivilegedRole(guild.id) ? ` with role \`${state.getPrivilegedRole(guild.id).name}\`` : '');
    }).join('\n'), MultiLoggerLevel.Info);
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
    [TimeoutType.DailyAudit]: async (): Promise<void> => {
        await timeoutManager.registerTimeout(TimeoutType.DailyAudit, getNextEvening(), { pastStrategy: PastTimeoutStrategy.Invoke });
        await auditGuilds();
        // TODO: Temp logic to do time slot analysis
        timeSlotInstance.incrementDay();
        await logger.log(timeSlotInstance.getOverallDebugString(), MultiLoggerLevel.Warn);
        await logger.log(timeSlotInstance.getConsistencyAnalysisString(), MultiLoggerLevel.Warn);
    },
    [TimeoutType.WeeklyXpUpdate]: async (): Promise<void> => {
        await timeoutManager.registerTimeout(TimeoutType.WeeklyXpUpdate, getNextFridayEvening(), { pastStrategy: PastTimeoutStrategy.Invoke });
        await weeklyTotalXpUpdate();
    }
};
const timeoutManager = new TimeoutManager<TimeoutType>(new TimeoutStorage(), timeoutCallbacks, {
    fileName: TIMEOUTS_PROPERTY,
    onError: async (id: string, type: TimeoutType, err) => {
        await logger.log(`Fatal error in timeout \`${id}\` with type \`${type}\`: \`${err}\``, MultiLoggerLevel.Fatal);
    }
});

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
                await logger.log(`Failed to set tracking channel for guild ${guildId} due to: ${err.toString()}`, MultiLoggerLevel.Error);
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
                await logger.log(`Bot is not connected to guildId '${guildId} for privileged role '${roleId}'`);
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
                await logger.log(`Failed to set privileged role for guild ${guildId} due to: ${err.toString()}`, MultiLoggerLevel.Error);
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

const auditGuilds = async () => {
    // First, load up the audit notification counters for each guild
    const auditCounters: Record<Snowflake, number> = JSON.parse(await pgStorageClient.fetchMiscProperty('auditCounters') ?? '{}');

    const logStatements: string[] = [];

    // TODO: We're just logging for now, but we should actually warn the guild owners once we're sure this works
    for (const guild of client.guilds.cache.toJSON()) {
        let guildOk = true;
        // Only audit guilds that are tracking at least one player
        const numTrackedPlayers = state.getNumTrackedPlayers(guild.id);
        if (numTrackedPlayers > 0) {
            try {
                if (state.hasTrackingChannel(guild.id)) {
                    const trackingChannel = state.getTrackingChannel(guild.id);
                    // Validate the bot's permissions in this channel
                    if (!botHasRequiredPermissionsInChannel(trackingChannel)) {
                        // Increment the audit counter for this guild
                        guildOk = false;
                        auditCounters[guild.id] = (auditCounters[guild.id] ?? 0) + 1;
                        const sendToSystemChannel = auditCounters[guild.id] % 7 === 0;
                        // Send notification
                        const missingPermissionNames = getMissingRequiredChannelPermissionNames(trackingChannel);
                        const joinedPermissions = naturalJoin(missingPermissionNames, { bold: true });
                        if (sendToSystemChannel && guild.systemChannel) {
                            await guild.systemChannel.send('Hello - I am missing the required permissions to send OSRS update messages to the '
                                + `tracking channel ${trackingChannel}. Please grant me the following: ${joinedPermissions}`);
                            logStatements.push(`_${guild.name}_ is tracking **${numTrackedPlayers}** players but is missing tracking channel permission(s) ${joinedPermissions} (sent to system channel)`);
                        } else {
                            await sendDMToGuildOwner(guild, 'Hello - I am missing the required permissions to send OSRS update messages to the '
                                + `tracking channel ${trackingChannel} in your guild _${guild}_. Please grant me the following: ${joinedPermissions}`);
                            logStatements.push(`_${guild.name}_ is tracking **${numTrackedPlayers}** players but is missing tracking channel permission(s) ${joinedPermissions} (DM sent)`);
                        }
                    }
                } else {
                    // Increment the audit counter for this guild
                    guildOk = false;
                    auditCounters[guild.id] = (auditCounters[guild.id] ?? 0) + 1;
                    const sendToSystemChannel = auditCounters[guild.id] % 7 === 0;
                    // Send notification
                    if (sendToSystemChannel && guild.systemChannel) {
                        await guild.systemChannel.send('Hello - I\'m tracking OSRS players, yet you haven\'t selected a channel for me to send update messages. '
                            + 'Please select a channel in your guild using the **/channel** command!');
                        logStatements.push(`_${guild.name}_ is tracking **${numTrackedPlayers}** players but has no tracking channel set (sent to system channel)`);
                    } else {
                        await sendDMToGuildOwner(guild, `Hello - I'm tracking OSRS players in your guild _${guild}_, yet you haven't selected a channel for me to send update messages. `
                            + 'Please select a channel in your guild using the **/channel** command!');
                        logStatements.push(`_${guild.name}_ is tracking **${numTrackedPlayers}** players but has no tracking channel set (DM sent)`);
                    }
                }
            } catch (err) {
                logStatements.push(`Failure in _${guild.name}_: \`${err}\``);
            }
        }
        // If the guild passed audit, delete it from the audit counters map
        if (guildOk) {
            delete auditCounters[guild.id];
        }
    }

    // Log the findings
    if (logStatements.length > 0) {
        await logger.log('**Audited guilds:**\n' + logStatements.map((x, i) => `**${i + 1}.** ${x}`).join('\n'), MultiLoggerLevel.Error);
    }

    // Write the updated counters back to PG
    if (Object.keys(auditCounters).length > 0) {
        await pgStorageClient.writeMiscProperty('auditCounters', JSON.stringify(auditCounters));
        // TODO: Temp logging to see how this works
        await logger.log(`Dumped audit counters as \`${JSON.stringify(auditCounters).slice(0, 1600)}\``);
    }
};

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
                    winnerLogs.push(`_${getGuildName(guildId)}_: ` + naturalJoin(winners.map(rsn => `**${state.getDisplayName(rsn)}** (${getQuantityWithUnits(totalXpDiffs[rsn])})`), { conjunction: '&' }));

                    // Send the message to the tracking channel
                    const medalNames = ['gold', 'silver', 'bronze'];
                    await state.getTrackingChannel(guildId).send({
                        content: '**Biggest XP earners over the last week:**',
                        embeds: winners.map((rsn, i) => {
                            return {
                                description: `**${state.getDisplayName(rsn)}** with **${getQuantityWithUnits(totalXpDiffs[rsn])} XP**`,
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

    // Compute the grand winner and notify guilds tracking that player
    // TODO: Remove try-catch once we've seen this play out
    try {
        if (sortedPlayers.length > 0) {
            const grandWinnerRsn: string = sortedPlayers[0];
            const grandChannels = state.getTrackingChannelsForPlayer(grandWinnerRsn);
            const grandText = `Congrats! **${state.getDisplayName(grandWinnerRsn)}** earned the most XP of all the **${state.getNumGloballyTrackedPlayers()}** players tracked by ScapeBot!`;
            for (const grandChannel of grandChannels) {
                await grandChannel.send(grandText);
            }
            await logger.log(`Sent out grand winner message to guild(s) ${naturalJoin(grandChannels.map(c => `_${c.guild.name}_`))}: ${grandText}`, MultiLoggerLevel.Warn);
        }
    } catch (err) {
        await logger.log(`Failed to compute and send weekly grand winner info: \`${err}\``, MultiLoggerLevel.Error);
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
        await logger.log(`Logged in as: ${client.user?.tag}`);
        await logger.log(`Config=${JSON.stringify(CONFIG)}`);

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
        if (!timeoutManager.hasTimeoutWithType(TimeoutType.WeeklyXpUpdate)) {
            await timeoutManager.registerTimeout(TimeoutType.WeeklyXpUpdate, getNextFridayEvening(), { pastStrategy: PastTimeoutStrategy.Invoke });
        }
        // Start the daily loop if the right timeout isn't already scheduled (get next evening at 5:20pm)
        if (!timeoutManager.hasTimeoutWithType(TimeoutType.DailyAudit)) {
            await timeoutManager.registerTimeout(TimeoutType.DailyAudit, getNextEvening(), { pastStrategy: PastTimeoutStrategy.Invoke });
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
        await sendRestartMessage(downtimeMillis);
    } catch (err) {
        await logger.log(`Failed to boot:\n\`\`\`\n${(err as Error).stack}\n\`\`\`\nThe process will exit in 30 seconds...`, MultiLoggerLevel.Fatal);
        await sleep(30000);
        process.exit(1);
    }

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

    // Finally, run the synchronous update loop.
    // The purpose of using a synchronous loop is to ensure there's extra time between updates in the case of slow network calls.
    // TODO: We should make the scheduled events (e.g. weekly updates) use this same process to avoid concurrent state updates.
    // eslint-disable-next-line no-constant-condition
    while (true) {
        if (state.isDisabled()) {
            // If the bot is disabled, sleep for longer between iterations
            await sleep(CONFIG.refreshInterval * 10);
        } else {
            // Update the next player
            const nextPlayer = state.nextTrackedPlayer();
            if (nextPlayer) {
                try {
                    await updatePlayer(nextPlayer);
                    await pgStorageClient.writeMiscProperty('timestamp', new Date().toJSON());
                } catch (err) {
                    // Emergency fallback in case of unhandled errors
                    await logger.log(`Unhandled error while updating **${nextPlayer}**: \`${err}\``, MultiLoggerLevel.Error);
                }
            } else {
                // No players being tracked
            }
            // Sleep for the configured refresh interval
            await sleep(CONFIG.refreshInterval);
        }
    }
});

client.on('guildCreate', async (guild) => {
    const systemChannel = guild.systemChannel;
    const welcomeText = `Thanks for adding ${client.user} to your server! Admins: to get started, please use **/channel**`
        + ' in the text channel that should receive player updates and **/help** for a list of useful commands.';
    let welcomeLog = 'N/A';
    try {
        const botMember = guild.members.me;
        if (!botMember) {
            throw new Error(`Bot does not have valid membership in guild '${guild.id}'`);
        }
        // Apparently a guild can somehow not have a system channel, in this case fall back to DM
        if (!systemChannel) {
            throw new Error('No system channel');
        }
        // If there is a system channel, check for basic permissions
        const botPermissions = systemChannel.permissionsFor(botMember);
        const hasPermissions = botPermissions.has(PermissionFlagsBits.ViewChannel) && botPermissions.has(PermissionFlagsBits.SendMessages);
        if (!hasPermissions) {
            throw new Error('Missing basic permissions in system channel');
        }
        // If it has permissions, send to the system channel
        await systemChannel.send(welcomeText);
        welcomeLog = `welcome message sent to \`#${systemChannel.name}\``;
    } catch (err) {
        // Failed to send to the system channel, so fall back to guild owner DM
        try {
            await sendDMToGuildOwner(guild, welcomeText);
            welcomeLog = `sent welcome message DM to owner due to error: \`${err}\``;
        } catch (err2) {
            welcomeLog = `unable to send any welcome message at all: \`${err}\`, then \`${err2}\``;
        }
    }
    // TODO: Reduce this back down to debug once we see how this plays out
    await logger.log(`Bot has been added to guild _${guild.name}_, now in **${client.guilds.cache.size}** guilds (${welcomeLog})`, MultiLoggerLevel.Error);
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
            setTimeout(async () => {
                const replyText = `**<@${msg.author.id}>** has gained a level in **botting** and is now level **${state.getBotCounter(msg.author.id)}**`;
                await sendUpdateMessage([msg.channel], replyText, 'overall');
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
void client.login(AUTH.token);
