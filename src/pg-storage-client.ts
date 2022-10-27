import { Snowflake } from 'discord.js';
import { MultiLoggerLevel } from 'evanw555.js';
import { Boss } from 'osrs-json-hiscores';
import { Client, ClientConfig } from 'pg';
import format from 'pg-format';
import { IndividualSkillName, IndividualClueType, MiscPropertyName } from './types';

import logger from './instances/logger';

export default class PGStorageClient {
    private static readonly TABLES: Record<string, string> = {
        'weekly_xp_snapshots': 'CREATE TABLE weekly_xp_snapshots (rsn VARCHAR(12) PRIMARY KEY, xp BIGINT);',
        'player_levels': 'CREATE TABLE player_levels (rsn VARCHAR(12), skill VARCHAR(12), level SMALLINT, PRIMARY KEY (rsn, skill));',
        'player_bosses': 'CREATE TABLE player_bosses (rsn VARCHAR(12), boss VARCHAR(32), score SMALLINT, PRIMARY KEY (rsn, boss));',
        'player_clues': 'CREATE TABLE player_clues (rsn VARCHAR(12), clue VARCHAR(12), score SMALLINT, PRIMARY KEY (rsn, clue));',
        'tracked_players': 'CREATE TABLE tracked_players (guild_id BIGINT, rsn VARCHAR(12), PRIMARY KEY (guild_id, rsn));',
        'tracking_channels': 'CREATE TABLE tracking_channels (guild_id BIGINT PRIMARY KEY, channel_id BIGINT);',
        'player_hiscore_status': 'CREATE TABLE player_hiscore_status (rsn VARCHAR(12) PRIMARY KEY, on_hiscores BOOLEAN);',
        'bot_counters': 'CREATE TABLE bot_counters (user_id BIGINT PRIMARY KEY, counter INTEGER);',
        'misc_properties': 'CREATE TABLE misc_properties (name VARCHAR(32) PRIMARY KEY, value VARCHAR(2048));'
    };

    private readonly client: Client;

    constructor(clientConfig: ClientConfig) {
        this.client = new Client(clientConfig);
    }
    
    async connect() {
        await this.client.connect();
    }

    toString(): string {
        return `PGStorageClient@${this.client.host}:${this.client.port}`;
    }

    async initializeTables(): Promise<void> {
        const results: string[] = [];
        for (const [ tableName, tableSchema ] of Object.entries(PGStorageClient.TABLES)) {
            if (await this.doesTableExist(tableName)) {
                results.push(`✅ Table \`${tableName}\` exists`);
            } else {
                await this.client.query(tableSchema);
                results.push(`⚠️ Table \`${tableName}\` created`);
            }
        }
        await logger.log(results.join('\n'), MultiLoggerLevel.Warn);
    }
    
    async doesTableExist(name: string): Promise<boolean> {
        return (await this.client.query<{ exists: boolean }>('SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1);', [name])).rows[0].exists;
    }
    
    async writeWeeklyXpSnapshots(snapshots: Record<Snowflake, number>): Promise<void> {
        await this.client.query(format('INSERT INTO weekly_xp_snapshots VALUES %L ON CONFLICT (rsn) DO UPDATE SET xp = EXCLUDED.xp;', Object.entries(snapshots)));
    }
    
    async fetchWeeklyXpSnapshots(): Promise<Record<Snowflake, number>> {
        const result: Record<Snowflake, number> = {};
        const res = await this.client.query<{rsn: string, xp: number}>('SELECT * FROM weekly_xp_snapshots;');
        for (const row of res.rows) {
            result[row.rsn] = row.xp;
        }
        return result;
    }
    
    async writePlayerLevels(rsn: string, levels: Record<string, number>): Promise<void> {
        if (Object.keys(levels).length === 0) {
            return;
        }
        const values = Object.keys(levels).map(skill => [rsn, skill, levels[skill]]);
        if (values.length === 0) {
            return;
        }
        await this.client.query(format('INSERT INTO player_levels VALUES %L ON CONFLICT (rsn, skill) DO UPDATE SET level = EXCLUDED.level;', values));
    }
    
    async fetchAllPlayerLevels(): Promise<Record<string, Partial<Record<IndividualSkillName, number>>>> {
        const result: Record<string, Partial<Record<IndividualSkillName, number>>> = {};
        const queryResult = await this.client.query<{rsn: string, skill: IndividualSkillName, level: number}>('SELECT * FROM player_levels;');
        for (const row of queryResult.rows) {
            if (!result[row.rsn]) {
                result[row.rsn] = {};
            }
            result[row.rsn][row.skill] = row.level;
        }
        return result;
    }
    
    async writePlayerBosses(rsn: string, bosses: Record<string, number>): Promise<void> {
        const values = Object.keys(bosses).map(boss => [rsn, boss, bosses[boss]]);
        if (values.length === 0) {
            return;
        }
        await this.client.query(format('INSERT INTO player_bosses VALUES %L ON CONFLICT (rsn, boss) DO UPDATE SET score = EXCLUDED.score;', values));
    }
    
    async fetchAllPlayerBosses(): Promise<Record<string, Partial<Record<Boss, number>>>> {
        const result: Record<string, Partial<Record<Boss, number>>> = {};
        const queryResult = await this.client.query<{rsn: string, boss: Boss, score: number}>('SELECT * FROM player_bosses;');
        for (const row of queryResult.rows) {
            if (!result[row.rsn]) {
                result[row.rsn] = {};
            }
            result[row.rsn][row.boss] = row.score;
        }
        return result;
    }
    
    async writePlayerClues(rsn: string, clues: Record<string, number>): Promise<void> {
        const values = Object.keys(clues).map(clue => [rsn, clue, clues[clue]]);
        if (values.length === 0) {
            return;
        }
        await this.client.query(format('INSERT INTO player_clues VALUES %L ON CONFLICT (rsn, clue) DO UPDATE SET score = EXCLUDED.score;', values));
    }
    
    async fetchAllPlayerClues(): Promise<Record<string, Partial<Record<IndividualClueType, number>>>> {
        const result: Record<string, Partial<Record<IndividualClueType, number>>> = {};
        const queryResult = await this.client.query<{rsn: string, clue: IndividualClueType, score: number}>('SELECT * FROM player_clues;');
        for (const row of queryResult.rows) {
            if (!result[row.rsn]) {
                result[row.rsn] = {};
            }
            result[row.rsn][row.clue] = row.score;
        }
        return result;
    }
    
    async fetchAllTrackedPlayers(): Promise<Record<Snowflake, string[]>> {
        const result: Record<Snowflake, string[]> = {};
        const queryResult = await this.client.query<{guild_id: Snowflake, rsn: string}>('SELECT * FROM tracked_players;');
        for (const row of queryResult.rows) {
            if (!result[row.guild_id]) {
                result[row.guild_id] = [];
            }
            result[row.guild_id].push(row.rsn);
        }
        return result;
    }
    
    async insertTrackedPlayer(guildId: Snowflake, rsn: string): Promise<void> {
        await this.client.query('INSERT INTO tracked_players VALUES ($1, $2) ON CONFLICT (guild_id, rsn) DO NOTHING;', [guildId, rsn]);
    }
    
    async deleteTrackedPlayer(guildId: Snowflake, rsn: string): Promise<void> {
        await this.client.query('DELETE FROM tracked_players WHERE guild_id = $1 AND rsn = $2;', [guildId, rsn]);
    }
    
    async fetchAllTrackingChannels(): Promise<Record<Snowflake, Snowflake>> {
        const result: Record<Snowflake, Snowflake> = {};
        const queryResult = await this.client.query<{guild_id: Snowflake, channel_id: Snowflake}>('SELECT * FROM tracking_channels;');
        for (const row of queryResult.rows) {
            result[row.guild_id] = row.channel_id;
        }
        return result;
    }
    
    async updateTrackingChannel(guildId: Snowflake, channelId: Snowflake): Promise<void> {
        await this.client.query('INSERT INTO tracking_channels VALUES ($1, $2) ON CONFLICT (guild_id) DO UPDATE SET channel_id = EXCLUDED.channel_id;', [guildId, channelId]);
    }
    
    async deleteTrackingChannel(guildId: Snowflake, channelId: Snowflake): Promise<void> {
        await this.client.query('DELETE FROM tracking_channels WHERE guild_id = $1 AND channel_id = $2;', [guildId, channelId]);
    }
    
    async fetchAllPlayersWithHiScoreStatus(onHiScores: boolean): Promise<string[]> {
        const queryResult = await this.client.query<{rsn: string, on_hiscores: boolean}>('SELECT * FROM player_hiscore_status WHERE on_hiscores = $1;', [onHiScores]);
        return queryResult.rows.map(row => row.rsn);
    }
    
    async writePlayerHiScoreStatus(rsn: string, onHiScores: boolean): Promise<void> {
        await this.client.query('INSERT INTO player_hiscore_status VALUES ($1, $2) ON CONFLICT (rsn) DO UPDATE SET on_hiscores = EXCLUDED.on_hiscores;', [rsn, onHiScores]);
    }
    
    async fetchBotCounters(): Promise<Record<Snowflake, number>> {
        const result: Record<Snowflake, number> = {};
        const queryResult = await this.client.query<{user_id: Snowflake, counter: number}>('SELECT * FROM bot_counters;');
        for (const row of queryResult.rows) {
            result[row.user_id] = row.counter;
        }
        return result;
    }
    
    async writeBotCounter(userId: Snowflake, counter: number): Promise<void> {
        await this.client.query('INSERT INTO bot_counters VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET counter = EXCLUDED.counter;', [userId, counter]);
    }
    
    async fetchMiscProperty(name: MiscPropertyName): Promise<string | null> {
        try {
            const queryResult = await this.client.query<{name: string, value: string}>('SELECT * FROM misc_properties WHERE name = $1;', [name]);
            if (queryResult.rowCount === 0) {
                await logger.log(`PG ERROR: No rows found for misc property \`${name}\``, MultiLoggerLevel.Error);
                return null;
            }
            return queryResult.rows[0].value;
        } catch (err) {
            await logger.log(`PG ERROR: Unable to fetch misc property \`${name}\`: \`${err}\``, MultiLoggerLevel.Error);
            return null;
        }
    }
    
    async writeMiscProperty(name: MiscPropertyName, value: string): Promise<void> {
        await this.client.query('INSERT INTO misc_properties VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value;', [name, value]);
    }
}