import { Message } from "discord.js";

export interface SerializedState {
    timestamp: string,
    players: string[],
    playersOffHiScores: string[],
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
    level: string,
    xp: string,
    rank: string
}

export interface BossPayload {
    score: string,
    xp: string,
    rank: string
}

export interface PlayerPayload {
    skills: Record<string, SkillPayload>,
    bosses: Record<string, BossPayload>
}