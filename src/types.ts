import { ApplicationCommandOptionType, ChatInputCommandInteraction, Message, Snowflake } from 'discord.js';
import { MultiLoggerLevel } from 'evanw555.js';
import { Boss, ClueType, Gamemode, SkillName } from 'osrs-json-hiscores';
import { ClientConfig } from 'pg';
import { OTHER_ACTIVITIES_MAP, TIMEOUTS_PROPERTY } from './constants';

export enum TimeoutType {
    DailyAudit = 'DAILY_AUDIT',
    WeeklyXpUpdate = 'WEEKLY_XP_UPDATE'
}

export interface AnyObject {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: string | number | any;
}

export interface ScapeBotAuth {
    token: string,
    pg: ClientConfig,
    clientId?: Snowflake,
    maintainerUserIds?: Snowflake[],
    channelLoggers?: { id: Snowflake, level: MultiLoggerLevel, dm?: boolean }[],
    gameMode?: Gamemode
}

export interface ScapeBotLoggerConfig {
    logCapacity: number,
    logMaxEntryLength: number
}

export interface ScapeBotConfig {
    refreshInterval: number,
    presenceUpdateInterval: number,
    timeZone: string,
    debugLog: ScapeBotLoggerConfig,
    infoLog: ScapeBotLoggerConfig,
    supportInviteUrl: string
}

export interface ScapeBotConstants {
    skills: SkillName[],
    miscThumbnails: string[],
    baseThumbnailUrl: string,
    level99Path: string,
    miscThumbnailPath: string,
    clueThumbnailPath: string,
    imageFileExtension: string,
    osrsWikiBaseUrl: string
}

export type IndividualSkillName = Exclude<SkillName, 'overall'>;
export type IndividualClueType = Exclude<ClueType, 'all'>;
export type IndividualActivityName = keyof typeof OTHER_ACTIVITIES_MAP;

export interface SerializedGuildState {
    trackingChannelId?: Snowflake,
    players: string[]
}

export type MiscPropertyName = 'timestamp' | 'disabled' | 'auditCounters' | typeof TIMEOUTS_PROPERTY;

export type SlashCommandName = 'help' | 'ping' | 'info' | 'track' | 'remove' | 'clear' | 'list' | 'check' | 'channel' | 'kc' | 'details' | 'role';

export type HiddenCommandName = 'help' | 'log' | 'thumbnail' | 'thumbnail99' | 'spoof' | 'spoofverbose' | 'admin' | 'kill' | 'enable' | 'rollback' | 'removeglobal' | 'logger' | 'player' | 'refresh' | 'guildnotify' | 'hiscoresurl';

export type CommandsType = Record<string, Command>;
export type SlashCommandsType = Record<SlashCommandName, SlashCommand>;
export type HiddenCommandsType = Record<HiddenCommandName, HiddenCommand>;

type CommandExecute = (interaction: ChatInputCommandInteraction) => Promise<boolean>;

export interface CommandOptionChoice {
    name: string,
    value: string
}

export interface CommandOption {
    type: ApplicationCommandOptionType,
    name: string,
    description: string,
    required?: boolean,
    choices?: CommandOptionChoice[]
}

export interface Subcommand {
    name: string,
    description: string,
    options?: CommandOption[],
    execute?: CommandExecute
}

export interface Command {
    text: string,
    failIfDisabled?: boolean
}

export interface SlashCommand extends Command {
    options?: CommandOption[],
    subcommands?: Subcommand[],
    execute: CommandExecute,
    /**
     * If true, this command can only be invoked (and seen in help text) by guild admins (or bot maintainers).
     * Mutually exclusive with 'privilegedRole'.
     */
    admin?: boolean,
    /**
     * If true, this command can only be invoked (and seen in help text) by those with the privileged role (or admins/maintainers).
     * Mutually exclusive with 'admin'.
     */
    privilegedRole?: boolean
}

export interface HiddenCommand extends Command {
    fn: (msg: Message, rawArgs: string, ...args: string[]) => void
}

export interface CommandWithOptions extends SlashCommand {
    options: CommandOption[]
}

export interface CommandWithSubcommands extends SlashCommand {
    subcommands: Subcommand[]
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
    levels: Partial<Record<IndividualSkillName, number>>,
    levelsWithDefaults: Record<IndividualSkillName, number>,
    bosses: Partial<Record<Boss, number>>,
    bossesWithDefaults: Record<Boss, number>,
    clues: Partial<Record<IndividualClueType, number>>,
    cluesWithDefaults: Record<IndividualClueType, number>,
    activities: Partial<Record<IndividualActivityName, number>>,
    activitiesWithDefaults: Record<IndividualActivityName, number>
}

/**
 * Used to create small int labels for storing "daily_analytics" rows in PG.
 */
export enum DailyAnalyticsLabel {
    NumGuilds = 1,
    NumPlayers = 2
}

export class NegativeDiffError extends Error {}

export type GuildSetting =  /*'skills_broadcast_every_10' | 'skills_broadcast_every_5' | 'skills_broadcast_every_1' | */'bosses_broadcast_interval' | 'clues_broadcast_interval' | 'minigames_broadcast_interval' | 'weekly_ranking_max_count';
