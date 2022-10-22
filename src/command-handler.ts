import {
    ApplicationCommandDataResolvable,
    ApplicationCommandOptionType,
    AutocompleteInteraction,
    ChatInputCommandInteraction,
    Interaction,
    PermissionFlagsBits,
    SlashCommandBuilder
} from 'discord.js';
import { MultiLoggerLevel } from 'evanw555.js';
import commands, { INVALID_TEXT_CHANNEL } from './commands';
import { BuiltSlashCommand, Command, CommandName, CommandOption, CommandWithOptions } from './types';

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

    static async sendEmptyResponse(interaction: AutocompleteInteraction) {
        await interaction.respond([]);
    }

    static isValidCommand(commandName: string): commandName is CommandName {
        return Object.prototype.hasOwnProperty.call(commands, commandName);
    }

    static isCommandWithOptions(command: Command): command is CommandWithOptions {
        return Array.isArray(command.options);
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
            logger.log(`Uncaught error while trying to execute command '${interaction.commandName}': ${err.toString()}`, MultiLoggerLevel.Error);
        }  
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static buildCommandOption = (builder: any, optionInfo: CommandOption) => {
        let option = builder
            .setName(optionInfo.name)
            .setDescription(optionInfo.description);
        // Set the option as required if necessary
        if (optionInfo.required) {
            option = option.setRequired(optionInfo.required);
        }
        if (optionInfo.choices && optionInfo.choices.length) {
            // Only set autocomplete if there are >25 choices for completion
            const autocomplete = optionInfo.choices.length > 25;
            option = option.setAutocomplete(autocomplete);
            // If there are choices and autocomplete is not on, then add them to
            // the list of static choices
            if (!autocomplete) {
                option = option.addChoices(optionInfo.choices);
            }
        }
        return option;
    };

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

    async handleChatInput(interaction: Interaction) {
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
                logger.log(debugString, MultiLoggerLevel.Warn);
            } else {
                await interaction.reply(`Warning: slash command does not exist yet for command: ${interaction.commandName}`);
            }
        } catch (err) {
            if (err instanceof Error) {
                await CommandHandler.handleError(interaction, err);
            } else {
                logger.log(`Unexpected error when ${debugString}: \`${err}\``, MultiLoggerLevel.Error);
            }
        }
    }

    async handleAutocomplete(interaction: Interaction) {
        if (!interaction.isAutocomplete()) {
            return;
        }
        if (!CommandHandler.isValidCommand(interaction.commandName)) {
            await CommandHandler.sendEmptyResponse(interaction);
            return;
        }
        const command = commands[interaction.commandName];
        const focusedOption = interaction.options.getFocused(true);
        const debugString = `\`${interaction.user.tag}\` called autocomplete for \`${interaction.commandName}\` in ${interaction.channel} with value \`${focusedOption.value}\``;
        if (!CommandHandler.isCommandWithOptions(command)) {
            await CommandHandler.sendEmptyResponse(interaction);
            return;
        }
        try {
            const commandOption = command.options.find(o => o.name === focusedOption.name);
            if (!focusedOption.value || !commandOption || !commandOption.choices) {
                await CommandHandler.sendEmptyResponse(interaction);
                return;
            }
            // TODO: We can definitely improve this search functionality
            const filtered = commandOption.choices.filter(choice => choice.value.toLowerCase()
                .startsWith(focusedOption.value.toLowerCase()));
            await interaction.respond(filtered);
            logger.log(debugString, MultiLoggerLevel.Warn);
        } catch (err) {
            logger.log(`Unexpected error when ${debugString}: \`${err}\``, MultiLoggerLevel.Error);
        }
    }
}

export default CommandHandler;
