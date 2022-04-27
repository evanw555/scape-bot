import { Message, Snowflake } from 'discord.js';

export interface AnyObject {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: string | number | any;
}

export interface SerializedState {
    timestamp?: string,
    players: string[],
    playersOffHiScores: string[],
    trackingChannelId?: string,
    levels: Record<string, Record<string, number>>,
    bosses: Record<string, Record<string, number>>,
    botCounters: Record<Snowflake, number>
}

export interface Command {
    fn: (msg: Message, rawArgs: string, ...args: string[]) => void,
    text: string,
    hidden?: boolean,
    privileged?: boolean
}

export interface ParsedCommand {
    text: string,
    command: string,
    args: string[],
    rawArgs: string
}
