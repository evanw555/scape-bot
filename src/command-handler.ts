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
import { INVALID_TEXT_CHANNEL, UNAUTHORIZED_USER, STATE_DISABLED, UNAUTHORIZED_ROLE } from './constants';
import {
    BuiltSlashCommand,
    SlashCommandName,
    CommandOption,
    CommandWithOptions,
    SlashCommand,
    SlashCommandsType
} from './types';

import state from './instances/state';
import logger from './instances/logger';

class CommandHandler {
    commands: SlashCommandsType;

    constructor(commands: SlashCommandsType) {
        this.commands = commands;
    }

    /**
     * Asserts the interacting user has administrator permissions in the
     * guild or is a bot maintainer.
     */
    static assertIsAdmin(interaction: Interaction) {
        if (!CommandHandler.isAdmin(interaction)) {
            throw new Error(UNAUTHORIZED_USER);
        }
    }

    static isAdmin(interaction: Interaction) {
        return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
            || state.isMaintainer(interaction.user.id);
    }

    static assertHasPrivilegedRole(interaction: Interaction) {
        if (!interaction.guild) {
            throw new Error(INVALID_TEXT_CHANNEL);
        }
        // If there is no saved privileged role then reject the command
        if (!state.hasPrivilegedRole(interaction.guild.id)) {
            throw new Error(UNAUTHORIZED_ROLE);
        } 
        const privilegedRole = state.getPrivilegedRole(interaction.guild.id);
        const role = interaction.guild.roles.cache.get(privilegedRole.id);
        // If the saved role does not exist, then it has been removed
        if (!role) {
            logger.log(`Privileged role in state is no longer valid in the guild '${interaction.guild.id}'`, MultiLoggerLevel.Warn);
            throw new Error(UNAUTHORIZED_ROLE);
        }
        if (!role.members.has(interaction.user.id)) {
            throw new Error(UNAUTHORIZED_ROLE);
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

    static isCommandWithOptions(command: SlashCommand): command is CommandWithOptions {
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
        } else if (err.message === UNAUTHORIZED_ROLE) {
            const guildId = interaction.guildId as string;
            const content = state.hasPrivilegedRole(guildId)
                ? `You must have the ${state.getPrivilegedRole(guildId)} role to use this command`
                : 'You are not an admin and there is no role set for this command';
            await interaction.reply({
                content,
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
            } else if (optionInfo.type === ApplicationCommandOptionType.Mentionable) {
                builder = builder.addMentionableOption((option => CommandHandler.buildCommandOption(option, optionInfo)));
            } else if (optionInfo.type === ApplicationCommandOptionType.Role) {
                builder = builder.addRoleOption((option => CommandHandler.buildCommandOption(option, optionInfo)));
            }
        });
        return builder;
    }
    /**
     * Flexible method that takes static slash command data and uses the key/value arguments
     * to filter the list.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static filterCommands(commands: SlashCommandsType, field: keyof SlashCommand, value: any = true) {
        const commandKeys = Object.keys(commands) as SlashCommandName[];
        return commandKeys.filter((c: SlashCommandName) => (commands[c][field] === value));
    }

    isValidCommand(commandName: string): commandName is SlashCommandName {
        return Object.prototype.hasOwnProperty.call(this.commands, commandName);
    }

    /**
     * Gets all privileged command keys (names), i.e. commands where the 'privileged
     * field is true.
     */
    getPrivilegedCommandKeys() {
        const commandKeys = Object.keys(this.commands) as SlashCommandName[];
        return commandKeys.filter(name => this.commands[name].privileged);
    }

    /**
     * Takes a command key (name) and instantiates a new SlashCommandBuilder to create
     * a new command using the corresponding data in the static command list.
     */
    buildCommand(key: SlashCommandName): ApplicationCommandDataResolvable {
        const commandInfo = this.commands[key];
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
        return command;
    }

    /**
     * Gets the static command data, filters out guild-only commands, and uses the
     * command builder to create slash commands objects registerable with Discord.
     */
    buildCommands(): ApplicationCommandDataResolvable[] {
        const commandKeys = Object.keys(this.commands) as SlashCommandName[];
        const data: ApplicationCommandDataResolvable[] = [];
        commandKeys.forEach((key) => {
            data.push(this.buildCommand(key));
        });
        return data;
    }

    async handleChatInputCommand(interaction: Interaction) {
        if (!interaction.isChatInputCommand()) {
            return;
        }
        if (!this.isValidCommand(interaction.commandName)) {
            await interaction.reply((`**${interaction.commandName}** is not a valid command, use **/help** to see a list of commands`));
            return;
        }
        const command = this.commands[interaction.commandName];
        const debugString = `\`${interaction.user.tag}\` executed command \`${interaction.toString()}\` in ${interaction.channel}`;
        try {
            if (command.failIfDisabled) {
                CommandHandler.failIfDisabled();
            }
            if (command.privileged) {
                CommandHandler.assertIsAdmin(interaction);
            }
            if (command.privilegedRole) {
                // Only need to check role if user is not an admin
                if (!CommandHandler.isAdmin(interaction)) { 
                    CommandHandler.assertHasPrivilegedRole(interaction);
                }
            }
            if (typeof command.execute === 'function') {
                await command.execute(interaction);
                logger.log(debugString, MultiLoggerLevel.Info);
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
        if (!this.isValidCommand(interaction.commandName)) {
            await CommandHandler.sendEmptyResponse(interaction);
            return;
        }
        const command = this.commands[interaction.commandName];
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
            logger.log(debugString, MultiLoggerLevel.Debug);
        } catch (err) {
            logger.log(`Unexpected error when ${debugString}: \`${err}\``, MultiLoggerLevel.Error);
        }
    }
}

export default CommandHandler;
