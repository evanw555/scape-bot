import { ApplicationCommandOptionType, ChatInputCommandInteraction, Message, SlashCommandBuilder, Snowflake } from 'discord.js';
import { Boss, ClueType, SkillName } from 'osrs-json-hiscores';
import { ClientConfig } from 'pg';
import { TIMEOUTS_PROPERTY } from './constants';

export enum TimeoutType {
    WeeklyXpUpdate = 'WEEKLY_XP_UPDATE'
}

export interface AnyObject {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: string | number | any;
}

export interface ScapeBotAuth {
    token: string,
    // TODO: Support multiple "maintainers" and specify one UserId to log to via DM
    adminUserId: Snowflake,
    pg: ClientConfig,
    clientId?: Snowflake,
    guildId?: Snowflake
}

export interface ScapeBotLoggerConfig {
    logCapacity: number,
    logMaxEntryLength: number
}

export interface ScapeBotConfig {
    refreshInterval: number,
    timeZone: string,
    debugLog: ScapeBotLoggerConfig,
    infoLog: ScapeBotLoggerConfig
}

export interface ScapeBotConstants {
    skills: SkillName[],
    miscThumbnails: string[],
    baseThumbnailUrl: string,
    level99Path: string,
    miscThumbnailPath: string,
    clueThumbnailPath: string,
    imageFileExtension: string,
    hiScoresUrlTemplate: string,
    osrsWikiBaseUrl: string
}

export type IndividualSkillName = Exclude<SkillName, 'overall'>;
export type IndividualClueType = Exclude<ClueType, 'all'>;

export interface SerializedGuildState {
    trackingChannelId?: Snowflake,
    players: string[]
}

export type MiscPropertyName = 'timestamp' | 'disabled' | typeof TIMEOUTS_PROPERTY;

export type BuiltSlashCommand = SlashCommandBuilder | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>;

export type SlashCommandName = 'help' | 'ping' | 'info' | 'track' | 'remove' | 'clear' | 'list' | 'check' | 'channel' | 'kc' | 'details' | 'role';

export type HiddenCommandName = 'help' | 'log' | 'thumbnail' | 'thumbnail99' | 'spoof' | 'spoofverbose' | 'uptime' | 'kill' | 'enable';

export type CommandsType = Record<string, Command>;
export type SlashCommandsType = Record<SlashCommandName, SlashCommand>;
export type HiddenCommandsType = Record<HiddenCommandName, HiddenCommand>;

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

export interface Command {
    text: string,
    privileged?: boolean,
    privilegedRole?: boolean,
    failIfDisabled?: boolean
}

export interface SlashCommand extends Command {
    options?: CommandOption[],
    execute: (interaction: ChatInputCommandInteraction) => Promise<void>
}

export interface HiddenCommand extends Command {
    fn: (msg: Message, rawArgs: string, ...args: string[]) => void
}

export interface CommandWithOptions extends SlashCommand {
    options: CommandOption[]
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
    cluesWithDefaults: Record<IndividualClueType, number>
}
