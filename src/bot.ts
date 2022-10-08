import { Client, ClientUser, DMChannel, Guild, Intents, Options, TextBasedChannel, User } from 'discord.js';
import { ScapeBotAuth, ScapeBotConfig, SerializedState, TimeoutType } from './types';
import { updatePlayer, sendUpdateMessage, getQuantityWithUnits, getThumbnail, getDurationString, getNextFridayEvening } from './util';
import hiscores, { Player } from 'osrs-json-hiscores';
import { TimeoutManager, FileStorage, PastTimeoutStrategy, loadJson, randInt } from 'evanw555.js';
import CommandReader from './command-reader';
import { Client as PGClient } from 'pg';

const auth: ScapeBotAuth = loadJson('config/auth.json');
const config: ScapeBotConfig = loadJson('config/config.json');

import log from './log';
import state from './state';
import { fetchWeeklyXpSnapshots, writeWeeklyXpSnapshots } from './pg-storage';

const storage: FileStorage = new FileStorage('./data/');
const commandReader: CommandReader = new CommandReader();
let pgClient: PGClient | undefined;

export async function sendRestartMessage(channel: TextBasedChannel, downtimeMillis: number): Promise<void> {
    if (channel) {
        // Send greeting message to some channel
        const text = `ScapeBot online after ${getDurationString(downtimeMillis)} of downtime. In **${client.guilds.cache.size}** guild(s).\n`;
        await channel.send(text + timeoutManager.toStrings().join('\n') || '_none._');
        await channel.send(client.guilds.cache.toJSON().map((guild, i) => `**${i + 1}.** _${guild.name}_ with **${state.getAllTrackedPlayers(guild.id).length}** in ${state.getTrackingChannel(guild.id)}`).join('\n'));
    } else {
        log.push('Attempted to send a bot restart message, but the specified channel is undefined!');
    }
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

    if (serializedState.guilds) {
        for (const [ guildId, serializedGuildState ] of Object.entries(serializedState.guilds)) {
            for (const rsn of serializedGuildState.players) {
                state.addTrackedPlayer(guildId, rsn);
            }
            if (serializedGuildState.trackingChannelId) {
                const trackingChannel = (await client.channels.fetch(serializedGuildState.trackingChannelId) as TextBasedChannel);
                if (trackingChannel) {
                    state.setTrackingChannel(guildId, trackingChannel);
                }
            }
        }
    }

    if (serializedState.playersOffHiScores) {
        serializedState.playersOffHiScores.forEach((rsn) => {
            state.removePlayerFromHiScores(rsn);
        });
    }

    if (serializedState.levels) {
        state.setAllLevels(serializedState.levels);
    }

    if (serializedState.bosses) {
        state.setAllBosses(serializedState.bosses);
    }

    if (serializedState.botCounters) {
        state.setBotCounters(serializedState.botCounters);
    }

    if (serializedState.weeklyTotalXpSnapshots) {
        state.setWeeklyTotalXpSnapshots(serializedState.weeklyTotalXpSnapshots);
    }

    // TODO: If legacy pre-guild data still exists, add it for every guild
    const allGuilds: Guild[] = client.guilds.cache.toJSON();
    if (serializedState.trackingChannelId) {
        const trackingChannel = (await client.channels.fetch(serializedState.trackingChannelId) as TextBasedChannel);
        if (trackingChannel) {
            for (const guild of client.guilds.cache.toJSON()) {
                state.setTrackingChannel(guild.id, trackingChannel);
            }
        }
    }
    if (serializedState.players) {
        for (const guild of client.guilds.cache.toJSON()) {
            for (const rsn of serializedState.players) {
                state.addTrackedPlayer(guild.id, rsn);
            }
        }
    }

    // Now that the state has been loaded, mark it as valid
    state.setValid(true);
};

const dumpState = async (): Promise<void> => {
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
    // TODO: Falling back to the legacy state data in the transition, remove this
    let oldTotalXpValues: Record<string, number> | undefined;
    try {
        oldTotalXpValues = await fetchWeeklyXpSnapshots(pgClient as PGClient);
    } catch (err) {
        log.push(`Unable to fetch weekly XP snapshots from PG: ${err}`);
    }
    // TODO Remove this
    if (!oldTotalXpValues || Object.keys(oldTotalXpValues).length === 0) {
        log.push('Falling back to legacy XP snapshot state data');
        oldTotalXpValues = state.getWeeklyTotalXpSnapshots();
    }
    if (!oldTotalXpValues) {
        log.push('Still cannot fetch weekly XP snapshots, aborting...');
        return;
    }

    // Get new total XP values
    const newTotalXpValues: Record<string, number> = {};
    for (const rsn of state.getAllGloballyTrackedPlayers()) {
        try {
            const player: Player = await hiscores.getStats(rsn);
            const totalXp: number = player[player.mode]?.skills.overall.xp ?? 0;
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
    await writeWeeklyXpSnapshots(pgClient as PGClient, newTotalXpValues);
    // TODO: Remove this
    state.setWeeklyTotalXpSnapshots(undefined);
    await dumpState();
};

client.on('ready', async () => {
    log.push(`Logged in as: ${client.user?.tag}`);
    log.push(`Config=${JSON.stringify(config)}`);

    // Fetch guilds to load them into the cache
    await client.guilds.fetch();

    // Determine the admin user and the admin user's DM channel
    let adminDmChannel: DMChannel | undefined;
    if (auth.adminUserId) {
        const admin: User = await client.users.fetch(auth.adminUserId);
        if (admin) {
            state.setAdminId(admin.id);
            adminDmChannel = await admin.createDM();
            log.push(`Determined admin user: ${admin.username}`);
        } else {
            log.push('Could not fetch the admin user!');
        }
    } else {
        log.push('No admin user ID was specified in auth.json!');
    }

    // Read the serialized state from disk
    let serializedState: SerializedState | undefined;
    try {
        serializedState = await storage.readJson('state.json') as SerializedState;
    } catch (err) {
        log.push('Failed to read the state from disk!');
    }

    // Attempt to initialize the PG client
    try {
        pgClient = new PGClient(auth.pg);
        await pgClient.connect();
        await adminDmChannel?.send(`PG client connected to \`${pgClient.host}:${pgClient.port}\``);
    } catch (err) {
        pgClient = undefined;
        await adminDmChannel?.send(`PG client failed to connect: \`${err}\``);
    }

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
        await adminDmChannel?.send(`This bot is in **${client.guilds.cache.size}** guilds, but a tracking channel is missing for **${guildsWithoutTrackingChannels.length}** of them`);
    }

    // Regardless of whether loading the players/channel was successful, start the update loop
    // TODO: Use timeout manager
    setInterval(() => {
        if (!state.isDisabled()) {
            const nextPlayer = state.nextTrackedPlayer();
            if (nextPlayer) {
                updatePlayer(nextPlayer);
                // TODO: do this somewhere else!
                dumpState();
            } else {
                // No players being tracked
            }
        }
    }, config.refreshInterval);

    // Start the weekly loop if the right timeout isn't already scheduled (get next Friday at 5:10pm)
    if (!timeoutManager.hasTimeout(TimeoutType.WeeklyXpUpdate)) {
        await timeoutManager.registerTimeout(TimeoutType.WeeklyXpUpdate, getNextFridayEvening(), { pastStrategy: PastTimeoutStrategy.Invoke });
    }

    if (adminDmChannel) {
        // Notify the admin that the bot has restarted
        sendRestartMessage(adminDmChannel, downtimeMillis);
    }
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
client.login(auth.token);
