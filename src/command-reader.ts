import { Message } from 'discord.js';
import { ParsedCommand, Command } from './types';

import commands from './commands';
import log from './log';
import state from './state';

class CommandReader {
    constructor() {

    }

    read(msg: Message): void {
        // Parse command
        let parsedCommand: ParsedCommand;
        try {
            parsedCommand = CommandReader.parseCommand(msg.content);
        } catch (err) {
            log.push(`Failed to parse command '${msg.content}': ${err.toString()}`);
            return;
        }
        // Execute command
        const { command, args, rawArgs } = parsedCommand;
        if (commands.hasOwnProperty(command)) {
            const commandInfo: Command = commands[command];
            if (commandInfo.privileged && !state.isOwner(msg.author.id)) {
                msg.channel.send('You can\'t do that');
            } else {
                try {
                    commandInfo.fn(msg, rawArgs, ...args);
                    log.push(`Executed command '${command}' with args ${JSON.stringify(args)}`);
                } catch (err) {
                    log.push(`Uncaught error while trying to execute command '${msg.content}': ${err.toString()}`);
                }
            }
        } else if (command) {
            msg.channel.send(`**${command}** is not a valid command, use **help** to see a list of commands`);
        } else {
            msg.channel.send(`What's up <@${msg.author.id}>`);
        }
    }

    static parseCommand(text: string): ParsedCommand {
        const args = CommandReader.extractArgs(text);
        return {
            text,
            command: args[0],
            args: args.splice(1),
            rawArgs: text.replace(/<@!?\d+>/g, '') // Remove user mentions from the text
                         .trim()
                         .replace(new RegExp(`^${args[0]}`, 'g'), '') // Remove the core command from the args string
                         .trim()
        };
    };

    /**
     * Searches string of text submitted to bot for
     * spaces and quotes to tokenize arguments. Supports
     * single- and double-quotes, and tick marks.
     *
     * text = '@ScapeBot kc "big belly" "the corrupted gauntlet"'; // text submitted to bot
     * args = extractArgs(text); // tokenizes arguments from text and removes mention
     * console.log(args); // ['kc', 'big belly', 'the corrupted gauntlet']
     *
     * @param {string} text string of text sent to bot
     * @returns {string[]} array of arguments tokenized by quote and/or space
     */
    static extractArgs(text: string): string[] {
        // eslint-disable-next-line quotes
        const SINGLE_QUOTE_CHAR = `'`;
        const DOUBLE_QUOTE_CHAR = '"';
        const TICK_CHAR = '`';
        const SPACE_CHAR = ' ';
        const args = [];
        // remove start/end, extra whitespace
        const chars = text.trim().replace(/\s+/g, ' ').toLowerCase().split('');
        let i = 0;
        while (i < chars.length) {
            const c = chars[i];
            if (i === 0 && c !== SPACE_CHAR) {
                // find first space (cannot be first character)
                const j = chars.indexOf(SPACE_CHAR);
                // if no space, assume no arguments and break
                if (j === -1) {
                    // first token is characters before end
                    const firstToken = chars.slice(i).join('');
                    args.push(firstToken);
                    break;
                // otherwise, find first token and continue
                } else {
                    // first token is characters before first space
                    const firstToken = chars.slice(i, j).join('');
                    args.push(firstToken);
                    i = j;
                }
            } else if (c === SPACE_CHAR) {
                // find index of first char after space
                const tokenStart = i + 1;
                // increment i and step forward if next char is quote
                if (
                    chars[tokenStart] === SINGLE_QUOTE_CHAR
                    || chars[tokenStart] === DOUBLE_QUOTE_CHAR
                    || chars[tokenStart] === TICK_CHAR
                ) {
                    i = tokenStart;
                // otherwise, find token after space
                } else {
                    // find index of next space
                    const j = chars.indexOf(c, tokenStart);
                    if (j === -1) {
                        // if no space, end of text
                        const token = chars.slice(tokenStart).join('');
                        args.push(token);
                        break;
                    } else {
                        // otherwise, token is chars up to next space
                        const token = chars.slice(tokenStart, j).join('');
                        args.push(token);
                        i = j;
                    }
                }
            } else if (
                c === SINGLE_QUOTE_CHAR
                || c === DOUBLE_QUOTE_CHAR
                || c === TICK_CHAR
            ) {
                // find index of first char after quote
                const tokenStart = i + 1;
                // find index of next quote
                const j = chars.indexOf(c, tokenStart);
                if (j === -1) {
                    // if no quote, end of text
                    const token = chars.slice(tokenStart).join('');
                    args.push(token);
                    break;
                } else {
                    // otherwise, token is chars up to next quote
                    let token = chars.slice(tokenStart, j).join('');
                    // trim token b/c above regex does not remove
                    // start/end space in quoted text
                    token = token.trim();
                    args.push(token);
                    i = j;
                }
            } else {
                i += 1;
            }
            // ugly check to prevent infinite loops
            if (i === -1) {
                break;
            }
        }
        // remove bot mention from args
        return args.filter((arg) => {
            return arg && arg.indexOf('@') === -1;
        });
    };
}

export default CommandReader;
