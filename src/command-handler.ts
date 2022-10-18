import { Interaction, Snowflake } from 'discord.js';
import { deleteTrackedPlayer, insertTrackedPlayer } from './pg-storage';
import { updatePlayer } from './util';
import state from './instances/state';
import logger from './instances/logger';

class CommandHandler {
    async handle(interaction: Interaction) {
        try {
            if (!interaction.isChatInputCommand()) {
                return;
            }
            if (interaction.commandName === 'ping') {
                await interaction.reply('pong!');
            }
            if (interaction.commandName === 'track') {
                const guildId: Snowflake | null = interaction.guildId;
                if (!guildId) {
                    await interaction.reply({
                        content: 'This command can only be used in a guild text channel!',
                        ephemeral: true
                    });
                    return;
                }
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
            }
            if (interaction.commandName === 'remove') {
                const guildId: Snowflake | null = interaction.guildId;
                if (!guildId) {
                    await interaction.reply({
                        content: 'This command can only be used in a guild text channel!',
                        ephemeral: true
                    });
                    return;
                }
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
            }
            if (interaction.commandName === 'list') {
                const guildId: Snowflake | null = interaction.guildId;
                if (!guildId) {
                    await interaction.reply({
                        content: 'This command can only be used in a guild text channel!',
                        ephemeral: true
                    });
                    return;
                }
                if (state.isTrackingAnyPlayers(guildId)) {
                    await interaction.reply({
                        content: `Currently tracking players **${state.getAllTrackedPlayers(guildId).join('**, **')}**`,
                        ephemeral: true
                    });
                } else {
                    interaction.reply({ content: 'Currently not tracking any players', ephemeral: true });
                }
            }
            logger.log(`Executed command '${interaction.commandName}' with options \`${JSON.stringify(interaction.options)}\``);
        } catch (err) {
            if (err instanceof Error) {
                const commandName = interaction.isChatInputCommand() ? interaction.commandName : 'N/A';
                logger.log(`Uncaught error while trying to execute command '${commandName}': ${err.toString()}`);
            }
        }
    }
}

export default CommandHandler;
