import { Client, ClientUser, DMChannel, GuildMember, Intents, Options, TextBasedChannel } from 'discord.js';
import { SerializedState } from './types';
import { updatePlayer, sendRestartMessage, sendUpdateMessage } from './util';

import { loadJson } from './load-json';
const auth = loadJson('config/auth.json');
const config = loadJson('config/config.json');

import log from './log';
import state from './state';

import FileStorage from './file-storage';
const storage: FileStorage = new FileStorage('./data/');

import CommandReader from './command-reader';
import hiscores, { Player } from 'osrs-json-hiscores';
const commandReader: CommandReader = new CommandReader();

const deserializeState = async (serializedState: SerializedState): Promise<void> => {
    if (serializedState.timestamp) {
        state.setTimestamp(new Date(serializedState.timestamp));
    }

    if (serializedState.disabled) {
        state.setDisabled(serializedState.disabled);
    }

    if (serializedState.players) {
        state.getTrackedPlayers().addAll(serializedState.players);
    }

    if (serializedState.playersOffHiScores) {
        serializedState.playersOffHiScores.forEach((player) => {
            state.removePlayerFromHiScores(player);
        });
    }

    if (serializedState.trackingChannelId) {
        const trackingChannel: TextBasedChannel = (await client.channels.fetch(serializedState.trackingChannelId)) as TextBasedChannel;
        if (trackingChannel) {
            state.setTrackingChannel(trackingChannel);
        }
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

const weeklyTotalXpUpdate = async (ownerDmChannel: DMChannel | undefined) => {
    // Schedule next timeout
    // TODO: Make this weekly, not daily
    setTimeout(async () => {
        await weeklyTotalXpUpdate(ownerDmChannel);
    }, 1000 * 60 * 60 * 24);
    // Abort is disabled
    if (state.isDisabled()) {
        return;
    }
    // Get old total XP values
    const oldTotalXpValues: Record<string, number> = state.getWeeklyTotalXpSnapshots();
    // Get new total XP values
    const newTotalXpValues: Record<string, number> = {};
    for (const rsn of state.getAllTrackedPlayers()) {
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
    // Determine the biggest winners
    const playersToCompare: string[] = Object.keys(oldTotalXpValues).filter(rsn => rsn in newTotalXpValues);
    const totalXpDiffs: Record<string, number> = {};
    for (const rsn of playersToCompare) {
        totalXpDiffs[rsn] = newTotalXpValues[rsn] - oldTotalXpValues[rsn];
    }
    const sortedPlayers: string[] = playersToCompare.sort((x, y) => totalXpDiffs[y] - totalXpDiffs[x]);
    const winners: string[] = sortedPlayers.slice(3);
    // Send the message to the tracking channel
    // TODO: Improve formatting!!!
    // await state.getTrackingChannel().send('**Biggest XP earners over the last week:**\n'
    //     + winners.map((rsn, i) => `_#${i + 1}_ **${rsn}** with **${totalXpDiffs[rsn]} XP**`));
    // TODO: Temp logic to test this out
    if (ownerDmChannel) {
        await ownerDmChannel.send(`**${Object.keys(oldTotalXpValues).length}** players in last week's total XP map, **${Object.keys(newTotalXpValues).length}** players in this week's.`);
        await ownerDmChannel.send('**Biggest XP earners over the last day:**\n'
        + sortedPlayers.map((rsn, i) => `_#${i + 1}_ **${rsn}** with **${totalXpDiffs[rsn]} XP**`) || '_none this week._');
    }
    // Commit the changes
    state.setWeeklyTotalXpSnapshots(newTotalXpValues);
    await dumpState();
};

client.on('ready', async () => {
    log.push(`Logged in as: ${client.user?.tag}`);
    log.push(`Config=${JSON.stringify(config)}`);

    // Determine which guild we're operating in
    // TODO: how would we handle multiple guilds???
    await client.guilds.fetch();
    const guild = client.guilds.cache.first();
    log.push(`Operating in guild: ${guild}`);

    // Determine the guild owner and the guild owner's DM channel
    let ownerDmChannel: DMChannel | undefined;
    if (guild) {
        const owner: GuildMember = await guild.fetchOwner();
        if (owner) {
            state.addOwnerId(owner.id);
            ownerDmChannel = await owner.createDM();
            log.push(`Determined guild owner: ${owner.displayName}`);
        } else {
            log.push('Could not determine the guild\'s owner!');
        }
    }

    // Read the serialized state from disk
    let serializedState: SerializedState | undefined;
    try {
        serializedState = await storage.readJson('state.json') as SerializedState;
    } catch (err) {
        log.push('Failed to read the state from disk!');
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

    // Default the tracking channel to the owner's DM if necessary...
    if (state.hasTrackingChannel()) {
        const trackingChannel: TextBasedChannel = state.getTrackingChannel();
        log.push(`Loaded up tracking channel '${trackingChannel}' of type '${trackingChannel.type}' with ID '${trackingChannel.id}'`);
    } else if (ownerDmChannel) {
        state.setTrackingChannel(ownerDmChannel);
        log.push(`Invalid tracking channel ID '${serializedState?.trackingChannelId || 'N/A'}', defaulting to guild owner's DM channel`);
    } else {
        log.push('Could determine neither the guild owner\'s DM channel nor the saved tracking channel. Please set it using commands.');
    }

    // Regardless of whether loading the players/channel was successful, start the update loop
    // TODO: Use timeout manager
    setInterval(() => {
        if (!state.isDisabled()) {
            const nextPlayer = state.getTrackedPlayers().getNext();
            if (nextPlayer) {
                updatePlayer(nextPlayer);
                // TODO: do this somewhere else!
                dumpState();
            } else {
                // No players being tracked
            }
        }
    }, config.refreshInterval);

    // Start the weekly loop (get next Friday at 5)
    // TODO: Use timeout manager
    // const nextFriday: Date = new Date();
    // nextFriday.setHours(17, 0, 0, 0);
    // nextFriday.setHours(nextFriday.getHours() + 24 * ((12 - nextFriday.getDay()) % 7));
    // TODO: Temp daily logic (today at 5:10)
    const next5pm: Date = new Date();
    next5pm.setHours(17, 10, 0, 0);
    if (next5pm.getTime() < new Date().getTime()) {
        next5pm.setHours(next5pm.getHours() + 24);
    }
    if (ownerDmChannel) {
        await ownerDmChannel.send(`Set total XP timeout for ${next5pm.toLocaleDateString('en-US')}`);
    }
    setTimeout(async () => {
        await weeklyTotalXpUpdate(ownerDmChannel);
    }, next5pm.getMilliseconds() - new Date().getMilliseconds());

    if (ownerDmChannel) {
        // Notify the guild owner that the bot has restarted
        sendRestartMessage(ownerDmChannel, downtimeMillis);
    }
});

client.on('messageCreate', (msg) => {
    // Only process messages that mention the bot
    if (msg.mentions.has(client.user as ClientUser)) {
        // If the message was sent by another bot, troll epic style 😈
        if (msg.author.bot) {
            state.incrementBotCounter(msg.author.id);
            // Wait up to 1.5 seconds before sending the message to make it feel more organic
            setTimeout(() => {
                const replyText = `**<@${msg.author.id}>** has gained a level in **botting** and is now level **${state.getBotCounter(msg.author.id)}**`;
                sendUpdateMessage(msg.channel, replyText, 'overall');
            }, Math.random() * 1500);
            return;
        }
        // Else, process the command as normal
        commandReader.read(msg);
    }
});

// Login!!!
client.login(auth.token);
