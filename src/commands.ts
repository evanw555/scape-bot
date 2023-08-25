import { APIEmbed, ApplicationCommandOptionType, ChatInputCommandInteraction, Guild, Message, PermissionFlagsBits, Snowflake, TextChannel } from 'discord.js';
import { FORMATTED_BOSS_NAMES, Boss, BOSSES, INVALID_FORMAT_ERROR } from 'osrs-json-hiscores';
import { exec } from 'child_process';
import { MultiLoggerLevel, forEachMessage, getPreciseDurationString, naturalJoin, randChoice, randInt } from 'evanw555.js';
import { PlayerHiScores, SlashCommandsType, HiddenCommandsType, CommandsType, SlashCommand, IndividualSkillName, IndividualClueType, DailyAnalyticsLabel, IndividualActivityName } from './types';
import { replyUpdateMessage, sendUpdateMessage, updatePlayer, getBossName, isValidBoss, generateDetailsContentString, sanitizeRSN, botHasRequiredPermissionsInChannel, validateRSN, getMissingRequiredChannelPermissionNames, getGuildWarningEmbeds, createWarningEmbed, purgeUntrackedPlayers, getHelpComponents, fetchDisplayName } from './util';
import { fetchHiScores } from './hiscores';
import CommandHandler from './command-handler';
import { CLUES_NO_ALL, SKILLS_NO_OVERALL, CONSTANTS, BOSS_CHOICES, INVALID_TEXT_CHANNEL, SKILL_EMBED_COLOR, PLAYER_404_ERROR, GRAY_EMBED_COLOR, OTHER_ACTIVITIES, OTHER_ACTIVITIES_MAP } from './constants';

import state from './instances/state';
import logger from './instances/logger';
import pgStorageClient from './instances/pg-storage-client';
import timer from './instances/timer';

import debugLog from './instances/debug-log';
import infoLog from './instances/info-log';
import loggerIndices from './instances/logger-indices';

const validSkills = new Set<string>(CONSTANTS.skills);

// Storing rollback-related data as volatile in-memory variables because it doesn't need to be persistent
let rollbackStaging: { rsn: string, category: 'skill' | 'boss' | 'clue' | 'activity', name: string, score: number }[] = [];
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
            return true;
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
            await interaction.reply({
                content: getHelpText(false, isAdmin, hasPrivilegedRole),
                components: getHelpComponents('Get Help in the Official Server'),
                ephemeral: true
            });
            return true;
        },
        text: 'Shows help'
    },
    info: {
        execute: async (interaction) => {
            const guildId = getInteractionGuildId(interaction);
            // TODO: If bot is disabled, show warning about inaccurate refresh durations
            await interaction.reply({
                embeds: [{
                    description: `**Players:** ${state.getNumTrackedPlayers(guildId)}\n`
                               + `**Channel:** ${state.hasTrackingChannel(guildId) ? state.getTrackingChannel(guildId) : 'None, set with **/channel**'}\n`
                               + '**Role:** ' + (state.hasPrivilegedRole(guildId) ? `${state.getPrivilegedRole(guildId)} and Admins` : 'Admins only, set a custom role with **/role**'),
                    color: SKILL_EMBED_COLOR,
                    title: 'Information'
                }, {
                    description: state.getLabeledRefreshDurationStrings().map(x => `**${x.label}:** ${x.duration}`).join('\n'),
                    color: SKILL_EMBED_COLOR,
                    title: 'Refresh Durations'
                }],
                ephemeral: true
            });
            return true;
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
            const rawRsnInput = interaction.options.getString('username', true);
            const rsn = sanitizeRSN(rawRsnInput);
            // Validate the RSN
            try {
                validateRSN(rsn);
            } catch (err) {
                await interaction.reply({
                    content: `Invalid username: ${(err as Error).message}`,
                    ephemeral: true
                });
                return false;
            }
            // Abort if the player is already being tracked
            if (state.isTrackingPlayer(guildId, rsn)) {
                await interaction.reply({
                    content: 'That player is already being tracked!\nUse **/check** to check their hiscores.',
                    ephemeral: true
                });
                return false;
            }
            const globallyNewPlayer = !state.isPlayerTrackedInAnyGuilds(rsn);
            // Defer the reply because PG and validation may cause this command to time out
            await interaction.deferReply();
            // Track the player in this guild
            await pgStorageClient.insertTrackedPlayer(guildId, rsn);
            state.addTrackedPlayer(guildId, rsn);
            // If this player is globally new (previously untracked in any guilds at all), prime the state/PG with some initial data
            if (globallyNewPlayer) {
                // TODO: This should instead be its own separate method perhaps?
                await updatePlayer(rsn, { primer: true });
            }
            // If the display name could not be found and it's different than what the user input, warn them
            const warningEmbeds = getGuildWarningEmbeds(guildId);
            if (!state.hasDisplayName(rsn) && rsn !== rawRsnInput) {
                warningEmbeds.push(createWarningEmbed('The correct formatting of this player\'s username could not be determined, '
                    + `so they will be tracked as **${rsn}** (versus **${rawRsnInput.trim()}**) until they reach the overall hiscores.`));
            }
            // Edit the reply with an initial success message (and any guild warnings there may be)
            const replyText = `Now tracking player **${state.getDisplayName(rsn)}**!\nUse **/list** to see tracked players.`;
            await interaction.editReply({
                content: replyText,
                embeds: warningEmbeds
            });
            // Validate that the player exists, edit the reply to show a warning if not
            try {
                await fetchHiScores(rsn);
                // TODO: Reduce or remove this logging?
                await logger.log(`\`${interaction.user.tag}\` has tracked player **${state.getDisplayName(rsn)}** (**${state.getNumTrackedPlayers(guildId)}** in guild)`, MultiLoggerLevel.Warn);
            } catch (err) {
                if ((err instanceof Error) && err.message === PLAYER_404_ERROR) {
                    // If the hiscores returns a 404, add a warning to the existing list of guild warnings and edit the reply
                    warningEmbeds.push(createWarningEmbed('This player was _not_ found on the hiscores, '
                    + 'meaning they either are temporarily missing or they don\'t exist at all. '
                    + 'This player will still be tracked, but please ensure you spelled their username correctly. '
                    + 'If you made a typo, please remove this player with **/remove**!'));
                    await interaction.editReply({
                        content: replyText,
                        embeds: warningEmbeds
                    });
                    await logger.log(`\`${interaction.user.tag}\` has tracked player **${rsn}** (404)`, MultiLoggerLevel.Warn);
                } else {
                    await logger.log(`\`${interaction.user.tag}\` has tracked player **${rsn}** (5xx? outage?)`, MultiLoggerLevel.Warn);
                }
            }
            return true;
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
                return false;
            }
            if (state.isTrackingPlayer(guildId, rsn)) {
                await pgStorageClient.deleteTrackedPlayer(guildId, rsn);
                state.removeTrackedPlayer(guildId, rsn);
                await interaction.reply(`No longer tracking player **${rsn}**.\nYou can still use **/check** to see this player's hiscores.`);
                await logger.log(`\`${interaction.user.tag}\` removed player **${rsn}** (**${state.getNumTrackedPlayers(guildId)}** in guild)`, MultiLoggerLevel.Warn);
                // If this player is now globally untracked, purge untracked player data
                await purgeUntrackedPlayers([rsn], '/remove');
                return true;
            } else {
                await interaction.reply({ content: 'That player is not currently being tracked.', ephemeral: true });
                return false;
            }
        },
        text: 'Stops tracking a player',
        privilegedRole: true,
        failIfDisabled: true
    },
    clear: {
        execute: async (interaction) => {
            const guildId = getInteractionGuildId(interaction);
            await interaction.deferReply({ ephemeral: true });
            // Remove the players
            const playersToRemove = state.getAllTrackedPlayers(guildId);
            for (const rsn of playersToRemove) {
                await pgStorageClient.deleteTrackedPlayer(guildId, rsn);
                state.removeTrackedPlayer(guildId, rsn);
            }
            // If some of the removed players are now globally untracked, purge untracked player data
            await purgeUntrackedPlayers(playersToRemove, '/clear');
            await interaction.editReply('No longer tracking any players.\nUse **/track** to track more players.');
            return true;
        },
        text: 'Stops tracking all players',
        privilegedRole: true,
        failIfDisabled: true
    },
    list: {
        execute: async (interaction) => {
            const guildId = getInteractionGuildId(interaction);
            if (state.isTrackingAnyPlayers(guildId)) {
                const displayNames = state.getAllTrackedPlayers(guildId).map(rsn => state.getDisplayName(rsn));
                const textReply = `Currently tracking players ${naturalJoin(displayNames, { bold: true })}.\nUse **/track** to track more players!`;
                if (textReply.length < 1990) {
                    await interaction.reply({
                        content: textReply,
                        ephemeral: true
                    });
                } else {
                    await interaction.reply({
                        content: `Currently tracking **${displayNames.length}** players (too many to show in one message)`,
                        ephemeral: true
                    });
                }
            } else {
                await interaction.reply({
                    content: 'Currently not tracking any players.\nUse **/track** to track more players!',
                    ephemeral: true
                });
            }
            return true;
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
            const rawRsn = interaction.options.getString('username', true);
            const rsn = sanitizeRSN(rawRsn);
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
                if (OTHER_ACTIVITIES.some(activity => data.activities[activity])) {
                    messageText += '\n\n' + OTHER_ACTIVITIES.filter(activity => data.activities[activity]).map(activity => `**${data.activities[activity]}** ${OTHER_ACTIVITIES_MAP[activity]}`).join('\n');
                }
                await replyUpdateMessage(interaction, messageText, 'overall', {
                    title: state.getDisplayName(rsn),
                    url: `${CONSTANTS.hiScoresUrlTemplate}${encodeURI(rsn)}`,
                    extraEmbeds: getGuildWarningEmbeds(interaction.guildId)
                });
                return true;
            } catch (err) {
                // For error messages, we want the user to see the raw RSN they entered.
                // Showing the sanitized RSN may lead them to believe that the error is related to sanitization (I think?)
                if ((err instanceof Error) && err.message === PLAYER_404_ERROR) {
                    await logger.log(`\`${interaction.user.tag}\` checked player **${rsn}** but got a 404`, MultiLoggerLevel.Warn);
                    await interaction.reply(`Couldn't find player **${rawRsn.trim()}** on the hiscores`);
                } else {
                    await logger.log(`Error while fetching hiscores (check) for player **${rsn}**: \`${err}\``, MultiLoggerLevel.Error);
                    await interaction.reply(`Couldn't fetch hiscores for player **${rawRsn.trim()}** :pensive:\n\`${err}\``);
                }
                return false;
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
                return true;
            } catch (err) {
                if (err instanceof Error) {
                    await logger.log(`Error while fetching hiscores (check) for player ${rsn}: ${err.toString()}`, MultiLoggerLevel.Error);
                    await interaction.reply({
                        content: `Couldn't fetch hiscores for player **${state.getDisplayName(rsn)}** :pensive:\n\`${err.toString()}\``,
                        ephemeral: true
                    });
                }
                return false;
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
                    if (!botHasRequiredPermissionsInChannel(interaction.channel)) {
                        const missingPermissionNames = getMissingRequiredChannelPermissionNames(interaction.channel);
                        const joinedPermissions = naturalJoin(missingPermissionNames, { bold: true });
                        await interaction.reply({
                            content: `ScapeBot does not have sufficient permissions in this channel (missing ${joinedPermissions}). Please update channel permissions or try a different channel.`,
                            ephemeral: true
                        });
                        return false;
                    }

                    await pgStorageClient.updateTrackingChannel(guild.id, interaction.channelId);
                    state.setTrackingChannel(guild.id, interaction.channel);
                    await interaction.reply('Player updates will now be sent to this channel!\nUse **/track** to start tracking players.');
                    // TODO: Reduce/remove this once we've seen it play out
                    await logger.log(`\`${interaction.user.tag}\` set the tracking channel for _${guild.name}_ to \`#${interaction.channel.name}\``, MultiLoggerLevel.Warn);
                    return true;
                } else {
                    await interaction.reply({
                        content: 'This channel cannot be used to track player updates! Please use **/channel** in a valid guild text channel',
                        ephemeral: true
                    });
                }
            } catch (err) {
                if (err instanceof Error) {
                    await logger.log(`Error while setting tracking channel (track) for guild ${guild.id}: ${err.toString()}`, MultiLoggerLevel.Error);
                    await interaction.reply(`Couldn't set tracking channel to ${interaction.channel}`);
                }
            }
            return false;
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
            return true;
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
            return true;
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
                void sendUpdateMessage([msg.channel], 'Here is the thumbnail', name, {
                    title: name
                });
            } else if (isValidBoss(name)) {
                void sendUpdateMessage([msg.channel], 'Here is the thumbnail', name, {
                    title: name
                });
            } else {
                void msg.channel.send(`**${name || '[none]'}** does not have a thumbnail`);
            }
        },
        text: 'Displays a skill or boss\' thumbnail'
    },
    thumbnail99: {
        fn: (msg, rawArgs, skill) => {
            if (validSkills.has(skill)) {
                void sendUpdateMessage([msg.channel], 'Here is the level 99 thumbnail', skill, {
                    title: skill,
                    is99: true
                });
            } else {
                void msg.channel.send(`**${skill || '[none]'}** is not a valid skill`);
            }
        },
        text: 'Displays a skill\'s level 99 thumbnail'
    },
    help: {
        fn: (msg) => {
            void msg.channel.send(getHelpText(true));
        },
        text: 'Shows help for hidden commands'
    },
    log: {
        fn: (msg) => {
            // Truncate both logs to the Discord max of 2000 characters
            void msg.channel.send(`Info Log:\n\`\`\`${infoLog.toLogArray().join('\n').replace(/`/g, '').slice(0, 1950) || 'log empty'}\`\`\``);
            void msg.channel.send(`Debug Log:\`\`\`${debugLog.toLogArray().join('\n').replace(/`/g, '').slice(0, 1950) || 'log empty'}\`\`\``);
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
                    void msg.channel.send(`\`${err.toString()}\``);
                }
                return;
            }
            void updatePlayer(player, { spoofedDiff });
        },
        text: 'Spoof an update notification using a raw JSON object {player, diff: {skills|bosses}}',
        failIfDisabled: true
    },
    spoof: {
        fn: (msg, rawArgs, player) => {
            if (player) {
                const possibleKeys = Object.keys(FORMATTED_BOSS_NAMES)
                    .concat(OTHER_ACTIVITIES)
                    .concat(SKILLS_NO_OVERALL)
                    .concat(SKILLS_NO_OVERALL); // Add it again to make it more likely (there are too many bosses)
                const numUpdates: number = randInt(1, 6);
                const spoofedDiff: Record<string, number> = {};
                for (let i = 0; i < numUpdates; i++) {
                    const randomKey: string = randChoice(...possibleKeys);
                    spoofedDiff[randomKey] = randInt(1, 4);
                }
                void updatePlayer(player, { spoofedDiff });
            } else {
                void msg.channel.send('Usage: spoof PLAYER');
            }
        },
        text: 'Spoof an update notification for some player with random skill/boss updates',
        failIfDisabled: true
    },
    admin: {
        fn: async (msg, rawArgs, subcommand) => {
            // Get host uptime info
            const uptimeString = await new Promise<string>((resolve) => {
                exec('uptime --pretty', (error, stdout, stderr) => {
                    if (error) {
                        resolve(error.message);
                    } else if (stderr) {
                        resolve(stderr);
                    } else {
                        resolve(stdout);
                    }
                });
            });
            // Send admin info back to user
            await msg.channel.send({
                content: 'Admin Information:',
                embeds: [{
                    title: 'Host Uptime',
                    description: `\`${uptimeString.trim()}\``
                }, {
                    title: 'Timer Info',
                    description: `\`${timer.getIntervalMeasurementDebugString()}\``
                }, {
                    title: 'Total XP',
                    description: `Populated for **${state.getNumPlayerTotalXp()}** of **${state.getNumGloballyTrackedPlayers()}** players`
                }, {
                    title: 'Largest Guilds',
                    description: state.getGuildsByPlayerCount()
                        .slice(0, 10)
                        .map((id, i) => `**${i + 1}.** _${msg.client.guilds.cache.get(id)?.name ?? '???'}_: **${state.getNumTrackedPlayers(id)}**`)
                        .join('\n')
                }]
            });
            // TODO: Temp logic for subcommands can live here
            if (subcommand === 'populate_daily_analytics') {
                const messageBase = 'Populating daily analytics using log messages from this channel...';
                const replyMessage = await msg.reply(messageBase);
                const p = /now in \*?\*?(\d+)\*?\*? guilds/;
                const result: Record<string, number> = {};
                let lastReplyEdit = new Date().getTime();
                await forEachMessage(msg.channel, async (message) => {
                    if (message.author.bot) {
                        const m = message.content.match(p);
                        if (m && m[1]) {
                            const n = parseInt(m[1]);
                            const dateString = message.createdAt.toDateString();
                            result[dateString] = Math.max(result[dateString] ?? 0, n);
                            const currentTime = new Date().getTime();
                            if (currentTime - lastReplyEdit > 5000) {
                                lastReplyEdit = currentTime;
                                await replyMessage.edit(messageBase + ` (extracted from **${Object.keys(result).length}** dates, latest **${dateString}**)`);
                            }
                        }
                    }
                });
                await replyMessage.edit(`Done. Extracted **${Object.keys(result).length}** data points. Writing values to PG...`);
                // Now, write all the values
                for (const [dateString, value] of Object.entries(result)) {
                    await pgStorageClient.writeDailyAnalyticsRow(new Date(dateString), DailyAnalyticsLabel.NumGuilds, value);
                }
                await replyMessage.edit('Done. Operation complete!');
            }
        },
        text: 'Show various debug data for admins'
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
            void msg.channel.send(`${phrase}... 💀`).then(() => {
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
            await msg.reply('Enabling the bot... If the API format is still not supported, the bot will disable itself.');
            await pgStorageClient.writeMiscProperty('disabled', 'false');
            state.setDisabled(false);
            // Reset the interval measurement data
            timer.resetIntervalMeasurement();
        },
        text: 'Enables the bot, this should be used after the bot has been disabled due to an incompatible API change'
    },
    rollback: {
        fn: async (msg: Message, rawArgs, rsnArg: string | undefined) => {
            // Optionally, support rollbacks for just one specific player
            const sanitizedRsnArg = rsnArg && sanitizeRSN(rsnArg);
            // If an arg was provided, validate that this player is tracked by some guild
            if (sanitizedRsnArg && !state.isPlayerTrackedInAnyGuilds(sanitizedRsnArg)) {
                await msg.reply(`Cannot rollback for **${sanitizedRsnArg}**, player isn't tracked by any guilds!`);
                return;
            }

            if (rollbackLock) {
                await msg.reply('Rollback in progress, try again later!');
                return;
            }
            rollbackLock = true;

            if (rollbackStaging.length === 0) {
                const playersToCheck: string[] = sanitizedRsnArg ? [sanitizedRsnArg] : state.getAllGloballyTrackedPlayers();
                let numPlayersProcessed = 0;
                const getStatusText = () => {
                    return `Checking for rollback-impacted data... **(${numPlayersProcessed}/${playersToCheck.length})**`;
                };
                const replyMessage = await msg.reply(getStatusText());
                for (const rsn of playersToCheck) {
                    numPlayersProcessed++;
                    let data: PlayerHiScores;
                    try {
                        data = await fetchHiScores(rsn);
                    } catch (err) {
                        // Ignore 404 errors
                        if (!(err instanceof Error) || err.message !== PLAYER_404_ERROR) {
                            await msg.channel.send(`(Rollback) Failed to fetch hiscores for player **${rsn}**: \`${err}\``);
                        }
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
                    for (const activity of OTHER_ACTIVITIES) {
                        if (state.hasActivity(rsn, activity)) {
                            const before = state.getActivity(rsn, activity);
                            const after = data.activitiesWithDefaults[activity];
                            if (after - before < 0) {
                                logs.push(`**${activity}** dropped from \`${before}\` to \`${after}\``);
                                rollbackStaging.push({
                                    rsn,
                                    category: 'activity',
                                    name: activity,
                                    score: after
                                });
                            }
                        }
                    }
                    if (logs.length > 0) {
                        await msg.channel.send(`(Rollback) Detected negatives for **${rsn}**:\n` + logs.join('\n'));
                    }
                    // Update original message
                    if (numPlayersProcessed % 5 === 0 || numPlayersProcessed === playersToCheck.length) {
                        await replyMessage.edit(getStatusText());
                    }
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
                    case 'activity':
                        state.setActivity(rsn, name as IndividualActivityName, score);
                        await pgStorageClient.writePlayerActivities(rsn, { [name]: score });
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
            await purgeUntrackedPlayers([rsn], 'removeglobal');
        },
        text: 'Removes a player from all guilds'
    },
    logger: {
        fn: async (msg: Message, rawArgs: string) => {
            try {
                // First, determine the ID of this channel logger
                let id: Snowflake;
                if (msg.channelId in loggerIndices) {
                    id = msg.channelId;
                } else if (msg.channel.isDMBased() && msg.author.id in loggerIndices) {
                    id = msg.author.id;
                } else {
                    await msg.reply('This channel doesn\'t have a corresponding channel logger!');
                    return;
                }
                // Now that the ID is confirmed to be in the logger map, reconfigure its level
                if (rawArgs in MultiLoggerLevel) {
                    const level = parseInt(rawArgs);
                    logger.setOutputLevel(loggerIndices[id], level);
                    await msg.reply(`This logger is now at level **${MultiLoggerLevel[level]}**`);
                } else {
                    await msg.reply(`\`${rawArgs}\` is not a valid level, options are \`${JSON.stringify(Object.keys(MultiLoggerLevel))}\``);
                }
            } catch (err) {
                await msg.reply(`Oops! \`${err}\``);
            }
        },
        text: 'Sets the logging level of this channel\'s logger'
    },
    player: {
        fn: async (msg: Message, rawArgs, rawRsn) => {
            if (!rawRsn || !rawRsn.trim()) {
                await msg.reply('Invalid username');
                return;
            }
            const rsn = sanitizeRSN(rawRsn);

            const embeds: APIEmbed[] = [];

            // First, try to fetch display name
            try {
                const displayName = await fetchDisplayName(rsn);
                embeds.push({
                    description: `Fetched display name of **${rsn}** as **${displayName}**`
                });
            } catch (err) {
                embeds.push(createWarningEmbed(`Unable to fetch display name for **${rsn}**: \`${err}\``));
            }

            // Show guild info about this player
            const guilds = state.getGuildsTrackingPlayer(rsn);
            if (guilds.length === 0) {
                embeds.push(createWarningEmbed('No guilds tracking this player'));
            } else {
                const noun = guilds.length === 1 ? 'guild' : 'guilds';
                embeds.push({
                    description: `**${state.getDisplayName(rsn)}** is tracked in **${guilds.length}** ${noun}: `
                        + guilds.map(id => `\`${id}\` (_${msg.client.guilds.cache.get(id) ?? '???'}_)`).join(', ')
                });
            }

            // Show time-related info about this player
            const lastRefresh = state.getLastUpdated(rsn);
            if (lastRefresh) {
                const timeSinceLastRefresh: number = new Date().getTime() - lastRefresh.getTime();
                const timeSinceLastActive: number = state.getTimeSincePlayerLastActive(rsn);
                embeds.push({
                    description: 'Time since...',
                    fields: [{
                        name: 'Last Refresh',
                        value: getPreciseDurationString(timeSinceLastRefresh)
                    }, {
                        name: 'Last Active',
                        value: getPreciseDurationString(timeSinceLastActive)
                    }]
                });
            }

            // Test the API by fetching this player
            try {
                await fetchHiScores(rsn);
                embeds.push({
                    description: `API seems to be fine, fetched and parsed response for player **${rsn}**`
                });
            } catch (err) {
                let errorText = `API query failed with error: \`${err}\``;
                if ((err instanceof Error) && err.message === INVALID_FORMAT_ERROR) {
                    errorText += ' (the API has changed or just generally cannot be parsed)';
                }
                embeds.push(createWarningEmbed(errorText));
            }

            await msg.reply({
                embeds
            });
        },
        text: 'Shows information about a given player'
    },
    guildnotify: {
        fn: async (msg: Message, rawArgs: string, guildId: Snowflake, text: string) => {
            // Validate the input
            if (!guildId || !text) {
                await msg.reply('usage: guildnotify GUILD_ID TEXT');
                return;
            }
            if (!state.hasTrackingChannel(guildId)) {
                await msg.reply(`Guild with ID \`${guildId}\` either has no tracking channel or doesn't exist`);
                return;
            }
            // Send the message
            try {
                await sendUpdateMessage([state.getTrackingChannel(guildId)],
                    text,
                    'wrench',
                    { color: GRAY_EMBED_COLOR, title: 'Message from ScapeBot\'s maintainers' });
                await msg.reply(`**Sent message to guild _${msg.client.guilds.cache.get(guildId) ?? '???'}_:** ${text}`);
            } catch (err) {
                await msg.reply(`Failed to send message: \`${err}\``);
            }
        },
        text: 'Sends an arbitrary message to some guild by ID'
    }
};

export default slashCommands;
