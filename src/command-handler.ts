import { Interaction, PermissionFlagsBits, TextBasedChannel } from 'discord.js';
import { deleteTrackedPlayer, insertTrackedPlayer, updateTrackingChannel } from './pg-storage';
import { BOSSES } from 'osrs-json-hiscores';
import { getBossName } from './boss-utility';
import { fetchHiScores } from './hiscores';
import { updatePlayer, replyUpdateMessage } from './util';
import { CLUES_NO_ALL, SKILLS_NO_OVERALL, CONSTANTS } from './constants';
import state from './instances/state';
import logger from './instances/logger';

const INVALID_TEXT_CHANNEL = 'err/invalid-text-channel';
const UNAUTHORIZED_USER = 'err/unauthorized-user';

class CommandHandler {
    static getInteractionGuildId(interaction: Interaction): string {
        if (typeof interaction.guildId !== 'string') {
            throw new Error(INVALID_TEXT_CHANNEL);
        }
        return interaction.guildId;
    }

    /**
     * Asserts the interacting user has administrator permissions in the
     * guild or is a bot admin.
     */
    static assertIsAdmin(interaction: Interaction) {
        if (
            !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
            && !state.isAdmin(interaction.user.id)
        ) {
            throw new Error(UNAUTHORIZED_USER);
        }
    }

    async handle(interaction: Interaction) {
        if (!interaction.isChatInputCommand()) {
            return;
        }
        try {
            if (interaction.commandName === 'ping') {
                await interaction.reply('pong!');
            } else if (interaction.commandName === 'track') {
                const guildId = CommandHandler.getInteractionGuildId(interaction);
                const rsn = interaction.options.getString('username') as string;
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
            } else if (interaction.commandName === 'remove') {
                const guildId = CommandHandler.getInteractionGuildId(interaction);
                const rsn = interaction.options.getString('username') as string;
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
            } else if (interaction.commandName === 'clear') {
                CommandHandler.assertIsAdmin(interaction);
                const guildId = CommandHandler.getInteractionGuildId(interaction);
                // TODO: Can we add a batch delete operation?
                for (const rsn of state.getAllTrackedPlayers(guildId)) {
                    await deleteTrackedPlayer(guildId, rsn);
                }

                state.clearAllTrackedPlayers(guildId);
                await interaction.reply({ content: 'No longer tracking any players', ephemeral: true });
            } else if (interaction.commandName === 'list') {
                const guildId = CommandHandler.getInteractionGuildId(interaction);
                if (state.isTrackingAnyPlayers(guildId)) {
                    await interaction.reply({
                        content: `Currently tracking players **${state.getAllTrackedPlayers(guildId).join('**, **')}**`,
                        ephemeral: true
                    });
                } else {
                    interaction.reply({ content: 'Currently not tracking any players', ephemeral: true });
                }
            } else if (interaction.commandName === 'check') {
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
            } else if (interaction.commandName === 'channel') {
                CommandHandler.assertIsAdmin(interaction);
                const guildId = CommandHandler.getInteractionGuildId(interaction);
                await updateTrackingChannel(guildId, interaction.channelId);
                const textChannel = interaction.channel as TextBasedChannel;
                state.setTrackingChannel(guildId, textChannel);
                await interaction.reply('Player experience updates will now be sent to this channel');
            }
            logger.log(`Executed command '${interaction.commandName}' with options \`${JSON.stringify(interaction.options)}\``);
        } catch (err) {
            if (err instanceof Error) {
                if (err.message === INVALID_TEXT_CHANNEL) {
                    await interaction.reply({
                        content: 'This command can only be used in a guild text channel!',
                        ephemeral: true
                    });
                } else if (err.message === UNAUTHORIZED_USER) {
                    await interaction.reply({
                        content: 'You can\'t do that',
                        ephemeral: true
                    });
                } else {
                    logger.log(`Uncaught error while trying to execute command '${interaction.commandName}': ${err.toString()}`);
                }  
            }
        }
    }
}

export default CommandHandler;
