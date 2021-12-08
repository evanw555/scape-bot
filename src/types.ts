import { Message } from "discord.js";

export interface SerializedState {
    players: string[],
    trackingChannelId?: string,
    levels: Record<string, Record<string, number>>,
    bosses: Record<string, Record<string, number>>
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

export interface SkillPayload {
    level: any
    // TODO: add other properties that we may want to use
}

export interface BossPayload {
    score: any
    // TODO: add other properties that we may want to use
}

export interface PlayerPayload {
    skills: Record<string, SkillPayload>,
    bosses: Record<string, BossPayload>
}