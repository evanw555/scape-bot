import { Client, Intents, Options, TextBasedChannels } from 'discord.js';

import commands from './commands.js';

import { loadJson } from './load-json.js';
const auth = loadJson('config/auth.json');
const config = loadJson('config/config.json');

import log from './log.js';
import state from './state.js';
import { updatePlayer } from './util.js';


/**
 * Searches string of text submitted to bot for 
 * spaces and quotes to tokenize arguments. Supports
 * single- and double-quotes, and tick marks.
 * 
 * text = '@ScapeBot kc "big belly" "the corrupted gauntlet"'; // text submitted to bot
 * args = extractArgs(text); // tokenizes arguments from text and removes mention
 * console.log(args); // ['kc', 'big belly', 'the corrupted gauntlet']
 * 
 * @param {string} text string of text sent to bot
 * @returns {string[]} array of arguments tokenized by quote and/or space
 */
const extractArgs = (text) => {
    // eslint-disable-next-line quotes
    const SINGLE_QUOTE_CHAR = `'`;
    const DOUBLE_QUOTE_CHAR = '"';
    const TICK_CHAR = '`';
    const SPACE_CHAR = ' ';
    const args = [];
    // remove start/end, extra whitespace
    const chars = text.trim().replace(/\s+/g, ' ').toLowerCase().split('');
    let i = 0;
    while (i < chars.length) {
        const c = chars[i];
        if (i === 0 && c !== SPACE_CHAR) {
            // find first space (cannot be first character)
            const j = chars.indexOf(SPACE_CHAR);
            // if no space, assume no arguments and break
            if (j === -1) {
                // first token is characters before end
                const firstToken = chars.slice(i).join('');
                args.push(firstToken);
                break;
            // otherwise, find first token and continue
            } else {
                // first token is characters before first space
                const firstToken = chars.slice(i, j).join('');
                args.push(firstToken);
                i = j;
            }
        } else if (c === SPACE_CHAR) {
            // find index of first char after space
            const tokenStart = i + 1;
            // increment i and step forward if next char is quote
            if (
                chars[tokenStart] === SINGLE_QUOTE_CHAR
                || chars[tokenStart] === DOUBLE_QUOTE_CHAR
                || chars[tokenStart] === TICK_CHAR
            ) {
                i = tokenStart;
            // otherwise, find token after space
            } else {
                // find index of next space
                const j = chars.indexOf(c, tokenStart);
                if (j === -1) {
                    // if no space, end of text
                    const token = chars.slice(tokenStart).join('');
                    args.push(token);
                    break;
                } else {
                    // otherwise, token is chars up to next space 
                    const token = chars.slice(tokenStart, j).join('');
                    args.push(token);
                    i = j;   
                }                
            }
        } else if (
            c === SINGLE_QUOTE_CHAR
            || c === DOUBLE_QUOTE_CHAR
            || c === TICK_CHAR
        ) {
            // find index of first char after quote
            const tokenStart = i + 1;
            // find index of next quote
            const j = chars.indexOf(c, tokenStart);
            if (j === -1) {
                // if no quote, end of text
                const token = chars.slice(tokenStart).join('');
                args.push(token);
                break;
            } else {
                // otherwise, token is chars up to next quote 
                let token = chars.slice(tokenStart, j).join('');
                // trim token b/c above regex does not remove
                // start/end space in quoted text
                token = token.trim();
                args.push(token);
                i = j;   
            }       
        } else {
            i += 1;
        }
        // ugly check to prevent infinite loops
        if (i === -1) {
            break;
        }
    }
    // remove bot mention from args
    return args.filter((arg) => {
        return arg && arg.indexOf('@') === -1;
    });
};

const parseCommand = (text) => {
    const args = extractArgs(text);
    return {
        text,
        command: args[0],
        args: args.splice(1),
        rawArgs: text.replace(/<@!?\d+>/g, '').trim().replace(new RegExp(`^${args[0]}`, 'g'), '').trim()
    };
};

const updatePlayers = (players) => {
    if (players) {
        players.forEach((player) => {
            updatePlayer(player);
        });
    }
};

const sendRestartMessage = (channel) => {
    if (channel) {
        // Send greeting message to some channel
        const baseText = `ScapeBot online in channel **${state.getTrackingChannel()}**, currently`;
        if (state._players.isEmpty()) {
            channel.send(`${baseText} not tracking any players`);
        } else {
            channel.send(`${baseText} tracking players **${state._players.toSortedArray().join('**, **')}**`);
        }
    } else {
        log.push('Attempted to send a bot restart message, but the specified channel is undefined!');
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

    await client.guilds.fetch();
    const guild = client.guilds.cache.first();
    log.push(`Operating in guild: ${guild}`);

    const owner = await guild.fetchOwner();

    let ownerDmChannel;
    if (owner) {
        state.addOwnerId(owner.id);
        ownerDmChannel = await owner.createDM();
        log.push(`Determined guild owner: ${owner.displayName}`);
    } else {
        log.push('Could not determine the guild\'s owner!');
    }
    Promise.all([
        state._storage.readJson('players'),
        state._storage.read('channel')
    ]).then(async ([savedPlayers, savedChannelId]) => {
        // Add saved players to queue
        state._players.addAll(savedPlayers);
        updatePlayers(savedPlayers);
        log.push(`Loaded up players ${state._players.toString()}`);
        // Attempt to set saved channel as tracking channel
        const savedChannel: TextBasedChannels = (await client.channels.fetch(savedChannelId)) as TextBasedChannels;
        if (savedChannel) {
            state.setTrackingChannel(savedChannel);
            log.push(`Loaded up tracking channel '${savedChannel}' of type '${savedChannel.type}' with ID '${savedChannelId}'`);
        } else if (ownerDmChannel) {
            state.setTrackingChannel(ownerDmChannel);
            log.push(`Invalid tracking channel ID '${savedChannelId}', defaulting to guild owner's DM channel`);
        } else {
            log.push('Could determine neither the guild owner\'s DM channel nor the saved tracking channel. Please set it using commands.');
        }
    }).catch((err) => {
        log.push(`Failed to load players or tracking channel: ${err.toString()}`);
    }).finally(() => {
        // Regardless of whether loading the players/channel was successful, start the update loop
        setInterval(() => {
            const nextPlayer = state._players.getNext();
            if (nextPlayer) {
                updatePlayer(nextPlayer);
            } else {
                // No players being tracked
            }
        }, config.refreshInterval);

        sendRestartMessage(ownerDmChannel);
    });
});

client.on('messageCreate', (msg) => {
    if (msg.mentions.has(client.user)) {
        if (msg.author.bot) {
            msg.channel.send(`<@${msg.author.id}> botting lvl?`);
            return;
        }
        // Parse command
        let parsedCommand;
        try {
            parsedCommand = parseCommand(msg.content);
        } catch (err) {
            log.push(`Failed to parse command '${msg.content}': ${err.toString()}`);
            return;
        }
        // Execute command
        const { command, args, rawArgs } = parsedCommand;
        if (commands.hasOwnProperty(command)) {
            try {
                commands[command].fn(msg, rawArgs, ...args);
                log.push(`Executed command '${command}' with args ${JSON.stringify(args)}`);
            } catch (err) {
                log.push(`Uncaught error while trying to execute command '${msg.content}': ${err.toString()}`);
            }
        } else if (!command) {
            msg.channel.send(`What's up <@${msg.author.id}>`);
        } else {
            msg.channel.send(`**${command}** is not a valid command, use **help** to see a list of commands`);
        }
    }
});

// Login!!!
client.login(auth.token);
