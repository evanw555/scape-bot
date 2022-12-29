import { ApplicationCommandOptionType, ChatInputCommandInteraction, Guild, Message, PermissionFlagsBits, Snowflake, TextChannel } from 'discord.js';
import { FORMATTED_BOSS_NAMES, Boss, BOSSES, getRSNFormat } from 'osrs-json-hiscores';
import { exec } from 'child_process';
import { MultiLoggerLevel, naturalJoin, randChoice, randInt } from 'evanw555.js';
import { PlayerHiScores, SlashCommandsType, HiddenCommandsType, CommandsType, SlashCommand, IndividualSkillName, IndividualClueType } from './types';
import { replyUpdateMessage, sendUpdateMessage, updatePlayer, getBossName, isValidBoss, generateDetailsContentString, sanitizeRSN, botHasPermissionsInChannel, validateRSN } from './util';
import { fetchHiScores } from './hiscores';
import CommandHandler from './command-handler';
import { CLUES_NO_ALL, SKILLS_NO_OVERALL, CONSTANTS, BOSS_CHOICES, INVALID_TEXT_CHANNEL, SKILL_EMBED_COLOR, PLAYER_404_ERROR } from './constants';

import state from './instances/state';
import logger from './instances/logger';
import pgStorageClient from './instances/pg-storage-client';

import debugLog from './instances/debug-log';
import infoLog from './instances/info-log';

const validSkills = new Set<string>(CONSTANTS.skills);

// Storing rollback-related data as volatile in-memory variables because it doesn't need to be persistent
let rollbackStaging: { rsn: string, category: 'skill' | 'boss' | 'clue', name: string, score: number }[] = [];
let rollbackLock = false;

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
                               + `**Channel:** ${state.hasTrackingChannel(guildId) ? state.getTrackingChannel(guildId) : 'None, set with **/channel**'}\n`
                               + '**Role:** ' + (state.hasPrivilegedRole(guildId) ? `${state.getPrivilegedRole(guildId)} and Admins` : 'Admins only, set a custom role with **/role**') + '\n'
                               + `**Refresh Duration:** ${state.getRefreshDurationString()}`,
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
            const rsn = sanitizeRSN(interaction.options.getString('username', true));
            // Validate the RSN
            try {
                validateRSN(rsn);
            } catch (err) {
                await interaction.reply({
                    content: `Invalid username: ${(err as Error).message}`,
                    ephemeral: true
                });
                return;
            }
            // Abort if the player is already being tracked
            if (state.isTrackingPlayer(guildId, rsn)) {
                await interaction.reply({
                    content: 'That player is already being tracked!\nUse **/check** to check their hiscores.',
                    ephemeral: true
                });
                return;
            }
            // Defer the reply because PG and validation may cause this command to time out
            await interaction.deferReply();
            // Track the player
            await pgStorageClient.insertTrackedPlayer(guildId, rsn);
            state.addTrackedPlayer(guildId, rsn);
            await updatePlayer(rsn);
            // Attempt to fetch the player's display name if missing
            if (!state.hasDisplayName(rsn)) {
                try {
                    const displayName = await getRSNFormat(rsn);
                    await pgStorageClient.writePlayerDisplayName(rsn, displayName);
                    state.setDisplayName(rsn, displayName);
                } catch (err){
                    await logger.log(`Failed to fetch display name for **${rsn}**: \`${err}\``, MultiLoggerLevel.Warn);
                }
            }
            // Edit the reply with an initial success message
            const replyText = `Now tracking player **${state.getDisplayName(rsn)}**!\nUse **/list** to see tracked players.`;
            await interaction.editReply(replyText);
            // Validate that the player exists, edit the reply to show a warning if not
            try {
                await fetchHiScores(rsn);
                // TODO: Reduce or remove this logging?
                await logger.log(`\`${interaction.user.tag}\` has tracked player **${rsn}** (display: **${state.getDisplayName(rsn)}**)`, MultiLoggerLevel.Warn);
            } catch (err) {
                if ((err instanceof Error) && err.message === PLAYER_404_ERROR) {
                    // If the hiscores returns a 404, just show a warning in the ephemeral reply
                    await interaction.editReply(`${replyText}\n\n⚠️ **WARNING:** This player was _not_ found on the hiscores, `
                        + 'meaning they either are temporarily missing or they don\'t exist at all. '
                        + 'This player will still be tracked, but please ensure you spelled their username correctly. '
                        + 'If you made a typo, please remove this player with **/remove**!');
                    await logger.log(`\`${interaction.user.tag}\` has tracked player **${rsn}** (404)`, MultiLoggerLevel.Warn);
                } else {
                    await logger.log(`\`${interaction.user.tag}\` has tracked player **${rsn}** (5xx? outage?)`, MultiLoggerLevel.Warn);
                }
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
            const rsn = sanitizeRSN(interaction.options.getString('username', true));
            if (!rsn || !rsn.trim()) {
                await interaction.reply({ content: 'Invalid username', ephemeral: true });
                return;
            }
            if (state.isTrackingPlayer(guildId, rsn)) {
                await pgStorageClient.deleteTrackedPlayer(guildId, rsn);
                state.removeTrackedPlayer(guildId, rsn);
                await interaction.reply(`No longer tracking player **${rsn}**.\nYou can still use **/check** to see this player's hiscores.`);
                await logger.log(`\`${interaction.user.tag}\` removed player **${rsn}**`, MultiLoggerLevel.Warn);
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
            const rsn = sanitizeRSN(interaction.options.getString('username', true));
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
                    title: state.getDisplayName(rsn),
                    url: `${CONSTANTS.hiScoresUrlTemplate}${encodeURI(rsn)}`
                });
            } catch (err) {
                if (err instanceof Error) {
                    logger.log(`Error while fetching hiscores (check) for player ${rsn}: ${err.toString()}`, MultiLoggerLevel.Error);
                    await interaction.reply(`Couldn't fetch hiscores for player **${state.getDisplayName(rsn)}** :pensive:\n\`${err.toString()}\``);
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
            const rsn = sanitizeRSN(interaction.options.getString('username', true));
            // This must be a valid boss, since we define the valid choices
            const boss = interaction.options.getString('boss', true) as Boss;
            try {
                // Retrieve the player's hiscores data
                const data: PlayerHiScores = await fetchHiScores(rsn);
                const bossName = getBossName(boss);
                // Create boss message text
                const messageText = boss in data.bosses
                    ? `**${state.getDisplayName(rsn)}** has killed **${bossName}** **${data.bosses[boss]}** times`
                    : `I don't know how many **${bossName}** kills **${state.getDisplayName(rsn)}** has`;
                await replyUpdateMessage(interaction, messageText, boss, {
                    title: bossName,
                    url: `${CONSTANTS.osrsWikiBaseUrl}${encodeURIComponent(bossName)}`,
                    color: 10363483
                });
            } catch (err) {
                if (err instanceof Error) {
                    logger.log(`Error while fetching hiscores (check) for player ${rsn}: ${err.toString()}`, MultiLoggerLevel.Error);
                    await interaction.reply({
                        content: `Couldn't fetch hiscores for player **${state.getDisplayName(rsn)}** :pensive:\n\`${err.toString()}\``,
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
            const guild = getInteractionGuild(interaction);
            try {
                if (interaction.channel instanceof TextChannel) {
                    // Validate that the bot has the minimum required permissions in this channel
                    if (!botHasPermissionsInChannel(interaction.channel)) {
                        await interaction.reply({
                            content: 'ScapeBot does not have permission to view and/or send messages in this channel. Please update channel permissions or try a different channel.',
                            ephemeral: true
                        });
                        return;
                    }

                    await pgStorageClient.updateTrackingChannel(guild.id, interaction.channelId);
                    state.setTrackingChannel(guild.id, interaction.channel);
                    await interaction.reply('Player updates will now be sent to this channel!\nUse **/track** to start tracking players.');
                } else {
                    await interaction.reply({
                        content: 'This channel cannot be used to track player updates! Please use **/channel** in a valid guild text channel',
                        ephemeral: true
                    });
                }
            } catch (err) {
                if (err instanceof Error) {
                    logger.log(`Error while setting tracking channel (track) for guild ${guild.id}: ${err.toString()}`, MultiLoggerLevel.Error);
                    await interaction.reply(`Couldn't set tracking channel to ${interaction.channel}`);
                }
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
                    content: generateDetailsContentString(sortedPlayers),
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
    feedback: {
        options: [
            {
                type: ApplicationCommandOptionType.String,
                name: 'message',
                description: 'Message you\'d like to send to ScapeBot developers',
                required: true
            }
        ],
        execute: async (interaction) => {
            const feedbackMessage = interaction.options.getString('message', true);
            // TODO: Can we somehow open an anonymous line of communication using the bot as a proxy?
            await logger.log(`**New feedback:** ${feedbackMessage}`.slice(0, 1990), MultiLoggerLevel.Fatal);
            await interaction.reply({ ephemeral: true, content: 'Your feedback has been sent!' });
        },
        text: 'Anonymously provide feedback to the developers of ScapeBot (e.g. report bugs, suggest features)',
        privilegedRole: true
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
            msg.channel.send(`Info Log:\n\`\`\`${infoLog.toLogArray().join('\n').replace(/`/g, '').slice(0, 1950) || 'log empty'}\`\`\``);
            msg.channel.send(`Debug Log:\`\`\`${debugLog.toLogArray().join('\n').replace(/`/g, '').slice(0, 1950) || 'log empty'}\`\`\``);
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
        fn: async (msg: Message) => {
            msg.reply('Enabling the bot... If the API format is still not supported, the bot will disable itself.');
            await pgStorageClient.writeMiscProperty('disabled', 'false');
            state.setDisabled(false);
        },
        text: 'Enables the bot, this should be used after the bot has been disabled due to an incompatible API change'
    },
    rollback: {
        fn: async (msg: Message) => {
            if (rollbackLock) {
                await msg.reply('Rollback in progress, try again later!');
                return;
            }
            rollbackLock = true;

            if (rollbackStaging.length === 0) {
                const allPlayers: string[] = state.getAllGloballyTrackedPlayers();
                let numPlayersProcessed = 0;
                const getStatusText = () => {
                    return `Checking for rollback-impacted data... **(${numPlayersProcessed}/${allPlayers.length})**`;
                };
                const replyMessage = await msg.reply(getStatusText());
                for (const rsn of allPlayers) {
                    numPlayersProcessed++;
                    let data: PlayerHiScores;
                    try {
                        data = await fetchHiScores(rsn);
                    } catch (err) {
                        await msg.channel.send(`(Rollback) Failed to fetch hiscores for player **${rsn}**: \`${err}\``);
                        continue;
                    }
                    const logs: string[] = [];
                    for (const skill of SKILLS_NO_OVERALL) {
                        if (state.hasLevel(rsn, skill)) {
                            const before = state.getLevel(rsn, skill);
                            const after = data.levelsWithDefaults[skill];
                            if (after - before < 0) {
                                logs.push(`**${skill}** dropped from \`${before}\` to \`${after}\``);
                                rollbackStaging.push({
                                    rsn,
                                    category: 'skill',
                                    name: skill,
                                    score: after
                                });
                            }
                        }
                    }
                    for (const boss of BOSSES) {
                        if (state.hasBoss(rsn, boss)) {
                            const before = state.getBoss(rsn, boss);
                            const after = data.bossesWithDefaults[boss];
                            if (after - before < 0) {
                                logs.push(`**${boss}** dropped from \`${before}\` to \`${after}\``);
                                rollbackStaging.push({
                                    rsn,
                                    category: 'boss',
                                    name: boss,
                                    score: after
                                });
                            }
                        }
                    }
                    for (const clue of CLUES_NO_ALL) {
                        if (state.hasClue(rsn, clue)) {
                            const before = state.getClue(rsn, clue);
                            const after = data.cluesWithDefaults[clue];
                            if (after - before < 0) {
                                logs.push(`**${clue}** dropped from \`${before}\` to \`${after}\``);
                                rollbackStaging.push({
                                    rsn,
                                    category: 'clue',
                                    name: clue,
                                    score: after
                                });
                            }
                        }
                    }
                    if (logs.length > 0) {
                        await msg.channel.send(`(Rollback) Detected negatives for **${rsn}**:\n` + logs.join('\n'));
                    }
                    // Update original message
                    await replyMessage.edit(getStatusText());
                }
                await msg.channel.send(`Done, use this command again to commit the **${rollbackStaging.length}** change(s) to state/PG.`);
            } else {
                await msg.channel.send(`Committing **${rollbackStaging.length}** rollback change(s) to state/PG...`);
                for (const { rsn, category, name, score } of rollbackStaging) {
                    switch (category) {
                    case 'skill':
                        state.setLevel(rsn, name as IndividualSkillName, score);
                        await pgStorageClient.writePlayerLevels(rsn, { [name]: score });
                        break;
                    case 'boss':
                        state.setBoss(rsn, name as Boss, score);
                        await pgStorageClient.writePlayerBosses(rsn, { [name]: score });
                        break;
                    case 'clue':
                        state.setClue(rsn, name as IndividualClueType, score);
                        await pgStorageClient.writePlayerClues(rsn, { [name]: score });
                        break;
                    }
                }
                await msg.channel.send('Rollback commit complete!');
                rollbackStaging = [];
            }

            rollbackLock = false;
        },
        text: 'Fetches hiscores for each player and saves any negative diffs (only needed in the case of a rollback)'
    },
    removeglobal: {
        fn: async (msg: Message, rawArgs, rawRsn) => {
            if (!rawRsn || !rawRsn.trim()) {
                await msg.reply('Invalid username');
                return;
            }
            const rsn = sanitizeRSN(rawRsn);
            const guildIds: Snowflake[] = state.getGuildsTrackingPlayer(rsn);
            if (guildIds.length === 0) {
                await msg.reply(`**${rsn}** is not tracked by any guilds`);
                return;
            }
            // Remove player from all guilds
            // TODO: Can we refactor these utils to have bulk methods?
            for (const guildId of guildIds) {
                await pgStorageClient.deleteTrackedPlayer(guildId, rsn);
                state.removeTrackedPlayer(guildId, rsn);
            }
            await msg.reply(`Removed **${rsn}** from **${guildIds.length}** guild(s)`);
            // If no longer globally tracked (should be true), purge PG
            if (!state.isPlayerTrackedInAnyGuilds(rsn)) {
                const purgeResults = await pgStorageClient.purgeUntrackedPlayerData();
                // If any rows were deleted, log this
                if (Object.keys(purgeResults).length > 0) {
                    await logger.log(`(\`removeglobal\`) **${rsn}** now globally untracked, purged rows: \`${JSON.stringify(purgeResults)}\``, MultiLoggerLevel.Warn);
                }
            }
        },
        text: 'Removes a player from all guilds'
    },
    name: {
        fn: async (msg: Message, rawArgs, rawRsn) => {
            if (!rawRsn || !rawRsn.trim()) {
                await msg.reply('Invalid username');
                return;
            }
            const rsn = sanitizeRSN(rawRsn);
            try {
                const displayName = await getRSNFormat(rsn);
                await msg.reply(`Display name of **${rsn}** is **${displayName}**`);
            } catch (err) {
                await msg.reply(`Unable to fetch display name for **${rsn}**: \`${err}\``);
            }
        },
        text: 'Fetches a player\'s display name'
    }
};

export default slashCommands;
