import { Message, Snowflake } from 'discord.js';
import { SkillName } from 'osrs-json-hiscores';
import { ClientConfig } from 'pg';

export enum TimeoutType {
    WeeklyXpUpdate = 'WEEKLY_XP_UPDATE'
}

export interface AnyObject {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: string | number | any;
}

export interface ScapeBotAuth {
    token: string,
    adminUserId: Snowflake,
    pg: ClientConfig
}

export interface ScapeBotConfig {
    refreshInterval: number,
    logCapacity: number,
    logMaxEntryLength: number,
    timeZone: string
}

export interface ScapeBotConstants {
    skills: SkillName[],
    miscThumbnails: string[],
    baseThumbnailUrl: string,
    level99Path: string,
    miscThumbnailPath: string,
    imageFileExtension: string,
    hiScoresUrlTemplate: string,
    osrsWikiBaseUrl: string
}

export interface SerializedGuildState {
    trackingChannelId?: Snowflake,
    players: string[]
}

export interface SerializedState {
    timestamp?: string,
    disabled?: boolean,
    guilds: Record<Snowflake, SerializedGuildState>,
    playersOffHiScores: string[],
    levels: Record<string, Record<string, number>>,
    bosses: Record<string, Record<string, number>>,
    botCounters: Record<Snowflake, number>,
    // TODO: Remove these
    weeklyTotalXpSnapshots?: Record<string, number>
    players?: string[],
    trackingChannelId?: string
}

export interface Command {
    fn: (msg: Message, rawArgs: string, ...args: string[]) => void,
    text: string,
    hidden?: boolean,
    privileged?: boolean,
    failIfDisabled?: boolean
}

export interface ParsedCommand {
    text: string,
    command: string,
    args: string[],
    rawArgs: string
}
