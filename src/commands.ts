import { ApplicationCommandOptionType, AttachmentBuilder, ButtonStyle, ChannelType, ChatInputCommandInteraction, ComponentType, Guild, PermissionFlagsBits, TextChannel } from 'discord.js';
import { Boss, BOSSES } from 'osrs-json-hiscores';
import { MultiLoggerLevel, naturalJoin } from 'evanw555.js';
import { PlayerHiScores, SlashCommandsType } from './types';
import { replyUpdateMessage, updatePlayer, getBossName, generateDetailsContentString, sanitizeRSN, botHasRequiredPermissionsInChannel, validateRSN, getMissingRequiredChannelPermissionNames, getGuildWarningEmbeds, createWarningEmbed, purgeUntrackedPlayers, getHelpComponents, getHelpText, resolveHiScoresUrlTemplate } from './util';
import { fetchHiScores, isPlayerNotFoundError } from './hiscores';
import CommandHandler from './command-handler';
import { AUTH, CLUES_NO_ALL, SKILLS_NO_OVERALL, CONSTANTS, BOSS_CHOICES, INVALID_TEXT_CHANNEL, SKILL_EMBED_COLOR, OTHER_ACTIVITIES, OTHER_ACTIVITIES_MAP } from './constants';

import state from './instances/state';
import logger from './instances/logger';
import pgStorageClient from './instances/pg-storage-client';

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

const hiScoresUrlTemplate = resolveHiScoresUrlTemplate();

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
                content: getHelpText(slashCommands, isAdmin, hasPrivilegedRole),
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
                    description: state.getPlayerQueue().getLabeledDurationStrings().map(x => `**${x.label} Players (${x.thresholdLabel}):** ${x.duration}`).join('\n')
                        + '\n\n("activity" defined as _change in total XP_)',
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
                // TODO: Display name can also be missing due to rate limiting, can we detect and communicate this?
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
                if (isPlayerNotFoundError(err)) {
                    if (AUTH.gameMode && AUTH.gameMode !== 'main') {
                        warningEmbeds.push(createWarningEmbed(`This bot is tracking players in the **${AUTH.gameMode}** game mode, `
                            + 'please make sure the player you are tracking exists (or will exist) in this game mode!'));
                    }
                    const gameModeString = AUTH.gameMode ? ` **${AUTH.gameMode}**` : '';
                    // If the hiscores returns a 404, add a warning to the existing list of guild warnings and edit the reply
                    warningEmbeds.push(createWarningEmbed(`This player was _not_ found on the${gameModeString} hiscores, `
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
                // TODO: Should delete PPU rows matching this RSN+guildID combo
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
            // TODO: Should delete all PPU rows for this guild
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
                // TODO: Should we sort these in both cases?
                const displayNames = state.getAllTrackedPlayers(guildId).map(rsn => state.getDisplayName(rsn));
                const textReply = `Currently tracking players ${naturalJoin(displayNames, { bold: true })}.\nUse **/track** to track more players!`;
                if (textReply.length < 1990) {
                    await interaction.reply({
                        content: textReply,
                        ephemeral: true
                    });
                } else {
                    await interaction.reply({
                        content: `Currently tracking **${displayNames.length}** players (list attached due to large size)`,
                        files: [new AttachmentBuilder(Buffer.from(displayNames.sort().join('\n'))).setName('players.txt')],
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
                    url: `${hiScoresUrlTemplate}${encodeURI(rsn)}`,
                    extraEmbeds: getGuildWarningEmbeds(interaction.guildId)
                });
                return true;
            } catch (err) {
                // For error messages, we want the user to see the raw RSN they entered.
                // Showing the sanitized RSN may lead them to believe that the error is related to sanitization (I think?)
                if (isPlayerNotFoundError(err)) {
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
        text: 'Shows details of when each tracked player was last refreshed',
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
    },
    settings: {
        execute: async (interaction) => {
            // TODO: Temp logic to make this inaccessible while in development
            if (!state.isMaintainer(interaction.user.id)) {
                await interaction.reply({
                    content: 'This command is still under construction. Please check back later.',
                    ephemeral: true
                });
                return false;
            }
            const guild = getInteractionGuild(interaction);
            const guildId = guild.id;
            // Show the root settings menu
            await interaction.reply({
                embeds: [{
                    title: 'ScapeBot Settings',
                    description: 'TODO: Fill me out'
                }],
                components: [{
                    type: ComponentType.ActionRow,
                    components: [{
                        type: ComponentType.ChannelSelect,
                        custom_id: 'settings:selectTrackingChannel',
                        min_values: 1,
                        max_values: 1,
                        placeholder: state.hasTrackingChannel(guildId) ? state.getTrackingChannel(guildId).name : 'Click to set tracking channel',
                        channel_types: [ChannelType.GuildText]
                    }]
                }, {
                    type: ComponentType.ActionRow,
                    components: [{
                        type: ComponentType.RoleSelect,
                        custom_id: 'settings:selectPrivilegedRole',
                        min_values: 0,
                        max_values: 1,
                        placeholder: state.hasPrivilegedRole(guildId) ? state.getPrivilegedRole(guildId).name : 'Click to set privileged role'
                    }]
                }, {
                    type: ComponentType.ActionRow,
                    components: [{
                        type: ComponentType.Button,
                        style: ButtonStyle.Secondary,
                        label: 'Skill Settings',
                        custom_id: 'settings:skills'
                    }, {
                        type: ComponentType.Button,
                        style: ButtonStyle.Secondary,
                        label: 'Other Settings',
                        custom_id: 'settings:other'
                    }]
                }],
                ephemeral: true
            });
            return true;
        },
        text: 'Changes settings for ScapeBot in this guild',
        admin: true
    }
};

export default slashCommands;
