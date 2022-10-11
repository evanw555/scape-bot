import { sendUpdateMessage, updatePlayer } from './util';
import { FORMATTED_BOSS_NAMES, Boss, BOSSES } from 'osrs-json-hiscores';
import { exec } from 'child_process';
import { sanitizeBossName, getBossName, isValidBoss } from './boss-utility';
import { AnyObject, Command, PlayerHiScores, ScapeBotConfig, ScapeBotConstants } from './types';
import { Message, Snowflake } from 'discord.js';
import { loadJson, randChoice, randInt } from 'evanw555.js';
import { fetchHiScores } from './hiscores';

import state from './state';
import logger from './log';
import capacityLog from './capacity-log';
import { SKILLS_NO_OVERALL } from './constants';

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
        fn: async (msg, rawArgs) => {
            const rsn = rawArgs && rawArgs.toLowerCase();
            if (!rsn || !rsn.trim()) {
                msg.channel.send('Invalid username');
                return;
            }
            // Retrieve the player's hiscores data
            fetchHiScores(rsn).then((data: PlayerHiScores) => {
                let messageText = '';
                // Create skills message text
                const totalLevel: string = (data.totalLevel ?? '???').toString();
                const baseLevel: string = (data.baseLevel ?? '???').toString();
                messageText += `${SKILLS_NO_OVERALL.map(skill => `**${data.levels[skill] ?? '?'}** ${skill}`).join('\n')}\n\nTotal **${totalLevel}**\nBase **${baseLevel}**`;
                // Create bosses message text if there are any bosses with kills
                if (Object.keys(data.bosses).length > 0) {
                    messageText += '\n\n' + BOSSES.filter(boss => boss in data.bosses).map(boss => `**${data.bosses[boss]}** ${getBossName(boss)}`).join('\n');
                }
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
        fn: (msg, rawArgs, rsn, bossArg) => {
            if (!rsn || !rsn.trim() || !bossArg || !bossArg.trim()) {
                msg.channel.send('`kc` command must look like `kc [player] [boss]`');
                return;
            }
            // TODO: Can we refactor our utility to use more osrs-json-hiscores constants?
            if (!isValidBoss(bossArg)) {
                msg.channel.send(`\`${bossArg}\` is not a valid boss`);
                return;
            }
            const boss: Boss = sanitizeBossName(bossArg);
            // Retrieve the player's hiscores data
            fetchHiScores(rsn).then((data: PlayerHiScores) => {
                // Create boss message text
                const messageText = boss in data.bosses
                    ? `**${rsn}** has killed **${getBossName(boss)}** **${data.bosses[boss]}** times`
                    : `I don't know how many **${getBossName(boss)}** kills **${rsn}** has`;
                // TODO: Should we change how we map boss names to thumbnails? Seems like there are currently 3 formats...
                sendUpdateMessage([msg.channel], messageText, getBossName(boss), {
                    title: getBossName(boss),
                    url: `${constants.osrsWikiBaseUrl}${encodeURIComponent(getBossName(boss))}`,
                    color: 10363483
                });
            }).catch((err) => {
                logger.log(`Error while fetching hiscores (check) for player ${rsn}: ${err.toString()}`);
                msg.channel.send(`Couldn't fetch hiscores for player **${rsn}** :pensive:\n\`${err.toString()}\``);
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
                    .concat(SKILLS_NO_OVERALL)
                    .concat(SKILLS_NO_OVERALL); // Add it again to make it more likely (there are too many bosses)
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
