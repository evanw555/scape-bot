import { Client, ClientUser, Guild, Intents, Options, TextBasedChannel, User } from 'discord.js';
import { PlayerHiScores, SerializedState, TimeoutType } from './types';
import { sendUpdateMessage, getQuantityWithUnits, getThumbnail, getNextFridayEvening, updatePlayer } from './util';
import { TimeoutManager, FileStorage, PastTimeoutStrategy, randInt, getDurationString } from 'evanw555.js';
import { fetchAllPlayerBosses, fetchAllPlayerLevels, fetchAllTrackedPlayers, fetchAllTrackingChannels, fetchWeeklyXpSnapshots, initializeTables, writeWeeklyXpSnapshots } from './pg-storage';
import CommandReader from './command-reader';
import { fetchHiScores } from './hiscores';
import { Client as PGClient } from 'pg';

import { AUTH, CONFIG } from './constants';
import state from './instances/state';
import logger from './instances/logger';

const storage: FileStorage = new FileStorage('./data/');
const commandReader: CommandReader = new CommandReader();
let pgClient: PGClient | undefined;

export async function sendRestartMessage(downtimeMillis: number): Promise<void> {
    const text = `ScapeBot online after ${getDurationString(downtimeMillis)} of downtime. In **${client.guilds.cache.size}** guild(s).\n`;
    await logger.log(text + timeoutManager.toStrings().join('\n') || '_none._');
    await logger.log(client.guilds.cache.toJSON().map((guild, i) => `**${i + 1}.** _${guild.name}_ with **${state.getAllTrackedPlayers(guild.id).length}** in ${state.getTrackingChannel(guild.id)}`).join('\n'));
    // TODO: Use this if you need to troubleshoot...
    // await logger.log(state.toDebugString());
}

const timeoutCallbacks = {
    [TimeoutType.WeeklyXpUpdate]: async (): Promise<void> => {
        await timeoutManager.registerTimeout(TimeoutType.WeeklyXpUpdate, getNextFridayEvening(), { pastStrategy: PastTimeoutStrategy.Invoke });
        await weeklyTotalXpUpdate();
    }
};
const timeoutManager = new TimeoutManager<TimeoutType>(storage, timeoutCallbacks);

const deserializeState = async (serializedState: SerializedState): Promise<void> => {
    if (serializedState.timestamp) {
        state.setTimestamp(new Date(serializedState.timestamp));
    }

    if (serializedState.disabled) {
        state.setDisabled(serializedState.disabled);
    }

    if (serializedState.playersOffHiScores) {
        serializedState.playersOffHiScores.forEach((rsn) => {
            state.removePlayerFromHiScores(rsn);
        });
    }

    if (serializedState.botCounters) {
        state.setBotCounters(serializedState.botCounters);
    }

    // TODO: Eventually, the whole "deserialize" thing won't be needed. We'll just need one method for loading up all stuff from PG on startup
    const trackedPlayers = await fetchAllTrackedPlayers();
    for (const [ guildId, players ] of Object.entries(trackedPlayers)) {
        for (const rsn of players) {
            state.addTrackedPlayer(guildId, rsn);
        }
    }
    const trackingChannels = await fetchAllTrackingChannels();
    for (const [ guildId, trackingChannelId ] of Object.entries(trackingChannels)) {
        const trackingChannel = (await client.channels.fetch(trackingChannelId) as TextBasedChannel);
        if (trackingChannel) {
            state.setTrackingChannel(guildId, trackingChannel);
        }
    }
    state.setAllLevels(await fetchAllPlayerLevels());
    state.setAllBosses(await fetchAllPlayerBosses());

    // Now that the state has been loaded, mark it as valid
    state.setValid(true);
};

export async function dumpState(): Promise<void> {
    if (state.isValid()) {
        state.setTimestamp(new Date());
        return storage.write('state.json', JSON.stringify(state.serialize(), null, 2));
    }
};

// Initialize Discord Bot
const client = new Client({
    intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.DIRECT_MESSAGES
    ],
    makeCache: Options.cacheWithLimits({
        MessageManager: {
            maxSize: 10,
            sweepInterval: 300
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
        oldTotalXpValues = await fetchWeeklyXpSnapshots();
    } catch (err) {
        logger.log(`Unable to fetch weekly XP snapshots from PG: \`${err}\``);
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
        await writeWeeklyXpSnapshots(newTotalXpValues);
    } catch (err) {
        logger.log(`Unable to write weekly XP snapshots to PG: \`${err}\``);
    }
};

client.on('ready', async () => {
    logger.log(`Logged in as: ${client.user?.tag}`);
    logger.log(`Config=${JSON.stringify(CONFIG)}`);

    // Fetch guilds to load them into the cache
    await client.guilds.fetch();

    // Determine the admin user and the admin user's DM channel
    if (AUTH.adminUserId) {
        const admin: User = await client.users.fetch(AUTH.adminUserId);
        if (admin) {
            state.setAdminId(admin.id);
            const adminDmChannel: TextBasedChannel = await admin.createDM();
            logger.log(`Determined admin user: ${admin.username}`);
            logger.addOutput(async (text: string) => {
                await adminDmChannel.send(text);
            });
        } else {
            logger.log('Could not fetch the admin user!');
        }
    } else {
        logger.log('No admin user ID was specified in auth.json!');
    }

    // Read the serialized state from disk
    let serializedState: SerializedState | undefined;
    try {
        serializedState = await storage.readJson('state.json') as SerializedState;
    } catch (err) {
        logger.log('Failed to read the state from disk!');
    }

    // Attempt to initialize the PG client
    try {
        pgClient = new PGClient(AUTH.pg);
        await pgClient.connect();
        state.setPGClient(pgClient);
        await logger.log(`PG client connected to \`${pgClient.host}:${pgClient.port}\``);
    } catch (err) {
        pgClient = undefined;
        await logger.log(`PG client failed to connect: \`${err}\``);
        process.exit(1);
    }

    // Ensure all necessary tables exist, initialize those that don't
    await initializeTables();

    // Deserialize it and load it into the state object
    let downtimeMillis = 0;
    if (serializedState) {
        await deserializeState(serializedState);
        // Compute timestamp if it's present (should only be missing the very first time)
        if (state.hasTimestamp()) {
            downtimeMillis = new Date().getTime() - state.getTimestamp().getTime();
        }
    }

    // Log how many guilds are missing tracking channels
    const guildsWithoutTrackingChannels: Guild[] = client.guilds.cache.toJSON()
        .filter(guild => !state.hasTrackingChannel(guild.id));
    if (guildsWithoutTrackingChannels.length > 0) {
        logger.log(`This bot is in **${client.guilds.cache.size}** guilds, but a tracking channel is missing for **${guildsWithoutTrackingChannels.length}** of them`);
    }

    // Regardless of whether loading the players/channel was successful, start the update loop
    // TODO: Use timeout manager
    setInterval(async () => {
        if (!state.isDisabled()) {
            const nextPlayer = state.nextTrackedPlayer();
            if (nextPlayer) {
                await updatePlayer(nextPlayer);
            } else {
                // No players being tracked
            }
        }
    }, CONFIG.refreshInterval);

    // Start the weekly loop if the right timeout isn't already scheduled (get next Friday at 5:10pm)
    if (!timeoutManager.hasTimeout(TimeoutType.WeeklyXpUpdate)) {
        await timeoutManager.registerTimeout(TimeoutType.WeeklyXpUpdate, getNextFridayEvening(), { pastStrategy: PastTimeoutStrategy.Invoke });
    }

    // Notify the admin that the bot has restarted
    sendRestartMessage(downtimeMillis);
});

client.on('messageCreate', (msg) => {
    // Only process messages from other users mentio
    if (msg.mentions.has(client.user as ClientUser) && msg.author.id !== client.user?.id) {
        // If the message was sent by another bot, troll epic style 😈
        if (msg.author.bot) {
            state.incrementBotCounter(msg.author.id);
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

// Login!!!
client.login(AUTH.token);
