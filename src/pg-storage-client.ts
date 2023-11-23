import { Snowflake } from 'discord.js';
import { MultiLoggerLevel } from 'evanw555.js';
import { Boss } from 'osrs-json-hiscores';
import { Client, ClientConfig } from 'pg';
import format from 'pg-format';
import { IndividualSkillName, IndividualClueType, IndividualActivityName, MiscPropertyName, DailyAnalyticsLabel } from './types';

import logger from './instances/logger';

type TableName = 'weekly_xp_snapshots' | 'player_total_xp' | 'player_levels' | 'player_bosses' | 'player_clues' | 'player_activities' | 'tracked_players' | 'tracking_channels' | 'player_hiscore_status' | 'player_display_names' | 'player_activity_timestamps' | 'bot_counters' | 'privileged_roles' | 'daily_analytics' | 'misc_properties';

export default class PGStorageClient {
    private static readonly TABLES: Record<TableName, string> = {
        'weekly_xp_snapshots': 'CREATE TABLE weekly_xp_snapshots (rsn VARCHAR(12) PRIMARY KEY, xp BIGINT);',
        'player_total_xp': 'CREATE TABLE player_total_xp (rsn VARCHAR(12) PRIMARY KEY, xp BIGINT);',
        'player_levels': 'CREATE TABLE player_levels (rsn VARCHAR(12), skill VARCHAR(12), level SMALLINT, PRIMARY KEY (rsn, skill));',
        'player_bosses': 'CREATE TABLE player_bosses (rsn VARCHAR(12), boss VARCHAR(32), score INTEGER, PRIMARY KEY (rsn, boss));',
        'player_clues': 'CREATE TABLE player_clues (rsn VARCHAR(12), clue VARCHAR(12), score SMALLINT, PRIMARY KEY (rsn, clue));',
        'player_activities': 'CREATE TABLE player_activities (rsn VARCHAR(12), activity VARCHAR(32), score BIGINT, PRIMARY KEY (rsn, activity));',
        'tracked_players': 'CREATE TABLE tracked_players (guild_id BIGINT, rsn VARCHAR(12), PRIMARY KEY (guild_id, rsn));',
        'tracking_channels': 'CREATE TABLE tracking_channels (guild_id BIGINT PRIMARY KEY, channel_id BIGINT);',
        'player_hiscore_status': 'CREATE TABLE player_hiscore_status (rsn VARCHAR(12) PRIMARY KEY, on_hiscores BOOLEAN);',
        'player_display_names': 'CREATE TABLE player_display_names (rsn VARCHAR(12) PRIMARY KEY, display_name VARCHAR(12));',
        'player_activity_timestamps': 'CREATE TABLE player_activity_timestamps (rsn VARCHAR(12) PRIMARY KEY, timestamp TIMESTAMPTZ);',
        'bot_counters': 'CREATE TABLE bot_counters (user_id BIGINT PRIMARY KEY, counter INTEGER);',
        'privileged_roles': 'CREATE TABLE privileged_roles (guild_id BIGINT PRIMARY KEY, role_id BIGINT);',
        'daily_analytics': 'CREATE TABLE daily_analytics (date DATE, label SMALLINT, value INTEGER, PRIMARY KEY (date, label));',
        'misc_properties': 'CREATE TABLE misc_properties (name VARCHAR(32) PRIMARY KEY, value VARCHAR(2048));'
    };

    // List of tables that should be purged if the player corresponding to a row is missing from tracked_players
    private static readonly PURGEABLE_PLAYER_TABLES: TableName[] = [
        'weekly_xp_snapshots',
        'player_total_xp',
        'player_levels',
        'player_bosses',
        'player_clues',
        'player_activities',
        'player_hiscore_status',
        'player_display_names',
        'player_activity_timestamps'
    ];

    // List of tables that should be purged when a guild removes this bot
    private static readonly PURGEABLE_GUILD_TABLES: TableName[] = [
        'tracked_players',
        'tracking_channels',
        'privileged_roles'
    ];

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

    /**
     * Delete all rows from the given table.
     * THIS SHOULD ONLY BE USED FOR TESTING.
     *
     * @param table Name of the table to delete rows from
     */
    async clearTable(table: TableName): Promise<void> {
        await this.client.query(`DELETE FROM ${table};`);
    }

    getTableNames(): TableName[] {
        return Object.keys(PGStorageClient.TABLES) as TableName[];
    }
    
    async writeWeeklyXpSnapshots(snapshots: Record<string, number>): Promise<void> {
        await this.client.query(format('INSERT INTO weekly_xp_snapshots VALUES %L ON CONFLICT (rsn) DO UPDATE SET xp = EXCLUDED.xp;', Object.entries(snapshots)));
    }
    
    async fetchWeeklyXpSnapshots(): Promise<Record<string, number>> {
        const result: Record<string, number> = {};
        const res = await this.client.query<{rsn: string, xp: number}>('SELECT * FROM weekly_xp_snapshots;');
        for (const row of res.rows) {
            // Big ints are returned as strings in node-postgres
            result[row.rsn] = parseInt(row.xp.toString());
        }
        return result;
    }

    async updatePlayerTotalXp(rsn: string, xp: number): Promise<void> {
        await this.client.query('INSERT INTO player_total_xp VALUES ($1, $2) ON CONFLICT (rsn) DO UPDATE SET xp = EXCLUDED.xp;', [rsn, xp]);
    }

    async fetchTotalXpForAllPlayers(): Promise<Record<string, number>> {
        const result: Record<string, number> = {};
        const res = await this.client.query<{rsn: string, xp: number}>('SELECT * FROM player_total_xp;');
        for (const row of res.rows) {
            // Big ints are returned as strings in node-postgres
            result[row.rsn] = parseInt(row.xp.toString());
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

    async writePlayerActivities(rsn: string, activities: Record<string, number>): Promise<void> {
        const values = Object.keys(activities).map(activity => [rsn, activity, activities[activity]]);
        if (values.length === 0) {
            return;
        }
        await this.client.query(format('INSERT INTO player_activities VALUES %L ON CONFLICT (rsn, activity) DO UPDATE SET score = EXCLUDED.score;', values));
    }

    async fetchAllPlayerActivities(): Promise<Record<string, Partial<Record<IndividualActivityName, number>>>> {
        const result: Record<string, Partial<Record<IndividualActivityName, number>>> = {};
        const queryResult = await this.client.query<{rsn: string, activity: IndividualActivityName, score: number}>('SELECT * FROM player_activities;');
        for (const row of queryResult.rows) {
            if (!result[row.rsn]) {
                result[row.rsn] = {};
            }
            result[row.rsn][row.activity] = parseInt(row.score.toString());
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
    
    async deleteTrackingChannel(guildId: Snowflake): Promise<void> {
        await this.client.query('DELETE FROM tracking_channels WHERE guild_id = $1;', [guildId]);
    }
    
    async fetchAllPlayersWithHiScoreStatus(onHiScores: boolean): Promise<string[]> {
        const queryResult = await this.client.query<{rsn: string, on_hiscores: boolean}>('SELECT * FROM player_hiscore_status WHERE on_hiscores = $1;', [onHiScores]);
        return queryResult.rows.map(row => row.rsn);
    }
    
    async writePlayerHiScoreStatus(rsn: string, onHiScores: boolean): Promise<void> {
        await this.client.query('INSERT INTO player_hiscore_status VALUES ($1, $2) ON CONFLICT (rsn) DO UPDATE SET on_hiscores = EXCLUDED.on_hiscores;', [rsn, onHiScores]);
    }

    async fetchAllPlayerDisplayNames(): Promise<Record<string, string>> {
        const result: Record<string, string> = {};
        const queryResult = await this.client.query<{rsn: string, display_name: string}>('SELECT * FROM player_display_names;');
        for (const row of queryResult.rows) {
            result[row.rsn] = row.display_name;
        }
        return result;
    }

    async writePlayerDisplayName(rsn: string, displayName: string): Promise<void> {
        await this.client.query('INSERT INTO player_display_names VALUES ($1, $2) ON CONFLICT (rsn) DO UPDATE SET display_name = EXCLUDED.display_name;', [rsn, displayName]);
    }

    async fetchAllPlayerActivityTimestamps(): Promise<Record<string, Date>> {
        const result: Record<string, Date> = {};
        const queryResult = await this.client.query<{rsn: string, timestamp: Date}>('SELECT * FROM player_activity_timestamps;');
        for (const row of queryResult.rows) {
            result[row.rsn] = row.timestamp;
        }
        return result;
    }

    async updatePlayerActivityTimestamp(rsn: string, date: Date = new Date()): Promise<void> {
        await this.client.query('INSERT INTO player_activity_timestamps VALUES ($1, $2) ON CONFLICT (rsn) DO UPDATE SET timestamp = EXCLUDED.timestamp;', [rsn, date]);
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

    /**
     * Deletes all rows (in all player-related tables) referencing a player that is not tracked in any guilds.
     * THIS SHOULD BE CALLED EVERY TIME ANY PLAYERS ARE REMOVED FROM THE STATE.
     *
     * @returns Mapping from table name to the number of rows deleted from it (if any)
     */
    async purgeUntrackedPlayerData(): Promise<Record<string, number>> {
        const rowsDeleted: Record<string, number> = {};
        for (const table of PGStorageClient.PURGEABLE_PLAYER_TABLES) {
            const result = await this.client.query(`DELETE FROM ${table} WHERE rsn NOT IN (SELECT p.rsn FROM tracked_players p);`);
            if (result.rowCount > 0) {
                rowsDeleted[table] = result.rowCount;
            }
        }
        return rowsDeleted;
    }

    /**
     * Deletes all rows (in all guild-related tables) referencing a particular guild.
     *
     * @param guildId ID of the guild which we should purge all data for
     * @returns Mapping from table name to the number of rows deleted from it (if any)
     */
    async purgeGuildData(guildId: Snowflake): Promise<Record<string, number>> {
        const rowsDeleted: Record<string, number> = {};
        for (const table of PGStorageClient.PURGEABLE_GUILD_TABLES) {
            const result = await this.client.query(`DELETE FROM ${table} WHERE guild_id = $1;`, [guildId]);
            if (result.rowCount > 0) {
                rowsDeleted[table] = result.rowCount;
            }
        }
        return rowsDeleted;
    }

    async fetchAllPrivilegedRoles(): Promise<Record<Snowflake, Snowflake>> {
        const result: Record<Snowflake, Snowflake> = {};
        const queryResult = await this.client.query<{guild_id: Snowflake, role_id: Snowflake}>('SELECT * FROM privileged_roles;');
        for (const row of queryResult.rows) {
            result[row.guild_id] = row.role_id;
        }
        return result;
    }
    
    async writePrivilegedRole(guildId: Snowflake, roleId: Snowflake): Promise<void> {
        await this.client.query('INSERT INTO privileged_roles VALUES ($1, $2) ON CONFLICT (guild_id) DO UPDATE SET role_id = EXCLUDED.role_id;', [guildId, roleId]);
    }

    // TODO: Update this to make the return type better. Idk what it should actually be... Maybe a list?
    async fetchDailyAnalyticsForLabel(label: DailyAnalyticsLabel): Promise<Record<string, number>> {
        const result: Record<string, number> = {};
        const queryResult = await this.client.query<{date: Date, value: number}>('SELECT * FROM daily_analytics WHERE label = $1;', [label]);
        for (const row of queryResult.rows) {
            result[row.date.toLocaleDateString()] = row.value;
        }
        return result;
    }

    async writeDailyAnalyticsRow(date: Date, label: DailyAnalyticsLabel, value: number): Promise<void> {
        await this.client.query('INSERT INTO daily_analytics VALUES ($1, $2, $3) ON CONFLICT DO NOTHING;', [date, label, value]);
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