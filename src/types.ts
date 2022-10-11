import { Message, Snowflake } from 'discord.js';
import { Boss, SkillName } from 'osrs-json-hiscores';
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

export type IndividualSkillName = Exclude<SkillName, 'overall'>;

export interface SerializedGuildState {
    trackingChannelId?: Snowflake,
    players: string[]
}

export interface SerializedState {
    timestamp?: string,
    disabled?: boolean,
    guilds: Record<Snowflake, SerializedGuildState>,
    playersOffHiScores: string[],
    botCounters: Record<Snowflake, number>
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

export interface PlayerHiScores {
    onHiScores: boolean,
    totalXp?: number,
    baseLevel?: number,
    totalLevel?: number,
    totalBossKills?: number,
    levels: Partial<Record<IndividualSkillName, number>>,
    levelsWithDefaults: Record<IndividualSkillName, number>,
    bosses: Partial<Record<Boss, number>>,
    bossesWithDefaults: Record<Boss, number>
}