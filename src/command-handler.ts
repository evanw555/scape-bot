import { ApplicationCommandDataResolvable, ChatInputCommandInteraction, Interaction, PermissionFlagsBits } from 'discord.js';
import commands, { INVALID_TEXT_CHANNEL } from './commands';

import state from './instances/state';
import logger from './instances/logger';
import { CommandName } from './types';

const UNAUTHORIZED_USER = 'err/unauthorized-user';
const STATE_DISABLED = 'err/state-disabled';

class CommandHandler {
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

    static failIfDisabled() {
        if (state.isDisabled()) {
            throw new Error(STATE_DISABLED);
        }
    }

    static isValidCommand(commandName: string): commandName is CommandName {
        return Object.prototype.hasOwnProperty.call(commands, commandName);
    }

    static async handleError(interaction: ChatInputCommandInteraction, err: Error) {
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
        } else if (err.message === STATE_DISABLED) {
            await interaction.reply({
                content: 'I can\'t do that while I\'m disabled',
                ephemeral: true
            });
        } else {
            logger.log(`Uncaught error while trying to execute command '${interaction.commandName}': ${err.toString()}`);
        }  
    }

    buildCommands(): ApplicationCommandDataResolvable[] {
        const commandKeys = Object.keys(commands) as CommandName[];
        const data: ApplicationCommandDataResolvable[] = [];
        commandKeys.forEach((key) => {
            if (typeof commands[key].build === 'function') {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                const command = commands[key].build!();
                data.push(command);
            }
        });
        return data;
    }

    async handle(interaction: Interaction) {
        if (!interaction.isChatInputCommand()) {
            return;
        }
        if (!CommandHandler.isValidCommand(interaction.commandName)) {
            await interaction.reply((`**${interaction.commandName}** is not a valid command, use **/help** to see a list of commands`));
            return;
        }
        const command = commands[interaction.commandName];
        try {
            if (command.failIfDisabled) {
                CommandHandler.failIfDisabled();
            }
            if (command.privileged) {
                CommandHandler.assertIsAdmin(interaction);
            }
            command.execute && await command.execute(interaction);
            logger.log(`Executed command '${interaction.commandName}' with options \`${JSON.stringify(interaction.options)}\``);
        } catch (err) {
            if (err instanceof Error) {
                await CommandHandler.handleError(interaction, err);
            } else {
                logger.log(`Unexpected error while trying to execute command '${interaction.commandName}': \`${JSON.stringify(err)}\``);
            }
        }
    }
}

export default CommandHandler;
