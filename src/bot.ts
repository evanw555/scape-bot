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
const commandReader: CommandReader = new CommandReader();

const deserializeState = async (serializedState: SerializedState): Promise<void> => {
    if (serializedState.timestamp) {
        state.setTimestamp(new Date(serializedState.timestamp));
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
    setInterval(() => {
        const nextPlayer = state.getTrackedPlayers().getNext();
        if (nextPlayer) {
            updatePlayer(nextPlayer);
            // TODO: do this somewhere else!
            dumpState();
        } else {
            // No players being tracked
        }
    }, config.refreshInterval);

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
