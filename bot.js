const Discord = require('discord.js');
const osrs = require('osrs-json-api');
const fs = require('fs');

const CircularQueue = require('./circular-queue');
const CapacityLog = require('./capacity-log');
const Storage = require('./storage');

const auth = require('./config/auth.json');
const config = require('./config/config.json');
const constants = require('./static/constants.json');

const validSkills = new Set(constants.skills);
const log = new CapacityLog(config.logCapacity, config.logMaxEntryLength);
const storage = new Storage('./data/');
const ownerIds = new Set();

Array.prototype.toSortedSkills = function () {
    const skillSubset = new Set(this);
    return constants.skills.filter(skill => skillSubset.has(skill));
};

const savePlayers = () => {
    storage.write('players', players.toString()).catch((err) => {
        log.push(`Unable to save players "${player}": ${err.toString()}`);
    });
};

const saveChannel = () => {
    storage.write('channel', trackingChannel.id).catch((err) => {
        log.push(`Unable to save tracking channel: ${err.toString()}`);
    });
};

const sendUpdateMessage = (channel, text, skill, args) => {
    channel.send({
        embed: {
            description: text,
            thumbnail: (skill && validSkills.has(skill)) ? {
                url: `${constants.baseThumbnailUrl}${(args && args.is99) ? constants.level99Path : ''}${skill}${constants.imageFileExtension}`
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
        rawArgs: text.replace(/<@!?\d+>/g, '').trim().replace(new RegExp(`^${args[0]}`, 'g'), '').trim()
    };
};

const computeDiff = (before, after) => {
    const skills = Object.keys(before);
    const diff = {};
    skills.forEach((skill) => {
        if (before[skill] !== after[skill]) {
            const levelDiff = after[skill] - before[skill];
            if (typeof levelDiff !== 'number' || isNaN(levelDiff) || levelDiff < 0) {
                throw new Error(`Invalid ${skill} level diff, "${after[skill]}" minus "${before[skill]}" is "${levelDiff}"`);
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
            if (typeof level !== 'number' || isNaN(level) || level < 1) {
                throw new Error(`Invalid ${skill} level, "${rawLevel}" parsed to ${level}.\nPayload: ${JSON.stringify(payload)}`);
            }
            result[skill] = level;
        }
    });
    return result;
};

const updatePlayer = (player, spoofedDiff) => {
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
                if (spoofedDiff) {
                    diff = spoofedDiff;
                    Object.keys(diff).forEach((skill) => {
                        newLevels[skill] += diff[skill];
                    });
                } else {
                    diff = computeDiff(levels[player], newLevels);
                }
            } catch (err) {
                log.push(`Failed to compute level diff for player ${player}: ${err.toString()}`);
                return;
            }
            if (!diff) {
                return;
            }
            // Send a message for any skill that is now 99 and remove it from the diff
            Object.keys(diff).toSortedSkills().forEach((skill) => {
                const newLevel = newLevels[skill];
                if (newLevel === 99) {
                    const levelsGained = diff[skill];
                    sendUpdateMessage(trackingChannel,
                        `**${player}** has gained `
                            + (levelsGained === 1 ? 'a level' : `**${levelsGained}** levels`)
                            + ` in **${skill}** and is now level **99**\n\n`
                            + `@everyone congrats **${player}**!`,
                        skill, {
                            is99: true
                        });
                    delete diff[skill];
                }
            });
            // Send a message showing all the levels gained
            switch (Object.keys(diff).length) {
                case 0:
                    break;
                case 1:
                    const skill = Object.keys(diff)[0];
                    const levelsGained = diff[skill];
                    sendUpdateMessage(trackingChannel,
                        `**${player}** has gained `
                            + (levelsGained === 1 ? 'a level' : `**${levelsGained}** levels`)
                            + ` in **${skill}** and is now level **${newLevels[skill]}**`,
                        skill);
                    break;
                default:
                    const text = Object.keys(diff).toSortedSkills().map((skill) => {
                        const levelsGained = diff[skill];
                        return `${levelsGained === 1 ? 'a level' : `**${levelsGained}** levels`} in **${skill}** and is now level **${newLevels[skill]}**`;
                    }).join('\n');
                    sendUpdateMessage(trackingChannel, `**${player}** has gained...\n${text}`, 'overall');
                    break;
            }
        }
        // If not spoofing the diff, update player's levels
        if (!spoofedDiff) {
            levels[player] = newLevels;
            lastUpdate[player] = new Date();
        }
    }).catch((err) => {
        log.push(`Error while fetching player hiscores for ${player}: ${err.toString()}`);
    });
};

const updatePlayers = (players) => {
    if (players) {
        players.forEach((player) => {
            updatePlayer(player);
        });
    }
};

const getHelpText = (hidden) => {
    const commandKeys = Object.keys(commands)
        .filter(key => !!commands[key].hidden === !!hidden);
    commandKeys.sort();
    const maxLengthKey = Math.max(...commandKeys.map((key) => {
        return key.length;
    }));
    const innerText = commandKeys
        .map(key => `${key.padEnd(maxLengthKey)} :: ${commands[key].text}`)
        .join('\n');
    return `\`\`\`asciidoc\n${innerText}\`\`\``;
};

const sendRestartMessage = (channel) => {
    // Send greeting message to some channel
    const baseText = `ScapeBot online in channel **${trackingChannel && trackingChannel.name}**, currently`;
    if (players.isEmpty()) {
        channel.send(`${baseText} not tracking any players`);
    } else {
        channel.send(`${baseText} tracking players **${players.toSortedArray().join('**, **')}**`);
    }
};

let players = new CircularQueue();
const levels = {};
const lastUpdate = {};

let trackingChannel = null;

const commands = {
    help: {
        fn: (msg) => {
            msg.channel.send(getHelpText(false));
        },
        text: 'Shows help'
    },
    track: {
        fn: (msg, rawArgs) => {
            const player = rawArgs && rawArgs.toLowerCase();
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
                savePlayers();
            }
        },
        text: 'Tracks a player and gives updates when they level up'
    },
    remove: {
        fn: (msg, rawArgs) => {
            const player = rawArgs && rawArgs.toLowerCase();
            if (!player || !player.trim()) {
                msg.channel.send('Invalid username');
                return;
            }
            if (players.contains(player)) {
                players.remove(player);
                delete levels[player];
                delete lastUpdate[player];
                msg.channel.send(`No longer tracking player **${player}**`);
                savePlayers();
            } else {
                msg.channel.send('That player is not currently being tracked');
            }
        },
        text: 'Stops tracking a player'
    },
    clear: {
        fn: (msg) => {
            players.clear();
            msg.channel.send('No longer tracking any players');
            savePlayers();
        },
        text: 'Stops tracking all players'
    },
    list: {
        fn: (msg) => {
            if (players.isEmpty()) {
                msg.channel.send('Currently not tracking any players');
            } else {
                msg.channel.send(`Currently tracking players **${players.toSortedArray().join('**, **')}**`)
            }
        },
        text: 'Lists all the players currently being tracked'
    },
    check: {
        fn: (msg, rawArgs) => {
            const player = rawArgs && rawArgs.toLowerCase();
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
                const skills = Object.keys(currentLevels).toSortedSkills();
                const baseLevel = Math.min(...Object.values(currentLevels));
                const totalLevel = Object.values(currentLevels).reduce((x,y) => { return x + y; });
                const messageText = `${skills.map(skill => `**${currentLevels[skill]}** ${skill}`).join('\n')}\n\nTotal **${totalLevel}**\nBase **${baseLevel}**`;
                sendUpdateMessage(msg.channel, messageText, 'overall', {
                    title: player,
                    url: `${constants.hiScoresUrlTemplate}${encodeURI(player)}`
                });
            }).catch((err) => {
                log.push(`Error while fetching hiscores (check) for player ${player}: ${err.toString()}`);
                msg.channel.send(`Couldn\'t fetch hiscores for player **${player}** :pensive:\n\`${err.toString()}\``);
            });
        },
        text: 'Show the current levels for some player'
    },
    channel: {
        fn: (msg) => {
            trackingChannel = msg.channel;
            trackingChannel.send('Player experience updates will now be sent to this channel');
            saveChannel();
        },
        text: 'All player updates will be sent to the channel where this command is issued'
    },
    hiddenhelp: {
        fn: (msg) => {
            msg.channel.send(getHelpText(true));
        },
        hidden: true,
        text: 'Shows help for hidden commands'
    },
    details: {
        fn: (msg) => {
            if (players.isEmpty()) {
                msg.channel.send('Currently not tracking any players');
            } else {
                const sortedPlayers = players.toSortedArray();
                msg.channel.send(`${sortedPlayers.map(player => `**${player}**: last updated **${lastUpdate[player] && lastUpdate[player].toLocaleTimeString("en-US", {timeZone: config.timeZone})}**`).join('\n')}`)
            }
        },
        text: 'Show details of when each tracked player was last updated'
    },
    hey: {
        fn: (msg) => {
            msg.channel.send('Sup');
        },
        hidden: true,
        text: 'Hey'
    },
    sup: {
        fn: (msg) => {
            msg.channel.send('Hey');
        },
        hidden: true,
        text: 'Sup'
    },
    log: {
        fn: (msg) => {
            msg.channel.send(`\`\`\`${log.toLogArray().join('\n')}\`\`\``);
        },
        hidden: true,
        text: 'Prints the bot\'s log'
    },
    thumbnail: {
        fn: (msg, rawArgs, skill) => {
            if (validSkills.has(skill)) {
                sendUpdateMessage(msg.channel, 'Here is the thumbnail', skill, {
                    title: skill
                });
            } else {
                msg.channel.send(`**${skill || '[none]'}** is not a valid skill`);
            }
        },
        hidden: true,
        text: 'Displays a skill\'s thumbnail'
    },
    thumbnail99: {
        fn: (msg, rawArgs, skill) => {
            if (validSkills.has(skill)) {
                sendUpdateMessage(msg.channel, 'Here is the level 99 thumbnail', skill, {
                    title: skill,
                    is99: true
                });
            } else {
                msg.channel.send(`**${skill || '[none]'}** is not a valid skill`);
            }
        },
        hidden: true,
        text: 'Displays a skill\'s level 99 thumbnail'
    },
    spoofupdate: {
        fn: (msg, rawArgs) => {
            let spoofedDiff, player;
            try {
                const inputData = JSON.parse(rawArgs);
                spoofedDiff = inputData.diff;
                player = inputData.player || 'zezima';
            } catch (err) {
                msg.channel.send(`\`${err.toString()}\``);
                return;
            }
            updatePlayer(player, spoofedDiff);
        },
        hidden: true,
        text: 'Spoof an update notification using a raw JSON object {player, diff}'
    },
    kill: {
        fn: (msg) => {
            if (ownerIds.has(msg.author.id)) {
                msg.channel.send('Killing self...').then(() => {
                    process.exit(1);
                });
            } else {
                msg.channel.send('You can\'t do that');
            }
        },
        hidden: true,
        text: 'Kills the bot'
    }
};

// Initialize Discord Bot
var client = new Discord.Client({
    messageCacheMaxSize: 20,
    messageCacheLifetime: 300,
    messageSweepInterval: 300
});

client.on('ready', async () => {
    log.push(`Logged in as: ${client.user.tag}`);
    log.push(`Config=${JSON.stringify(config)}`);
    const guild = client.guilds.first();
    const owner = guild.members.get(guild.ownerID);
    ownerIds.add(guild.ownerID);
    const ownerDmChannel = await owner.createDM();
    trackingChannel = ownerDmChannel;
    Promise.all([
        storage.readJson('players'),
        storage.read('channel')
    ]).then(([savedPlayers, savedChannelId]) => {
        // Add saved players to queue
        players.addAll(savedPlayers);
        updatePlayers(savedPlayers);
        log.push(`Loaded up players ${players.toString()}`);
        // Attempt to set saved channel as tracking channel
        const channels = client.channels;
        if (channels.has(savedChannelId)) {
            trackingChannel = channels.get(savedChannelId);
            log.push(`Loaded up tracking channel "${trackingChannel.name}" with ID "${savedChannelId}"`);
        } else {
            log.push(`Invalid tracking channel ID "${savedChannelId}", defaulting to guild owner's DM channel`);
        }
        sendRestartMessage(ownerDmChannel);
    }).catch((err) => {
        log.push(`Failed to load players or tracking channel: ${err.toString()}`);
        sendRestartMessage(ownerDmChannel);
    });
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
        } else if (!command) {
            msg.channel.send(`What\'s up <@${msg.author.id}>`);
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
