import { Client, DMChannel, GuildMember, Intents, Options, TextBasedChannels } from 'discord.js';
import { SerializedState } from './types.js';
import { updatePlayer, sendRestartMessage } from './util.js';

import { loadJson } from './load-json.js';
const auth = loadJson('config/auth.json');
const config = loadJson('config/config.json');

import log from './log.js';
import state from './state.js';

import FileStorage from './file-storage.js';
const storage: FileStorage = new FileStorage('./data/');

import CommandReader from './command-reader.js';
const commandReader: CommandReader = new CommandReader();

const deserializeState = async (serializedState: SerializedState): Promise<void> => {
    state.getTrackedPlayers().addAll(serializedState.players);

    if (serializedState.trackingChannelId) {
        const trackingChannel: TextBasedChannels = (await client.channels.fetch(serializedState.trackingChannelId)) as TextBasedChannels;
        if (trackingChannel) {
            state.setTrackingChannel(trackingChannel);
        }
    }

    if (serializedState.levels) {
        state.setLevels(serializedState.levels);
    }

    if (serializedState.bosses) {
        state.setBosses(serializedState.bosses);
    }

    // Now that the state has been loaded, mark it as valid
    state.setValid(true);
}

const dumpState = async (): Promise<void> => {
    if (state.isValid()) {
        return storage.write('state.json', JSON.stringify(state.serialize(), null, 2));
    }
};

// Initialize Discord Bot
var client = new Client({
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
    log.push(`Logged in as: ${client.user.tag}`);
    log.push(`Config=${JSON.stringify(config)}`);

    // Determine which guild we're operating in
    // TODO: how would we handle multiple guilds???
    await client.guilds.fetch();
    const guild = client.guilds.cache.first();
    log.push(`Operating in guild: ${guild}`);

    // Determine the guild owner and the guild owner's DM channel
    const owner: GuildMember = await guild.fetchOwner();
    let ownerDmChannel: DMChannel;
    if (owner) {
        state.addOwnerId(owner.id);
        ownerDmChannel = await owner.createDM();
        log.push(`Determined guild owner: ${owner.displayName}`);
    } else {
        log.push('Could not determine the guild\'s owner!');
    }

    // Read the serialized state from disk
    let serializedState: SerializedState;
    try {
        serializedState = await storage.readJson('state.json');
    } catch (err) {
        log.push('Failed to read the state from disk!');
    }

    // Deserialize it and load it into the state object
    if (serializedState) {
        await deserializeState(serializedState);
    }

    // Default the tracking channel to the owner's DM if necessary...
    if (state.hasTrackingChannel()) {
        const trackingChannel: TextBasedChannels = state.getTrackingChannel();
        log.push(`Loaded up tracking channel '${trackingChannel}' of type '${trackingChannel.type}' with ID '${trackingChannel.id}'`);
    } else if (ownerDmChannel) {
        state.setTrackingChannel(ownerDmChannel);
        log.push(`Invalid tracking channel ID '${serializedState?.trackingChannelId || "N/A"}', defaulting to guild owner's DM channel`);
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

    // Notify the guild owner that the bot has restarted
    sendRestartMessage(ownerDmChannel);
});

client.on('messageCreate', (msg) => {
    // Only process messages that mention the bot
    if (msg.mentions.has(client.user)) {
        // If the message was sent by another bot, troll epic style 😈
        if (msg.author.bot) {
            msg.channel.send(`<@${msg.author.id}> botting lvl?`);
            return;
        }
        // Else, process the command as normal
        commandReader.read(msg);
    }
});

// Login!!!
client.login(auth.token);
