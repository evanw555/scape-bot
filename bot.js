const Discord = require('discord.js');
const osrs = require('osrs-json-api');

const CircularQueue = require('./circular-queue');
const CapacityLog = require('./capacity-log');

const auth = require('./config/auth.json');
const config = require('./config/config.json');
const thumbnails = require('./static/thumbnails.json');

const log = new CapacityLog(config.logCapacity);

const sendUpdateMessage = (channel, text, skill, args) => {
    channel.send({
        embed: {
            description: text,
            thumbnail: (skill && thumbnails.hasOwnProperty(skill)) ? {
                url: thumbnails.base + thumbnails[skill]
            } : undefined,
            color: 6316287,
            title: args && args.title,
            url: args && args.url
        }
    });
};

const parseCommand = (text) => {
    const args = text.toLowerCase().split(' ').filter((arg) => {
        return arg && arg.indexOf('@') === -1;
    });
    return {
        text,
        command: args[0],
        args: args.splice(1),
        rawArgs: text.replace(/<@\d+>/g, '').trim().replace(new RegExp(`^${args[0]}`, 'g'), '').trim()
    };
};

const computeDiff = (before, after) => {
    const skills = Object.keys(before);
    const diff = {};
    skills.forEach((skill) => {
        if (before[skill] !== after[skill]) {
            const levelDiff = after[skill] - before[skill];
            if (typeof levelDiff !== 'number' || isNaN(levelDiff)) {
                throw new Error(`Invalid ${skill} level diff, ${after[skill]} minus ${before[skill]} is ${levelDiff}`);
            }
            diff[skill] = levelDiff;
        }
    });
    return diff;
};

const parsePlayerPayload = (payload) => {
    const result = {};
    Object.keys(payload.skills).forEach((skill) => {
        if (skill !== 'overall') {
            const rawLevel = payload.skills[skill].level;
            const level = parseInt(rawLevel);
            if (typeof level !== 'number' || isNaN(level)) {
                throw new Error(`Invalid ${skill} level, ${rawLevel} parsed to ${level}`);
            }
            result[skill] = level;
        }
    });
    return result;
};

const updatePlayer = (player) => {
    // Retrieve the player's hiscores data
    osrs.hiscores.getPlayer(player).then((value) => {
        // Parse the player's hiscores data into levels
        let newLevels;
        try {
            newLevels = parsePlayerPayload(value);
        } catch (err) {
            log.push(`Failed to parse hiscores payload for player ${player}: ${err.toString()}`);
            return;
        }
        // If channel is set and user already has levels tracked
        if (trackingChannel && levels.hasOwnProperty(player)) {
            // Compute diff for each level
            let diff;
            try {
                diff = computeDiff(levels[player], newLevels);
            } catch (err) {
                log.push(`Failed to compute level diff for player ${player}: ${err.toString()}`);
                return;
            }
            if (!diff) {
                return;
            }
            // Send a message showing all the levels gained
            switch (Object.keys(diff).length) {
                case 0:
                    return;
                case 1:
                    const skill = Object.keys(diff)[0];
                    const levelsGained = diff[skill];
                    sendUpdateMessage(trackingChannel, `**${player}** has gained ${levelsGained === 1 ? 'a level' : `**${levelsGained}** levels`} in **${skill}** and is now level **${newLevels[skill]}**`, skill);
                    break;
                default:
                    const text = Object.keys(diff).map((skill) => {
                        const levelsGained = diff[skill];
                        return `${levelsGained === 1 ? 'a level' : `**${levelsGained}** levels`} in **${skill}** and is now level **${newLevels[skill]}**`;
                    }).join('\n');
                    sendUpdateMessage(trackingChannel, `**${player}** has gained...\n${text}`, 'overall');
                    break;
            }
        }
        levels[player] = newLevels;
        lastUpdate[player] = new Date();
    }).catch((err) => {
        log.push(`Error while fetching player hiscores for ${player}: ${err.toString()}`);
    });
};

const players = new CircularQueue();
const levels = {};
const lastUpdate = {};

let trackingChannel = null;

const commands = {
    help: {
        fn: (msg) => {
            const commandKeys = Object.keys(commands);
            commandKeys.sort();
            const maxLengthKey = Math.max(...commandKeys.map((key) => {
                return key.length;
            }));
            const innerText = commandKeys
                .filter(key => !commands[key].hidden)
                .map(key => `${key.padEnd(maxLengthKey)} :: ${commands[key].text}`)
                .join('\n');
            msg.channel.send(`\`\`\`asciidoc\n${innerText}\`\`\``);
        },
        usage: '',
        text: 'Shows help'
    },
    track: {
        fn: (msg, rawArgs) => {
            const player = rawArgs;
            if (!player || !player.trim()) {
                msg.channel.send('Invalid username');
                return;
            }
            if (players.contains(player)) {
                msg.channel.send('That player is already being tracked');
            } else {
                players.add(player);
                updatePlayer(player);
                msg.channel.send(`Now tracking player **${player}**`);
            }
        },
        usage: '',
        text: 'Tracks a player and gives updates when they level up'
    },
    remove: {
        fn: (msg, rawArgs) => {
            const player = rawArgs;
            if (!player || !player.trim()) {
                msg.channel.send('Invalid username');
                return;
            }
            if (players.contains(player)) {
                players.remove(player);
                delete levels[player];
                delete lastUpdate[player];
                msg.channel.send(`No longer tracking player **${player}**`);
            } else {
                msg.channel.send('That player is not currently being tracked');
            }
        },
        usage: '',
        text: 'Stops tracking a player'
    },
    list: {
        fn: (msg) => {
            if (players.isEmpty()) {
                msg.channel.send('Currently not tracking any players');
            } else {
                msg.channel.send(`Currently tracking players **${players.toSortedArray().join('**, **')}**`)
            }
        },
        usage: '',
        text: 'Lists all the players currently being tracked'
    },
    details: {
        fn: (msg) => {
            if (players.isEmpty()) {
                msg.channel.send('Currently not tracking any players');
            } else {
                const sortedPlayers = players.toSortedArray();
                msg.channel.send(`${sortedPlayers.map(player => `**${player}**: last updated **${lastUpdate[player] && lastUpdate[player].toLocaleTimeString()}**`).join('\n')}`)
            }
        },
        text: 'Show details of when each tracked player was last updated'
    },
    check: {
        fn: (msg, rawArgs) => {
            const player = rawArgs;
            if (!player || !player.trim()) {
                msg.channel.send('Invalid username');
                return;
            }
            // Retrieve the player's hiscores data
            osrs.hiscores.getPlayer(player).then((value) => {
                // Parse the player's hiscores data into levels
                let currentLevels;
                try {
                    currentLevels = parsePlayerPayload(value);
                } catch (err) {
                    log.push(`Failed to parse hiscores payload for player ${player}: ${err.toString()}`);
                    return;
                }
                const skills = Object.keys(currentLevels);
                skills.sort();
                sendUpdateMessage(msg.channel, skills.map(skill => `**${currentLevels[skill]}** ${skill}`).join('\n'), 'overall', {
                    title: player,
                    url: `https://secure.runescape.com/m=hiscore_oldschool/hiscorepersonal.ws?user1=${encodeURI(player)}`
                });
            });
        },
        text: 'Show the current levels for some player'
    },
    channel: {
        fn: (msg) => {
            trackingChannel = msg.channel;
            msg.channel.send('Player experience updates will now be sent to this channel');
        },
        usage: '',
        text: 'All player updates will be sent to the channel where this command is issued'
    },
    hey: {
        fn: (msg) => {
            msg.channel.send('Sup');
        },
        hidden: true
    },
    sup: {
        fn: (msg) => {
            msg.channel.send('Hey');
        },
        hidden: true
    },
    log: {
        fn: (msg) => {
            msg.channel.send(`\`\`\`${log.toLogArray().join('\n')}\`\`\``);
        },
        hidden: true
    }
};

// Initialize Discord Bot
var client = new Discord.Client();

client.on('ready', () => {
    log.push(`Logged in as: ${client.user.tag}`);
    log.push(`Config=${JSON.stringify(config)}`);
});

client.on('message', (msg) => {
    if (msg.isMemberMentioned(client.user)) {
        // Parse command
        let parsedCommand;
        try {
            parsedCommand = parseCommand(msg.content);
        } catch (err) {
            log.push(`Failed to parse command "${msg.content}": ${err.toString()}`);
            return
        }
        // Execute command
        const { command, args, rawArgs } = parsedCommand;
        if (commands.hasOwnProperty(command)) {
            try {
                const responseMessage = commands[command].fn(msg, rawArgs, ...args);
            } catch (err) {
                log.push(`Uncaught error while trying to execute command "${msg.content}": ${err.toString()}`);
            }
        } else {
            msg.channel.send(`**${command}** is not a valid command, use **help** to see a list of commands`);
        }
    }
});

// Login and start the update interval
client.login(auth.token);
client.setInterval(() => {
        const nextPlayer = players.getNext();
        if (nextPlayer) {
            updatePlayer(nextPlayer);
        } else {
            // No players being tracked
        }
    }, config.refreshInterval);
