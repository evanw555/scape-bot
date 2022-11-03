import { ApplicationCommandOptionType, ChatInputCommandInteraction, Guild, Message, PermissionFlagsBits, TextChannel } from 'discord.js';
import { FORMATTED_BOSS_NAMES, Boss, BOSSES } from 'osrs-json-hiscores';
import { exec } from 'child_process';
import { MultiLoggerLevel, naturalJoin, randChoice, randInt } from 'evanw555.js';
import { PlayerHiScores, SlashCommandsType, HiddenCommandsType, CommandsType, SlashCommand } from './types';
import { replyUpdateMessage, sendUpdateMessage, updatePlayer, getBossName, isValidBoss } from './util';
import { fetchHiScores } from './hiscores';
import CommandHandler from './command-handler';
import { CLUES_NO_ALL, SKILLS_NO_OVERALL, CONSTANTS, CONFIG, BOSS_CHOICES, INVALID_TEXT_CHANNEL, SKILL_EMBED_COLOR } from './constants';

import state from './instances/state';
import logger from './instances/logger';
import pgStorageClient from './instances/pg-storage-client';

import debugLog from './instances/debug-log';
import infoLog from './instances/info-log';

const validSkills = new Set<string>(CONSTANTS.skills);

const getHelpText = (hidden: boolean, isAdmin = false, hasPrivilegedRole = false) => {
    const commands: CommandsType = hidden ? hiddenCommands : slashCommands;
    const commandKeys = Object.keys(commands).filter((key) => {
        if (hidden || isAdmin) {
            return true;
        }
        const command = commands[key] as SlashCommand;
        if (hasPrivilegedRole) {
            return !command.admin;
        }
        return !command.admin && !command.privilegedRole;
    });
    commandKeys.sort();
    const maxLengthKey = Math.max(...commandKeys.map((key) => {
        return key.length;
    }));
    const innerText = commandKeys
        .map(key => `${hidden ? '' : '/'}${key.padEnd(maxLengthKey)} :: ${commands[key].text}`)
        .join('\n');
    return `\`\`\`asciidoc\n${innerText}\`\`\``;
};

const getRoleCommandsListString = (markdown = false): string => {
    const guildCommands = CommandHandler.filterCommands(slashCommands, 'privilegedRole');
    return naturalJoin(guildCommands.map(c => '/' + c), { bold: markdown });
};

const getInteractionGuild = (interaction: ChatInputCommandInteraction): Guild => {
    if (!(interaction.guild instanceof Guild)) {
        throw new Error(INVALID_TEXT_CHANNEL);
    }
    return interaction.guild;
};

const getInteractionGuildId = (interaction: ChatInputCommandInteraction): string => {
    const guild = getInteractionGuild(interaction);
    return guild.id;
};

const slashCommands: SlashCommandsType = {
    ping: {
        execute: async (interaction) => {
            await interaction.reply('pong!');
        },
        text: 'Replies with pong!'
    },
    help: {
        execute: async (interaction) => {
            const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
            const guild = getInteractionGuild(interaction);
            let hasPrivilegedRole;
            if (state.hasPrivilegedRole(guild.id)) {
                const role = guild.roles.cache.get(state.getPrivilegedRole(guild.id).id);
                hasPrivilegedRole = role?.members.has(interaction.user.id);
            }
            await interaction.reply({ content: getHelpText(false, isAdmin, hasPrivilegedRole), ephemeral: true });
        },
        text: 'Shows help'
    },
    info: {
        execute: async (interaction) => {
            const guildId = getInteractionGuildId(interaction);
            await interaction.reply({
                embeds: [{
                    description: `**Players:** ${state.getAllTrackedPlayers(guildId).length}\n`
                               + `**Channel:** ${state.hasTrackingChannel(guildId) ? state.getTrackingChannel(guildId) : 'None'}\n`
                               + `**Role:** ${state.hasPrivilegedRole(guildId) ? state.getPrivilegedRole(guildId) : 'None'}`,
                    color: SKILL_EMBED_COLOR,
                    title: 'Information'
                }],
                ephemeral: true
            });
        },
        text: 'Shows information about ScapeBot in this guild'
    },
    track: {
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
                await interaction.reply({
                    content: 'That player is already being tracked!\nUse **/check** to check their hiscores.',
                    ephemeral: true
                });
            } else {
                await pgStorageClient.insertTrackedPlayer(guildId, rsn);
                state.addTrackedPlayer(guildId, rsn);
                await updatePlayer(rsn);
                await interaction.reply(`Now tracking player **${rsn}**!\nUse **/list** to see tracked players.`);
            }
        },
        text: 'Tracks a player and posts updates when they level up, kill a boss, complete a clue, and more',
        privilegedRole: true,
        failIfDisabled: true
    },
    remove: {
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
                await pgStorageClient.deleteTrackedPlayer(guildId, rsn);
                state.removeTrackedPlayer(guildId, rsn);
                await interaction.reply(`No longer tracking player **${rsn}**.\nYou can still use **/check** to see this player's hiscores.`);
                // If this player is now globally untracked, purge untracked player data
                if (!state.isPlayerTrackedInAnyGuilds(rsn)) {
                    const purgeResults = await pgStorageClient.purgeUntrackedPlayerData();
                    // If any rows were deleted, log this
                    if (Object.keys(purgeResults).length > 0) {
                        await logger.log(`(\`/remove\`) **${rsn}** now globally untracked, purged rows: \`${JSON.stringify(purgeResults)}\``, MultiLoggerLevel.Warn);
                    }
                }
            } else {
                await interaction.reply({ content: 'That player is not currently being tracked.', ephemeral: true });
            }
        },
        text: 'Stops tracking a player',
        privilegedRole: true,
        failIfDisabled: true
    },
    clear: {
        execute: async (interaction) => {
            const guildId = getInteractionGuildId(interaction);
            // TODO: Can we add a batch delete operation?
            const playersToRemove = state.getAllTrackedPlayers(guildId);
            for (const rsn of playersToRemove) {
                await pgStorageClient.deleteTrackedPlayer(guildId, rsn);
            }
            state.clearAllTrackedPlayers(guildId);
            await interaction.reply({ content: 'No longer tracking any players.\nUse **/track** to track more players.', ephemeral: true });
            // If some of the removed players are now globally untracked, purge untracked player data
            const globallyUntrackedPlayers = playersToRemove.filter(rsn => !state.isPlayerTrackedInAnyGuilds(rsn));
            if (globallyUntrackedPlayers.length > 0) {
                const purgeResults = await pgStorageClient.purgeUntrackedPlayerData();
                // If any rows were deleted, log this
                if (Object.keys(purgeResults).length > 0) {
                    await logger.log(`(\`/clear\`) ${naturalJoin(globallyUntrackedPlayers, { bold: true })} now globally untracked, purged rows: \`${JSON.stringify(purgeResults)}\``, MultiLoggerLevel.Warn);
                }
            }
        },
        text: 'Stops tracking all players',
        privilegedRole: true,
        failIfDisabled: true
    },
    list: {
        execute: async (interaction) => {
            const guildId = getInteractionGuildId(interaction);
            if (state.isTrackingAnyPlayers(guildId)) {
                await interaction.reply({
                    content: `Currently tracking players ${naturalJoin(state.getAllTrackedPlayers(guildId), { bold: true })}.\nUse **/track** to track more players!`,
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content: 'Currently not tracking any players.\nUse **/track** to track more players!',
                    ephemeral: true
                });
            }
        },
        text: 'Lists all the players currently being tracked'
    },
    check: {
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
                await replyUpdateMessage(interaction, messageText, 'overall', {
                    title: rsn,
                    url: `${CONSTANTS.hiScoresUrlTemplate}${encodeURI(rsn)}`
                });
            } catch (err) {
                if (err instanceof Error) {
                    logger.log(`Error while fetching hiscores (check) for player ${rsn}: ${err.toString()}`, MultiLoggerLevel.Error);
                    await interaction.reply(`Couldn't fetch hiscores for player **${rsn}** :pensive:\n\`${err.toString()}\``);
                }
            }
        },
        text: 'Shows all available hiscores data for some player',
        failIfDisabled: true
    },
    kc: {
        options: [
            {
                type: ApplicationCommandOptionType.String,
                name: 'username',
                description: 'Username',
                required: true
            },
            {
                type: ApplicationCommandOptionType.String,
                name: 'boss',
                description: 'Boss',
                required: true,
                choices: BOSS_CHOICES
            }
        ],
        execute: async (interaction) => {
            const rsn = interaction.options.getString('username', true);
            // This must be a valid boss, since we define the valid choices
            const boss = interaction.options.getString('boss', true) as Boss;
            try {
                // Retrieve the player's hiscores data
                const data: PlayerHiScores = await fetchHiScores(rsn);
                const bossName = getBossName(boss);
                // Create boss message text
                const messageText = boss in data.bosses
                    ? `**${rsn}** has killed **${bossName}** **${data.bosses[boss]}** times`
                    : `I don't know how many **${bossName}** kills **${rsn}** has`;
                await replyUpdateMessage(interaction, messageText, boss, {
                    title: bossName,
                    url: `${CONSTANTS.osrsWikiBaseUrl}${encodeURIComponent(bossName)}`,
                    color: 10363483
                });
            } catch (err) {
                if (err instanceof Error) {
                    logger.log(`Error while fetching hiscores (check) for player ${rsn}: ${err.toString()}`, MultiLoggerLevel.Error);
                    await interaction.reply({
                        content: `Couldn't fetch hiscores for player **${rsn}** :pensive:\n\`${err.toString()}\``,
                        ephemeral: true
                    });
                }
            }
        },
        text: 'Shows the kill count of a boss for some player',
        failIfDisabled: true
    },
    channel: {
        execute: async (interaction) => {
            const guildId = getInteractionGuildId(interaction);
            if (interaction.channel instanceof TextChannel) {
                await pgStorageClient.updateTrackingChannel(guildId, interaction.channelId);
                state.setTrackingChannel(guildId, interaction.channel);
                await interaction.reply('Player updates will now be sent to this channel!\nUse **/track** to start tracking players.');
            } else {
                await interaction.reply({
                    content: 'This channel cannot be used to track player updates! Please use **/channel** in a valid guild text channel',
                    ephemeral: true
                });
            }
        },
        text: 'All player updates will be sent to the channel where this command is issued',
        privilegedRole: true,
        failIfDisabled: true
    },
    details: {
        execute: async (interaction) => {
            const guildId = getInteractionGuildId(interaction);

            if (state.isTrackingAnyPlayers(guildId)) {
                const sortedPlayers = state.getAllTrackedPlayers(guildId);
                await interaction.reply({
                    content: `${sortedPlayers.map(rsn => `**${rsn}**: last updated **${state.getLastUpdated(rsn)?.toLocaleTimeString('en-US', { timeZone: CONFIG.timeZone })}**`).join('\n')}`,
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content: 'Currently not tracking any players.\nUse **/track** to track more players.',
                    ephemeral: true
                });
            }
        },
        text: 'Shows details of when each tracked player was last updated',
        admin: true
    },
    role: {
        options: [{
            type: ApplicationCommandOptionType.Role,
            name: 'role',
            description: 'Server role',
            required: true
        }],
        execute: async (interaction) => {
            const guild = getInteractionGuild(interaction);
            const privilegedRole = interaction.options.getRole('role', true);
            await pgStorageClient.writePrivilegedRole(guild.id, privilegedRole.id);
            state.setPrivilegedRole(guild.id, privilegedRole);
            await interaction.reply({
                content: `${privilegedRole} can now use ${getRoleCommandsListString(true)}.`,
                ephemeral: true
            });
        },
        text: 'Sets a non-admin server role that can use commands like /track, /remove, and more',
        admin: true
    }
};

/**
 * These commands are accessible only to the user matching the adminUserId
 * specified in the config, and are invoked using the old command reader.
 */
export const hiddenCommands: HiddenCommandsType = {
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
        text: 'Displays a skill\'s level 99 thumbnail'
    },
    help: {
        fn: (msg) => {
            msg.channel.send(getHelpText(true));
        },
        text: 'Shows help for hidden commands'
    },
    log: {
        fn: (msg) => {
            // Truncate both logs to the Discord max of 2000 characters
            msg.channel.send(`Info Log:\n\`\`\`${infoLog.toLogArray().join('\n').slice(0, 1950) || 'log empty'}\`\`\``);
            msg.channel.send(`Debug Log:\`\`\`${debugLog.toLogArray().join('\n').slice(0, 1950) || 'log empty'}\`\`\``);
        },
        text: 'Prints the bot\'s log'
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
        text: 'Kills the bot'
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
    //     text: 'Prints the bot\'s state',
    //     privileged: true
    // },
    enable: {
        fn: (msg: Message) => {
            msg.reply('Enabling the bot... If the API format is still not supported, the bot will disable itself.');
            state.setDisabled(false);
        },
        text: 'Enables the bot, this should be used after the bot has been disabled due to an incompatible API change'
    }
};

export default slashCommands;
