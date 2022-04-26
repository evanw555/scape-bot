// import { Message } from "../node_modules/discord.js/typings/index";
import state from './state.js';
import log from './log.js';
import { updatePlayer, parsePlayerPayload, sendUpdateMessage, toSortedSkills, patchMissingLevels, patchMissingBosses } from './util.js';

import hiscores, { Player } from 'osrs-json-hiscores';

import { exec } from 'child_process';
import { toSortedBosses, sanitizeBossName, getBossName, isValidBoss } from './boss-utility.js';

import { loadJson } from './load-json.js';
import { Command, PlayerPayload } from './types.js';
import { Message } from 'discord.js';
const config = loadJson('config/config.json');
const constants = loadJson('static/constants.json');

const validSkills = new Set(constants.skills);

const getHelpText = (hidden?: boolean) => {
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

const commands: Record<string, Command> = {
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
            if (state.isTrackingPlayer(player)) {
                msg.channel.send('That player is already being tracked');
            } else {
                state.addTrackedPlayer(player);
                updatePlayer(player);
                msg.channel.send(`Now tracking player **${player}**`);
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
            if (state.isTrackingPlayer(player)) {
                state.removeTrackedPlayer(player);
                msg.channel.send(`No longer tracking player **${player}**`);
            } else {
                msg.channel.send('That player is not currently being tracked');
            }
        },
        text: 'Stops tracking a player'
    },
    clear: {
        fn: (msg) => {
            state.clearAllTrackedPlayers();
            msg.channel.send('No longer tracking any players');
        },
        text: 'Stops tracking all players'
    },
    list: {
        fn: (msg) => {
            if (state.isTrackingAnyPlayers()) {
                msg.channel.send(`Currently tracking players **${state.getAllTrackedPlayers().join('**, **')}**`);
            } else {
                msg.channel.send('Currently not tracking any players');
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
            hiscores.getStats(player).then((value: Player) => {
                // Parse the player's hiscores data
                let playerData: Record<string, Record<string, number>>;
                try {
                    playerData = parsePlayerPayload(value);
                } catch (err) {
                    log.push(`Failed to parse hiscores payload for player ${player}: ${err.toString()}`);
                    return;
                }
                let messageText = '';
                // Create skills message text
                const currentLevels: Record<string, number> = patchMissingLevels(player, playerData.skills);
                const skills = toSortedSkills(Object.keys(currentLevels));
                const baseLevel = Math.min(...Object.values(currentLevels).filter((x) => !isNaN(x)));
                const totalLevel = Object.values(currentLevels).filter((x) => !isNaN(x)).reduce((x: number, y: number) => { return x + y; });
                const totalLevelText = Object.values(currentLevels).some((x) => isNaN(x)) ? `${totalLevel} (?)` : totalLevel;
                messageText += `${skills.map(skill => `**${isNaN(currentLevels[skill]) ? '?' : currentLevels[skill]}** ${skill}`).join('\n')}\n\nTotal **${totalLevelText}**\nBase **${baseLevel}**`;
                // Create bosses message text
                const killCounts = playerData.bosses;
                const kcBosses = toSortedBosses(Object.keys(killCounts)).filter(boss => killCounts[boss]);
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
            if (!isValidBoss(boss)) {
                msg.channel.send(`'${boss}' is not a valid boss`);
                return;
            }
            // Retrieve the player's hiscores data
            hiscores.getStats(player).then((value: Player) => {
                // Parse the player's hiscores data
                let playerData;
                try {
                    playerData = parsePlayerPayload(value);
                } catch (err) {
                    log.push(`Failed to parse hiscores payload for player ${player}: ${err.toString()}`);
                    return;
                }
                // Create boss message text
                const killCounts: Record<string, number> = patchMissingBosses(player, playerData.bosses);
                const bossID = sanitizeBossName(boss);
                const bossName = getBossName(bossID);
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
            state.setTrackingChannel(msg.channel);
            msg.channel.send('Player experience updates will now be sent to this channel');
        },
        text: 'All player updates will be sent to the channel where this command is issued',
        privileged: true
    },
    hiddenhelp: {
        fn: (msg) => {
            msg.channel.send(getHelpText(true));
        },
        hidden: true,
        text: 'Shows help for hidden commands',
        privileged: true
    },
    details: {
        fn: (msg) => {
            if (state.isTrackingAnyPlayers()) {
                const sortedPlayers = state.getAllTrackedPlayers();
                msg.channel.send(`${sortedPlayers.map(player => `**${player}**: last updated **${state._lastUpdate[player] && state._lastUpdate[player].toLocaleTimeString('en-US', {timeZone: config.timeZone})}**`).join('\n')}`);
            } else {
                msg.channel.send('Currently not tracking any players');
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
            } else if (isValidBoss(name)) {
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
    spoofverbose: {
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
    spoof: {
        fn: (msg, rawArgs, player) => {
            if (player) {
                const possibleKeys = Object.keys(constants.bossNamesMap)
                    .concat(constants.skills)
                    .concat(constants.skills) // Add it again to make it more likely (there are too many bosses)
                    .filter(skill => skill != 'overall');
                const numUpdates = Math.floor(Math.random() * 5) + 1;
                const spoofedDiff = {};
                for (let i = 0; i < numUpdates; i++) {
                    const randomKey = possibleKeys[Math.floor(Math.random() * possibleKeys.length)];
                    spoofedDiff[randomKey] = Math.floor(Math.random() * 3) + 1;
                }
                updatePlayer(player, spoofedDiff);
            } else {
                msg.channel.send('Usage: spoof PLAYER');
            }
        },
        hidden: true,
        text: 'Spoof an update notification for some player with random skill/boss updates'
    },
    uptime: {
        fn: (msg) => {
            exec('uptime --pretty', (error, stdout, stderr) => {
                if (error) {
                    msg.channel.send(`\`\`\`\n${error.message}\n\`\`\``);
                    return;
                } else if (stderr) {
                    msg.channel.send(`\`\`\`\n${stderr}\n\`\`\``);
                    return;
                } else {
                    msg.channel.send(`\`${stdout}\``);
                }
            });
        },
        hidden: true,
        text: 'Show the uptime of the host (not the bot)'
    },
    kill: {
        fn: (msg) => {
            const phrases = [
                'Killing self',
                'Dying',
                'Dead',
                'I will die',
                'As you wish'
            ];
            const phrase = phrases[Math.floor(Math.random() * phrases.length)];
            msg.channel.send(`${phrase}... 💀`).then(() => {
                process.exit(1);
            });
        },
        hidden: true,
        text: 'Kills the bot',
        privileged: true
    },
    state: {
        fn: (msg: Message, rawArgs: string) => {
            let selectedState: any = state.serialize();
            // We have to use rawArgs because the args are made lower-case...
            const selector: string = rawArgs.trim();
            if (selector) {
                // If a selector was specified, select a specific part of the state
                const selectors: string[] = selector.split('.');
                for (var s of selectors) {
                    if (selectedState.hasOwnProperty(s)) {
                        selectedState = selectedState[s];
                    } else {
                        msg.reply(`\`${selector}\` is not a valid state selector! (failed at \`${s}\`)`);
                        return;
                    }
                }
            } else {
                // In case we're looking at the root state, truncate the large objects
                // TODO: we could make this more general
                selectedState.levels = `Map with ${Object.keys(selectedState.levels).length} entries, truncated to save space.`;
                selectedState.bosses = `Map with ${Object.keys(selectedState.bosses).length} entries, truncated to save space.`;
            }
            // Reply to the user with the state (or with an error message)
            msg.reply(`\`\`\`${JSON.stringify(selectedState, null, 2)}\`\`\``)
                .catch((reason) => {
                    msg.reply(`Could not serialize state:\n\`\`\`${reason.toString()}\`\`\``);
                });
        },
        hidden: true,
        text: 'Prints the bot\'s state',
        privileged: true
    }
};

export default commands;
