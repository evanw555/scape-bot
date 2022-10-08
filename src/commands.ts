import { updatePlayer, parsePlayerPayload, sendUpdateMessage, toSortedSkills, patchMissingLevels, patchMissingBosses } from './util';
import hiscores, { FORMATTED_BOSS_NAMES, Player, Boss } from 'osrs-json-hiscores';
import { exec } from 'child_process';
import { toSortedBosses, sanitizeBossName, getBossName, isValidBoss } from './boss-utility';
import { AnyObject, Command, ScapeBotConfig, ScapeBotConstants } from './types';
import { Message, Snowflake } from 'discord.js';
import { loadJson, randChoice, randInt } from 'evanw555.js';

import state from './state';
import logger from './log';
import capacityLog from './capacity-log';

const config: ScapeBotConfig = loadJson('config/config.json');
const constants: ScapeBotConstants = loadJson('static/constants.json');

const validSkills = new Set<string>(constants.skills);

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
            const guildId: Snowflake | null = msg.guildId;
            if (!guildId) {
                msg.reply('This command can only be used in a guild text channel!');
                return;
            }

            const rsn = rawArgs && rawArgs.toLowerCase();
            if (!rsn || !rsn.trim()) {
                msg.channel.send('Invalid username');
                return;
            }
            if (state.isTrackingPlayer(guildId, rsn)) {
                msg.channel.send('That player is already being tracked');
            } else {
                state.addTrackedPlayer(guildId, rsn);
                updatePlayer(rsn);
                msg.channel.send(`Now tracking player **${rsn}**`);
            }
        },
        text: 'Tracks a player and gives updates when they level up',
        failIfDisabled: true
    },
    remove: {
        fn: (msg, rawArgs) => {
            const guildId: Snowflake | null = msg.guildId;
            if (!guildId) {
                msg.reply('This command can only be used in a guild text channel!');
                return;
            }

            const rsn = rawArgs && rawArgs.toLowerCase();
            if (!rsn || !rsn.trim()) {
                msg.channel.send('Invalid username');
                return;
            }
            if (state.isTrackingPlayer(guildId, rsn)) {
                state.removeTrackedPlayer(guildId, rsn);
                msg.channel.send(`No longer tracking player **${rsn}**`);
            } else {
                msg.channel.send('That player is not currently being tracked');
            }
        },
        text: 'Stops tracking a player',
        failIfDisabled: true
    },
    clear: {
        fn: (msg) => {
            const guildId: Snowflake | null = msg.guildId;
            if (!guildId) {
                msg.reply('This command can only be used in a guild text channel!');
                return;
            }

            state.clearAllTrackedPlayers(guildId);
            msg.channel.send('No longer tracking any players');
        },
        text: 'Stops tracking all players',
        failIfDisabled: true
    },
    list: {
        fn: (msg) => {
            const guildId: Snowflake | null = msg.guildId;
            if (!guildId) {
                msg.reply('This command can only be used in a guild text channel!');
                return;
            }

            if (state.isTrackingAnyPlayers(guildId)) {
                msg.channel.send(`Currently tracking players **${state.getAllTrackedPlayers(guildId).join('**, **')}**`);
            } else {
                msg.channel.send('Currently not tracking any players');
            }
        },
        text: 'Lists all the players currently being tracked'
    },
    check: {
        fn: (msg, rawArgs) => {
            const rsn = rawArgs && rawArgs.toLowerCase();
            if (!rsn || !rsn.trim()) {
                msg.channel.send('Invalid username');
                return;
            }
            // Retrieve the player's hiscores data
            hiscores.getStats(rsn).then((value: Player) => {
                // Parse the player's hiscores data
                let playerData: Record<string, Record<string, number>>;
                try {
                    playerData = parsePlayerPayload(value);
                } catch (err) {
                    if (err instanceof Error) {
                        logger.log(`Failed to parse hiscores payload for player ${rsn}: ${err.toString()}`);
                    }
                    return;
                }
                let messageText = '';
                // Create skills message text
                const currentLevels: Record<string, number> = patchMissingLevels(rsn, playerData.skills);
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
                messageText += `${kcBosses.map(boss => `**${killCounts[boss]}** ${getBossName(boss as Boss)}`).join('\n')}`;
                sendUpdateMessage([msg.channel], messageText, 'overall', {
                    title: rsn,
                    url: `${constants.hiScoresUrlTemplate}${encodeURI(rsn)}`
                });
            }).catch((err) => {
                logger.log(`Error while fetching hiscores (check) for player ${rsn}: ${err.toString()}`);
                msg.channel.send(`Couldn't fetch hiscores for player **${rsn}** :pensive:\n\`${err.toString()}\``);
            });
        },
        text: 'Show the current levels for some player',
        failIfDisabled: true
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
                    if (err instanceof Error) {
                        logger.log(`Failed to parse hiscores payload for player ${player}: ${err.toString()}`);
                    }
                    return;
                }
                // Create boss message text
                const killCounts: Record<string, number> = patchMissingBosses(player, playerData.bosses);
                const bossID = sanitizeBossName(boss);
                const bossName = getBossName(bossID);
                const messageText = `**${player}** has killed **${bossName}** **${killCounts[bossID]}** times`;
                sendUpdateMessage([msg.channel], messageText, bossID, {
                    title: bossName,
                    url: `${constants.osrsWikiBaseUrl}${encodeURIComponent(bossName)}`,
                    color: 10363483
                });
            }).catch((err) => {
                logger.log(`Error while fetching hiscores (check) for player ${player}: ${err.toString()}`);
                msg.channel.send(`Couldn't fetch hiscores for player **${player}** :pensive:\n\`${err.toString()}\``);
            });
        },
        text: 'Show kill count of a boss for some player',
        failIfDisabled: true
    },
    channel: {
        fn: (msg) => {
            const guildId: Snowflake | null = msg.guildId;
            if (!guildId) {
                msg.reply('This command can only be used in a guild text channel!');
                return;
            }

            state.setTrackingChannel(guildId, msg.channel);
            msg.channel.send('Player experience updates will now be sent to this channel');
        },
        text: 'All player updates will be sent to the channel where this command is issued',
        privileged: true,
        failIfDisabled: true
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
            const guildId: Snowflake | null = msg.guildId;
            if (!guildId) {
                msg.reply('This command can only be used in a guild text channel!');
                return;
            }

            if (state.isTrackingAnyPlayers(guildId)) {
                const sortedPlayers = state.getAllTrackedPlayers(guildId);
                msg.channel.send(`${sortedPlayers.map(rsn => `**${rsn}**: last updated **${state.getLastUpdated(rsn)?.toLocaleTimeString('en-US', { timeZone: config.timeZone })}**`).join('\n')}`);
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
            msg.channel.send(`\`\`\`${capacityLog.toLogArray().join('\n')}\`\`\``);
        },
        hidden: true,
        text: 'Prints the bot\'s log'
    },
    thumbnail: {
        fn: (msg, rawArgs, name) => {
            if (validSkills.has(name)) {
                sendUpdateMessage([msg.channel], 'Here is the thumbnail', name, {
                    title: name
                });
            } else if (isValidBoss(name)) {
                sendUpdateMessage([msg.channel], 'Here is the thumbnail', name, {
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
                sendUpdateMessage([msg.channel], 'Here is the level 99 thumbnail', skill, {
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
                if (err instanceof Error) {
                    msg.channel.send(`\`${err.toString()}\``);
                }
                return;
            }
            updatePlayer(player, spoofedDiff);
        },
        hidden: true,
        text: 'Spoof an update notification using a raw JSON object {player, diff: {skills|bosses}}',
        failIfDisabled: true
    },
    spoof: {
        fn: (msg, rawArgs, player) => {
            if (player) {
                const possibleKeys = Object.keys(FORMATTED_BOSS_NAMES)
                    .concat(constants.skills)
                    .concat(constants.skills) // Add it again to make it more likely (there are too many bosses)
                    .filter(skill => skill != 'overall');
                const numUpdates: number = randInt(1, 6);
                const spoofedDiff: Record<string, number> = {};
                for (let i = 0; i < numUpdates; i++) {
                    const randomKey: string = randChoice(...possibleKeys);
                    spoofedDiff[randomKey] = randInt(1, 4);
                }
                updatePlayer(player, spoofedDiff);
            } else {
                msg.channel.send('Usage: spoof PLAYER');
            }
        },
        hidden: true,
        text: 'Spoof an update notification for some player with random skill/boss updates',
        failIfDisabled: true
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
            const phrase: string = randChoice(...phrases);
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
            // TODO: We should be a bit stricter with our type guards for state
            let selectedState: AnyObject = state.serialize();
            // We have to use rawArgs because the args are made lower-case...
            const selector: string = rawArgs.trim();
            if (selector) {
                // If a selector was specified, select a specific part of the state
                const selectors: string[] = selector.split('.');
                for (const s of selectors) {
                    if (Object.prototype.hasOwnProperty.call(selectedState, s)) {
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
    },
    enable: {
        fn: (msg: Message) => {
            msg.reply('Enabling the bot... If the API format is still not supported, the bot will disable itself.');
            state.setDisabled(false);
        },
        hidden: true,
        text: 'Enables the bot, this should be used after the bot has been disabled due to an incompatible API change',
        privileged: true
    }
};

export default commands;
