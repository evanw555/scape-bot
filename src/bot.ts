import { Client, ClientUser, DMChannel, GuildMember, Intents, Options, TextBasedChannel, TextChannel } from 'discord.js';
import { ScapeBotConfig, SerializedState, TimeoutType } from './types';
import { updatePlayer, sendUpdateMessage, getQuantityWithUnits, getThumbnail, getDurationString, getNextFridayEvening } from './util';
import hiscores, { Player } from 'osrs-json-hiscores';
import { TimeoutManager, FileStorage, PastTimeoutStrategy, loadJson, randInt } from 'evanw555.js';
import CommandReader from './command-reader';

const auth = loadJson('config/auth.json');
const config: ScapeBotConfig = loadJson('config/config.json');

import log from './log';
import state from './state';

const storage: FileStorage = new FileStorage('./data/');
const commandReader: CommandReader = new CommandReader();

export function sendRestartMessage(channel: TextBasedChannel, downtimeMillis: number): void {
    if (channel) {
        // Send greeting message to some channel
        const baseText = `ScapeBot online after ${getDurationString(downtimeMillis)} of downtime. In channel **${state.getTrackingChannel()}**, currently`;
        let fullText;
        if (state.isTrackingAnyPlayers()) {
            fullText = `${baseText} tracking players **${state.getAllTrackedPlayers().join('**, **')}**`;
        } else {
            fullText = `${baseText} not tracking any players`;
        }
        channel.send(fullText + '\n**Timeouts Scheduled:**\n' + timeoutManager.toStrings().join('\n') || '_none._');
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

    if (serializedState.players) {
        state.getTrackedPlayers().addAll(serializedState.players);
    }

    if (serializedState.playersOffHiScores) {
        serializedState.playersOffHiScores.forEach((player) => {
            state.removePlayerFromHiScores(player);
        });
    }

    if (serializedState.trackingChannelId) {
        const trackingChannel = (await client.channels.fetch(serializedState.trackingChannelId) as TextBasedChannel);
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

const weeklyTotalXpUpdate = async () => {
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
    // For each player appearing in both last week's and this week's mapping, determine the change in total XP
    const playersToCompare: string[] = Object.keys(oldTotalXpValues).filter(rsn => rsn in newTotalXpValues);
    const totalXpDiffs: Record<string, number> = {};
    for (const rsn of playersToCompare) {
        totalXpDiffs[rsn] = newTotalXpValues[rsn] - oldTotalXpValues[rsn];
    }
    // For each player with a non-zero diff, sort descending and get the top 3
    const sortedPlayers: string[] = playersToCompare
        .filter(rsn => totalXpDiffs[rsn] > 0)
        .sort((x, y) => totalXpDiffs[y] - totalXpDiffs[x]);
    const winners: string[] = sortedPlayers.slice(0, 3);

    // Send the message to the tracking channel
    const medalNames = ['gold', 'silver', 'bronze'];
    await state.getTrackingChannel().send({
        content: '**Biggest XP earners over the last week:**',
        embeds: winners.map((rsn, i) => {
            return {
                description: `**${rsn}** with **${getQuantityWithUnits(totalXpDiffs[rsn])} XP**`,
                thumbnail: getThumbnail(medalNames[i])
            };
        })
    });

    // Commit the changes
    state.setWeeklyTotalXpSnapshots(newTotalXpValues);
    await dumpState();
};

// TODO: Delete this
let sneakPeekChannel: TextChannel;

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

        // TODO: Temp logic to get sneak peek channel
        try {
            sneakPeekChannel = await guild.channels.fetch('878721761724747828') as TextChannel;
        } catch (err) {
            await ownerDmChannel?.send(`Unable to fetch sneak peek channel: \`${err}\``);
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
            const nextPlayer = state.getTrackedPlayers().next();
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

    if (ownerDmChannel) {
        // Notify the guild owner that the bot has restarted
        sendRestartMessage(ownerDmChannel, downtimeMillis);
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
                sendUpdateMessage(msg.channel, replyText, 'overall');
            }, randInt(0, 1500));
            return;
        }
        // Else, process the command as normal
        commandReader.read(msg);
    }
});

// Login!!!
client.login(auth.token);
