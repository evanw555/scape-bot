const Discord = require('discord.js');
const osrs = require('osrs-json-api');

const CircularQueue = require('./circular-queue');
const CapacityLog = require('./capacity-log');
const Storage = require('./storage');
const BossUtility = require('./boss-utility');

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

const getThumbnail = (name, args) => {
    if (validSkills.has(name)) {
        const skill = name;
        return {
            url: `${constants.baseThumbnailUrl}${(args && args.is99) ? constants.level99Path : ''}${skill}${constants.imageFileExtension}`
        };
    } 
    if (BossUtility.isValidBoss(name)) {
        const boss = name;
        const thumbnailBoss = boss.replace(/[^a-zA-Z ]/g, '').replace(/ /g,'_').toLowerCase();
        return {
            url: `${constants.baseThumbnailUrl}${thumbnailBoss}${constants.imageFileExtension}`
        };
    }
    return;
};

const savePlayers = () => {
    storage.write('players', players.toString()).catch((err) => {
        log.push(`Unable to save players '${players.toString()}': ${err.toString()}`);
    });
};

const saveChannel = () => {
    storage.write('channel', trackingChannel.id).catch((err) => {
        log.push(`Unable to save tracking channel: ${err.toString()}`);
    });
};

const sendUpdateMessage = (channel, text, name, args) => {
    channel.send({
        embed: {
            description: text,
            thumbnail: getThumbnail(name, args),
            color: (args && args.color) || 6316287,
            title: args && args.title,
            url: args && args.url
        }
    });
};

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

// input: 3
// expected output: 0,1,2
const getRandomInt = (max) => {
    return Math.floor(Math.random() * Math.floor(max));
};

const computeDiff = (before, after) => {
    const counts = Object.keys(before);
    const diff = {};
    counts.forEach((kind) => {
        if (before[kind] !== after[kind]) {
            const thisDiff = after[kind] - before[kind];
            if (typeof thisDiff !== 'number' || isNaN(thisDiff) || thisDiff < 0) {
                throw new Error(`Invalid ${kind} diff, '${after[kind]}' minus '${before[kind]}' is '${thisDiff}'`);
            }
            diff[kind] = thisDiff;
        }
    });
    return diff;
};

const parsePlayerPayload = (payload) => {
    const result = {
        skills: {},
        bosses: {}
    };
    Object.keys(payload.skills).forEach((skill) => {
        if (skill !== 'overall') {
            const rawLevel = payload.skills[skill].level;
            const level = parseInt(rawLevel);
            if (typeof level !== 'number' || isNaN(level) || level < 1) {
                throw new Error(`Invalid ${skill} level, '${rawLevel}' parsed to ${level}.\nPayload: ${JSON.stringify(payload.skills)}`);
            }
            result.skills[skill] = level;
        }
    });
    Object.keys(payload.bosses).forEach((bossName) => {
        const bossID = BossUtility.sanitizeBossName(bossName);
        const rawKillCount = payload.bosses[bossName].score;
        const killCount = parseInt(rawKillCount);
        if (typeof killCount !== 'number' || isNaN(killCount)) {
            throw new Error(`Invalid ${bossID} boss, '${rawKillCount}' parsed to ${killCount}.\nPayload: ${JSON.stringify(payload.bosses)}`);
        }
        if (killCount < 0) {
            result.bosses[bossID] = 0;
            return;
        }
        result.bosses[bossID] = killCount;
    });
    return result;
};

const updateLevels = (player, newLevels, spoofedDiff) => {
    // If channel is set and user already has levels tracked
    if (trackingChannel && levels.hasOwnProperty(player)) {
        // Compute diff for each level
        let diff;
        try {
            if (spoofedDiff) {
                diff = {};
                Object.keys(spoofedDiff).forEach((skill) => {
                    if (validSkills.has(skill)) {
                        diff[skill] = spoofedDiff[skill];
                        newLevels[skill] += diff[skill];
                    }
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
            case 1: {
                const skill = Object.keys(diff)[0];
                const levelsGained = diff[skill];
                sendUpdateMessage(trackingChannel,
                    `**${player}** has gained `
                        + (levelsGained === 1 ? 'a level' : `**${levelsGained}** levels`)
                        + ` in **${skill}** and is now level **${newLevels[skill]}**`,
                    skill);
                break;
            }
            default: {
                const text = Object.keys(diff).toSortedSkills().map((skill) => {
                    const levelsGained = diff[skill];
                    return `${levelsGained === 1 ? 'a level' : `**${levelsGained}** levels`} in **${skill}** and is now level **${newLevels[skill]}**`;
                }).join('\n');
                sendUpdateMessage(trackingChannel, `**${player}** has gained...\n${text}`, 'overall');
                break;
            }
        }
    }
    // If not spoofing the diff, update player's levels
    if (!spoofedDiff) {
        levels[player] = newLevels;
        lastUpdate[player] = new Date();
    }
};

const updateKillCounts = (player, killCounts, spoofedDiff) => {
    // If channel is set and user already has bosses tracked
    if (trackingChannel && bosses.hasOwnProperty(player)) {
        // Compute diff for each boss
        let diff;
        try {
            if (spoofedDiff) {
                diff = {};
                Object.keys(spoofedDiff).forEach((bossID) => {
                    if (BossUtility.isValidBoss(bossID)) {
                        diff[bossID] = spoofedDiff[bossID];
                        killCounts[bossID] += diff[bossID];
                    }
                });
            } else {
                diff = computeDiff(bosses[player], killCounts);
            }
        } catch (err) {
            log.push(`Failed to compute boss KC diff for player ${player}: ${err.toString()}`);
            return;
        }
        if (!diff) {
            return;
        }
        // Send a message showing all the incremented boss KCs
        const dopeKillVerbs = [
            'has killed',
            'killed',
            'has slain',
            'slew',
            'slaughtered',
            'butchered'
        ];
        const dopeKillVerb = dopeKillVerbs[getRandomInt(dopeKillVerbs.length)];
        switch (Object.keys(diff).length) {
            case 0:
                break;
            case 1: {
                const bossID = Object.keys(diff)[0];
                const killCountIncrease = diff[bossID];
                const bossName = BossUtility.getBossName(bossID);
                const text = killCounts[bossID] === 1
                    ? `**${player}** has slain **${bossName}** for the first time!`
                    : `**${player}** ${dopeKillVerb} **${bossName}** `
                        + (killCountIncrease === 1 ? 'again' : `**${killCountIncrease}** more times`)
                        + ` and is now at **${killCounts[bossID]}** kills`;
                sendUpdateMessage(trackingChannel, text, bossID, {color: 10363483});
                break;
            }
            default: {
                const sortedBosses = Object.keys(diff).toSortedBosses();
                const text = sortedBosses.map((bossID) => {
                    const killCountIncrease = diff[bossID];
                    const bossName = BossUtility.getBossName(bossID);
                    return killCounts[bossID] === 1
                        ? `**${bossName}** for the first time!`
                        : `**${bossName}** ${killCountIncrease === 1 ? 'again' : `**${killCountIncrease}** more times`} and is now at **${killCounts[bossID]}**`;
                }).join('\n');
                sendUpdateMessage(trackingChannel, `**${player}** has killed...\n${text}`, sortedBosses[0], {color: 10363483});
                break;
            }
        }
    }
    // If not spoofing the diff, update player's kill counts
    if (!spoofedDiff) {
        bosses[player] = killCounts;
        lastUpdate[player] = new Date();
    }
};

const updatePlayer = (player, spoofedDiff) => {
    // Retrieve the player's hiscores data
    osrs.hiscores.getPlayer(player).then((value) => {
        // Parse the player's hiscores data
        let playerData;
        try {
            playerData = parsePlayerPayload(value);
        } catch (err) {
            log.push(`Failed to parse payload for player ${player}: ${err.toString()}`);
            return;
        }

        updateLevels(player, playerData.skills, spoofedDiff);
        updateKillCounts(player, playerData.bosses, spoofedDiff);
        
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
    if (channel) {
        // Send greeting message to some channel
        const baseText = `ScapeBot online in channel **${trackingChannel && trackingChannel.name}**, currently`;
        if (players.isEmpty()) {
            channel.send(`${baseText} not tracking any players`);
        } else {
            channel.send(`${baseText} tracking players **${players.toSortedArray().join('**, **')}**`);
        }
    } else {
        log.push('Attempted to send a bot restart message, but the specified channel is undefined!');
    }
};

let players = new CircularQueue();
const levels = {};
const bosses = {};
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
                delete bosses[player];
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
                msg.channel.send(`Currently tracking players **${players.toSortedArray().join('**, **')}**`);
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
                // Parse the player's hiscores data
                let playerData;
                try {
                    playerData = parsePlayerPayload(value);
                } catch (err) {
                    log.push(`Failed to parse hiscores payload for player ${player}: ${err.toString()}`);
                    return;
                }
                let messageText = '';
                // Create skills message text
                const currentLevels = playerData.skills;
                const skills = Object.keys(currentLevels).toSortedSkills();
                const baseLevel = Math.min(...Object.values(currentLevels));
                const totalLevel = Object.values(currentLevels).reduce((x,y) => { return x + y; });
                messageText += `${skills.map(skill => `**${currentLevels[skill]}** ${skill}`).join('\n')}\n\nTotal **${totalLevel}**\nBase **${baseLevel}**`;
                // Create bosses message text
                const killCounts = playerData.bosses;
                const kcBosses = Object.keys(killCounts).toSortedBosses().filter(boss => killCounts[boss]);
                if (kcBosses.length) {
                    messageText += '\n\n';
                }
                messageText += `${kcBosses.map(boss => `**${killCounts[boss]}** ${boss}`).join('\n')}`;
                sendUpdateMessage(msg.channel, messageText, 'overall', {
                    title: player,
                    url: `${constants.hiScoresUrlTemplate}${encodeURI(player)}`
                });
            }).catch((err) => {
                log.push(`Error while fetching hiscores (check) for player ${player}: ${err.toString()}`);
                msg.channel.send(`Couldn't fetch hiscores for player **${player}** :pensive:\n\`${err.toString()}\``);
            });
        },
        text: 'Show the current levels for some player'
    },
    kc: {
        fn: (msg, rawArgs, player, boss) => {
            if (!player || !player.trim() || !boss || !boss.trim()) {
                msg.channel.send('`kc` command must look like `kc [player] [boss]`');
                return;
            }
            if (!BossUtility.isValidBoss(boss)) {
                msg.channel.send(`'${boss}' is not a valid boss`);
                return;
            }
            // Retrieve the player's hiscores data
            osrs.hiscores.getPlayer(player).then((value) => {
                // Parse the player's hiscores data
                let playerData;
                try {
                    playerData = parsePlayerPayload(value);
                } catch (err) {
                    log.push(`Failed to parse hiscores payload for player ${player}: ${err.toString()}`);
                    return;
                }
                // Create boss message text
                const killCounts = playerData.bosses;
                const bossID = BossUtility.sanitizeBossName(boss);
                const bossName = BossUtility.getBossName(bossID);
                const messageText = `**${player}** has killed **${bossName}** **${killCounts[bossID]}** times`;
                sendUpdateMessage(msg.channel, messageText, bossID, {
                    title: bossName,
                    url: `${constants.osrsWikiBaseUrl}${encodeURIComponent(bossName)}`,
                    color: 10363483
                });
            }).catch((err) => {
                log.push(`Error while fetching hiscores (check) for player ${player}: ${err.toString()}`);
                msg.channel.send(`Couldn't fetch hiscores for player **${player}** :pensive:\n\`${err.toString()}\``);
            });
        },
        text: 'Show kill count of a boss for some player'
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
                msg.channel.send(`${sortedPlayers.map(player => `**${player}**: last updated **${lastUpdate[player] && lastUpdate[player].toLocaleTimeString('en-US', {timeZone: config.timeZone})}**`).join('\n')}`);
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
        fn: (msg, rawArgs, name) => {
            if (validSkills.has(name)) {
                sendUpdateMessage(msg.channel, 'Here is the thumbnail', name, {
                    title: name
                });
            } else if (BossUtility.isValidBoss(name)) {
                sendUpdateMessage(msg.channel, 'Here is the thumbnail', name, {
                    title: name
                });
            } else {
                msg.channel.send(`**${name || '[none]'}** does not have a thumbnail`);
            }
        },
        hidden: true,
        text: 'Displays a skill or boss\' thumbnail'
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
        text: 'Spoof an update notification using a raw JSON object {player, diff: {skills|bosses}}'
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
    // TODO: This isn't working for now, I think it's because of something called "Intents"
    // May need to update discord.js...
    let ownerDmChannel;
    if (owner) {
        ownerIds.add(guild.ownerID);
        ownerDmChannel = await owner.createDM();
        trackingChannel = ownerDmChannel;
    } else {
        log.push('Could not determine the guild\'s owner!');
    }
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
            log.push(`Loaded up tracking channel '${trackingChannel.name}' with ID '${savedChannelId}'`);
        } else if (trackingChannel && trackingChannel === ownerDmChannel) {
            log.push(`Invalid tracking channel ID '${savedChannelId}', defaulting to guild owner's DM channel`);
        } else {
            log.push('Could determine neither the guild owner\'s DM channel nor the saved tracking channel. Please set it using commands.');
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
