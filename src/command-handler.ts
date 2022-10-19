import {
    ApplicationCommandDataResolvable,
    ApplicationCommandOptionType,
    ChatInputCommandInteraction,
    Interaction,
    PermissionFlagsBits,
    SlashCommandBuilder
} from 'discord.js';
import commands, { INVALID_TEXT_CHANNEL } from './commands';
import { BuiltSlashCommand, CommandName, CommandOption } from './types';

import state from './instances/state';
import logger from './instances/logger';

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static buildCommandOption = (option: any, optionInfo: CommandOption) =>
        option
            .setName(optionInfo.name)
            .setDescription(optionInfo.description)
            .setRequired(optionInfo.required || false);

    static buildCommandOptions(builder: BuiltSlashCommand, options: CommandOption[]) {
        options.forEach((optionInfo: CommandOption) => {
            if (optionInfo.type === ApplicationCommandOptionType.String) {
                builder = builder.addStringOption((option) => CommandHandler.buildCommandOption(option, optionInfo));
            } else if (optionInfo.type === ApplicationCommandOptionType.Integer) {
                builder = builder.addIntegerOption((option) => CommandHandler.buildCommandOption(option, optionInfo));
            }
        });
        return builder;
    }

    buildCommands(): ApplicationCommandDataResolvable[] {
        const commandKeys = Object.keys(commands) as CommandName[];
        const data: ApplicationCommandDataResolvable[] = [];
        commandKeys.forEach((key) => {
            // We can check for existence of the execute() function for now, this is only
            // temporary until all commands are migrated over to slash commands
            if (typeof commands[key].execute === 'function') {
                const commandInfo = commands[key];
                let command: BuiltSlashCommand = new SlashCommandBuilder()
                    .setName(key)
                    .setDescription(commandInfo.text);
                // If command has the privileged flag, set the command permissions to admin
                if (commandInfo.privileged) {
                    command = command.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
                }
                // Build the command options if they exist
                if (commandInfo.options) {
                    command = CommandHandler.buildCommandOptions(command, commandInfo.options);
                }
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
        const debugString = `\`${interaction.user.tag}\` executed command \`${interaction.commandName}\` in ${interaction.channel} with options \`${JSON.stringify(interaction.options.data)}\``;
        try {
            if (command.failIfDisabled) {
                CommandHandler.failIfDisabled();
            }
            if (command.privileged) {
                CommandHandler.assertIsAdmin(interaction);
            }
            if (typeof command.execute === 'function') {
                await command.execute(interaction);
                logger.log(debugString);
            } else {
                await interaction.reply(`Warning: slash command does not exist yet for command: ${interaction.commandName}`);
            }
        } catch (err) {
            if (err instanceof Error) {
                await CommandHandler.handleError(interaction, err);
            } else {
                logger.log(`Unexpected error when ${debugString}: \`${err}\``);
            }
        }
    }
}

export default CommandHandler;
