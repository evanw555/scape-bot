import { replyUpdateMessage, sendUpdateMessage, updatePlayer } from './util';
import { FORMATTED_BOSS_NAMES, Boss, BOSSES } from 'osrs-json-hiscores';
import { exec } from 'child_process';
import { sanitizeBossName, getBossName, isValidBoss } from './boss-utility';
import { Command, PlayerHiScores, CommandName } from './types';
import { ApplicationCommandOptionType, ChatInputCommandInteraction, Message, Snowflake, TextBasedChannel } from 'discord.js';
import { randChoice, randInt } from 'evanw555.js';
import { fetchHiScores } from './hiscores';
import capacityLog from './capacity-log';
import { CLUES_NO_ALL, SKILLS_NO_OVERALL, CONSTANTS, CONFIG } from './constants';
import { deleteTrackedPlayer, insertTrackedPlayer, updateTrackingChannel } from './pg-storage';

import state from './instances/state';
import logger from './instances/logger';

const validSkills = new Set<string>(CONSTANTS.skills);

const getHelpText = (hidden?: boolean) => {
    const unfilteredCommandKeys = Object.keys(commands) as CommandName[];
    const commandKeys = unfilteredCommandKeys
        .filter((key: CommandName) => !!commands[key].hidden === !!hidden);
    commandKeys.sort();
    const maxLengthKey = Math.max(...commandKeys.map((key) => {
        return key.length;
    }));
    const innerText = commandKeys
        .map((key: CommandName) => `${key.padEnd(maxLengthKey)} :: ${commands[key].text}`)
        .join('\n');
    return `\`\`\`asciidoc\n${innerText}\`\`\``;
};

export const INVALID_TEXT_CHANNEL = 'err/invalid-text-channel';

const getInteractionGuildId = (interaction: ChatInputCommandInteraction): string => {
    if (typeof interaction.guildId !== 'string') {
        throw new Error(INVALID_TEXT_CHANNEL);
    }
    return interaction.guildId;
};

const commands: Record<CommandName, Command> = {
    ping: {
        execute: async (interaction) => {
            await interaction.reply('pong!');
        },
        text: 'Replies with pong!'
    },
    help: {
        fn: (msg) => {
            msg.channel.send(getHelpText(false));
        },
        text: 'Shows help'
    },
    track: {
        fn: async (msg) => {
            await msg.channel.send('Use the **/track** command');
        },
        options: [{
            type: ApplicationCommandOptionType.String,
            name: 'username',
            description: 'Username',
            required: true
        }],
        execute: async (interaction) => {
            const guildId = getInteractionGuildId(interaction);
            const rsn = interaction.options.getString('username', true);
            if (!rsn || !rsn.trim()) {
                await interaction.reply({ content: 'Invalid username', ephemeral: true });
                return;
            }
            if (state.isTrackingPlayer(guildId, rsn)) {
                await interaction.reply({ content: 'That player is already being tracked', ephemeral: true });
            } else {
                await insertTrackedPlayer(guildId, rsn);
                state.addTrackedPlayer(guildId, rsn);
                await updatePlayer(rsn);
                await interaction.reply(`Now tracking player **${rsn}**`);
            }
        },
        text: 'Tracks a player and gives updates when they level up',
        failIfDisabled: true
    },
    remove: {
        fn: async (msg) => {
            await msg.channel.send('Use the **/remove** command');
        },
        options: [{
            type: ApplicationCommandOptionType.String,
            name: 'username',
            description: 'Username',
            required: true
        }],
        execute: async (interaction) => {
            const guildId = getInteractionGuildId(interaction);
            const rsn = interaction.options.getString('username', true);
            if (!rsn || !rsn.trim()) {
                await interaction.reply({ content: 'Invalid username', ephemeral: true });
                return;
            }
            if (state.isTrackingPlayer(guildId, rsn)) {
                await deleteTrackedPlayer(guildId, rsn);
                state.removeTrackedPlayer(guildId, rsn);
                await interaction.reply(`No longer tracking player **${rsn}**`);
            } else {
                await interaction.reply({ content: 'That player is not currently being tracked', ephemeral: true });
            }
        },
        text: 'Stops tracking a player',
        failIfDisabled: true
    },
    clear: {
        fn: async (msg) => {
            await msg.channel.send('Use the **/clear** command');
        },
        execute: async (interaction) => {
            const guildId = getInteractionGuildId(interaction);
            // TODO: Can we add a batch delete operation?
            for (const rsn of state.getAllTrackedPlayers(guildId)) {
                await deleteTrackedPlayer(guildId, rsn);
            }
            state.clearAllTrackedPlayers(guildId);
            await interaction.reply({ content: 'No longer tracking any players', ephemeral: true });
        },
        text: 'Stops tracking all players',
        privileged: true,
        failIfDisabled: true
    },
    list: {
        fn: async (msg) => {
            await msg.channel.send('Use the **/list** command');
        },
        execute: async (interaction) => {
            const guildId = getInteractionGuildId(interaction);
            if (state.isTrackingAnyPlayers(guildId)) {
                await interaction.reply({
                    content: `Currently tracking players **${state.getAllTrackedPlayers(guildId).join('**, **')}**`,
                    ephemeral: true
                });
            } else {
                interaction.reply({ content: 'Currently not tracking any players', ephemeral: true });
            }
        },
        text: 'Lists all the players currently being tracked'
    },
    check: {
        fn: async (msg) => {
            await msg.channel.send('Use the **/check** command');
        },
        options: [{
            type: ApplicationCommandOptionType.String,
            name: 'username',
            description: 'Username',
            required: true
        }],
        execute: async (interaction) => {
            const rsn = interaction.options.getString('username', true);
            try {
                // Retrieve the player's hiscores data
                const data = await fetchHiScores(rsn);
                let messageText = '';
                // Create skills message text
                const totalLevel: string = (data.totalLevel ?? '???').toString();
                const baseLevel: string = (data.baseLevel ?? '???').toString();
                messageText += `${SKILLS_NO_OVERALL.map(skill => `**${data.levels[skill] ?? '?'}** ${skill}`).join('\n')}\n\nTotal **${totalLevel}**\nBase **${baseLevel}**`;
                // Create bosses message text if there are any bosses with one or more kills
                if (BOSSES.some(boss => data.bosses[boss])) {
                    messageText += '\n\n' + BOSSES.filter(boss => data.bosses[boss]).map(boss => `**${data.bosses[boss]}** ${getBossName(boss)}`).join('\n');
                }
                // Create clues message text if there are any clues with a score of one or greater
                if (CLUES_NO_ALL.some(clue => data.clues[clue])) {
                    messageText += '\n\n' + CLUES_NO_ALL.filter(clue => data.clues[clue]).map(clue => `**${data.clues[clue]}** ${clue}`).join('\n');
                }
                replyUpdateMessage(interaction, messageText, 'overall', {
                    title: rsn,
                    url: `${CONSTANTS.hiScoresUrlTemplate}${encodeURI(rsn)}`
                });
            } catch (err) {
                if (err instanceof Error) {
                    logger.log(`Error while fetching hiscores (check) for player ${rsn}: ${err.toString()}`);
                    interaction.reply(`Couldn't fetch hiscores for player **${rsn}** :pensive:\n\`${err.toString()}\``);
                }
            }
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
                    url: `${CONSTANTS.osrsWikiBaseUrl}${encodeURIComponent(getBossName(boss))}`,
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
        fn: async (msg) => {
            await msg.channel.send('Use the **/channel** command');
        },
        execute: async (interaction) => {
            const guildId = getInteractionGuildId(interaction);
            await updateTrackingChannel(guildId, interaction.channelId);
            const textChannel = interaction.channel as TextBasedChannel;
            state.setTrackingChannel(guildId, textChannel);
            await interaction.reply('Player experience updates will now be sent to this channel');
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
                msg.channel.send(`${sortedPlayers.map(rsn => `**${rsn}**: last updated **${state.getLastUpdated(rsn)?.toLocaleTimeString('en-US', { timeZone: CONFIG.timeZone })}**`).join('\n')}`);
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
    // TODO: We need to re-enable this somehow, perhaps we can just create a view into the state object?
    // state: {
    //     fn: (msg: Message, rawArgs: string) => {
    //         // TODO: We should be a bit stricter with our type guards for state
    //         let selectedState: AnyObject = state.serialize();
    //         // We have to use rawArgs because the args are made lower-case...
    //         const selector: string = rawArgs.trim();
    //         if (selector) {
    //             // If a selector was specified, select a specific part of the state
    //             const selectors: string[] = selector.split('.');
    //             for (const s of selectors) {
    //                 if (Object.prototype.hasOwnProperty.call(selectedState, s)) {
    //                     selectedState = selectedState[s];
    //                 } else {
    //                     msg.reply(`\`${selector}\` is not a valid state selector! (failed at \`${s}\`)`);
    //                     return;
    //                 }
    //             }
    //         } else {
    //             // In case we're looking at the root state, truncate the large objects
    //             // TODO: we could make this more general
    //             selectedState.levels = `Map with ${Object.keys(selectedState.levels).length} entries, truncated to save space.`;
    //             selectedState.bosses = `Map with ${Object.keys(selectedState.bosses).length} entries, truncated to save space.`;
    //         }
    //         // Reply to the user with the state (or with an error message)
    //         msg.reply(`\`\`\`${JSON.stringify(selectedState, null, 2)}\`\`\``)
    //             .catch((reason) => {
    //                 msg.reply(`Could not serialize state:\n\`\`\`${reason.toString()}\`\`\``);
    //             });
    //     },
    //     hidden: true,
    //     text: 'Prints the bot\'s state',
    //     privileged: true
    // },
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
