import { Snowflake } from 'discord.js';
import { getQuantityWithUnits, MultiLoggerLevel } from 'evanw555.js';
import { Boss } from 'osrs-json-hiscores';
import { Client, ClientConfig } from 'pg';
import format from 'pg-format';
import { IndividualSkillName, IndividualClueType, IndividualActivityName, MiscPropertyName, DailyAnalyticsLabel, PendingPlayerUpdate, PlayerUpdateType, PlayerUpdateKey, GuildSetting, GuildSettingsMap } from './types';

import logger from './instances/logger';

type TableName = 'weekly_xp_snapshots' | 'weekly_xp_snapshot_timestamps' | 'player_total_xp' | 'player_levels' | 'player_bosses' | 'player_clues'
| 'player_activities' | 'player_virtual_levels' | 'pending_player_updates' | 'tracked_players' | 'tracking_channels' | 'player_hiscore_status' | 'player_display_names'
| 'player_activity_timestamps' | 'player_refresh_timestamps' | 'bot_counters' | 'privileged_roles' | 'guild_settings' | 'daily_analytics' | 'misc_properties';

export default class PGStorageClient {
    private static readonly TABLES: Record<TableName, string> = {
        'weekly_xp_snapshots': 'CREATE TABLE weekly_xp_snapshots (rsn VARCHAR(12) PRIMARY KEY, xp BIGINT);',
        // TODO: This table is temporary and will be used to investigate the accuracy of the "weekly" XP computation
        'weekly_xp_snapshot_timestamps': 'CREATE TABLE weekly_xp_snapshot_timestamps (rsn VARCHAR(12) PRIMARY KEY, timestamp TIMESTAMPTZ);',
        'player_total_xp': 'CREATE TABLE player_total_xp (rsn VARCHAR(12) PRIMARY KEY, xp BIGINT);',
        'player_levels': 'CREATE TABLE player_levels (rsn VARCHAR(12), skill VARCHAR(12), level SMALLINT, PRIMARY KEY (rsn, skill));',
        'player_bosses': 'CREATE TABLE player_bosses (rsn VARCHAR(12), boss VARCHAR(32), score INTEGER, PRIMARY KEY (rsn, boss));',
        'player_clues': 'CREATE TABLE player_clues (rsn VARCHAR(12), clue VARCHAR(12), score SMALLINT, PRIMARY KEY (rsn, clue));',
        'player_activities': 'CREATE TABLE player_activities (rsn VARCHAR(12), activity VARCHAR(32), score BIGINT, PRIMARY KEY (rsn, activity));',
        'player_virtual_levels': 'CREATE TABLE player_virtual_levels (rsn VARCHAR(12), skill VARCHAR(12), level SMALLINT, PRIMARY KEY (rsn, skill), CHECK (level between 100 and 126));',
        'pending_player_updates': 'CREATE TABLE pending_player_updates (guild_id BIGINT, rsn VARCHAR(12), type SMALLINT, key VARCHAR(32), base_value BIGINT, new_value BIGINT, PRIMARY KEY (guild_id, rsn, type, key));',
        'tracked_players': 'CREATE TABLE tracked_players (guild_id BIGINT, rsn VARCHAR(12), PRIMARY KEY (guild_id, rsn));',
        'tracking_channels': 'CREATE TABLE tracking_channels (guild_id BIGINT PRIMARY KEY, channel_id BIGINT);',
        'player_hiscore_status': 'CREATE TABLE player_hiscore_status (rsn VARCHAR(12) PRIMARY KEY, on_hiscores BOOLEAN);',
        'player_display_names': 'CREATE TABLE player_display_names (rsn VARCHAR(12) PRIMARY KEY, display_name VARCHAR(12));',
        'player_activity_timestamps': 'CREATE TABLE player_activity_timestamps (rsn VARCHAR(12) PRIMARY KEY, timestamp TIMESTAMPTZ);',
        'player_refresh_timestamps': 'CREATE TABLE player_refresh_timestamps (rsn VARCHAR(12) PRIMARY KEY, timestamp TIMESTAMPTZ);',
        'bot_counters': 'CREATE TABLE bot_counters (user_id BIGINT PRIMARY KEY, counter INTEGER);',
        'privileged_roles': 'CREATE TABLE privileged_roles (guild_id BIGINT PRIMARY KEY, role_id BIGINT);',
        'guild_settings': 'CREATE TABLE guild_settings (guild_id BIGINT, setting SMALLINT, value SMALLINT, PRIMARY KEY (guild_id, setting));',
        'daily_analytics': 'CREATE TABLE daily_analytics (date DATE, label SMALLINT, value INTEGER, PRIMARY KEY (date, label));',
        'misc_properties': 'CREATE TABLE misc_properties (name VARCHAR(32) PRIMARY KEY, value VARCHAR(2048));'
    };

    // List of tables that should be purged if the player corresponding to a row is missing from tracked_players
    private static readonly PURGEABLE_PLAYER_TABLES: TableName[] = [
        'weekly_xp_snapshots',
        'weekly_xp_snapshot_timestamps',
        'player_total_xp',
        'player_levels',
        'player_bosses',
        'player_clues',
        'player_activities',
        'player_virtual_levels',
        'pending_player_updates',
        'player_hiscore_status',
        'player_display_names',
        'player_activity_timestamps',
        'player_refresh_timestamps'
    ];

    // List of tables that should be purged when a guild removes this bot
    private static readonly PURGEABLE_GUILD_TABLES: TableName[] = [
        'pending_player_updates',
        'tracked_players',
        'tracking_channels',
        'privileged_roles',
        'guild_settings'
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
                results.push(`✅ Table \`${tableName}\` exists **(${getQuantityWithUnits(await this.getTableSize(tableName as TableName))})**`);
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

    async getTableSize(name: TableName): Promise<number> {
        // Assert that the table name is valid for obvious reasons
        if (!PGStorageClient.TABLES[name]) {
            throw new Error(`Cannot get size of unknown table \`${name}\``);
        }
        return (await this.client.query<{ count: number }>(`SELECT COUNT(*) FROM ${name};`)).rows[0].count;
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

    /**
     * Writes a player's weekly XP snapshot only if there are no existing rows for the player.
     * @returns True if any rows were inserted
     */
    async writeWeeklyXpSnapshotIfMissing(rsn: string, xp: number): Promise<boolean> {
        const result = await this.client.query('INSERT INTO weekly_xp_snapshots VALUES ($1, $2) ON CONFLICT DO NOTHING;', [rsn, xp]);
        return result.rowCount > 0;
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

    async writeWeeklyXpSnapshotTimestamps(timestamps: Record<string, Date>) {
        await this.client.query(format('INSERT INTO weekly_xp_snapshot_timestamps VALUES %L ON CONFLICT (rsn) DO UPDATE SET timestamp = EXCLUDED.timestamp;', Object.entries(timestamps)));
    }

    async writeWeeklyXpSnapshotTimestampIfMissing(rsn: string, timestamp: Date): Promise<boolean> {
        const result = await this.client.query('INSERT INTO weekly_xp_snapshot_timestamps VALUES ($1, $2) ON CONFLICT DO NOTHING;', [rsn, timestamp]);
        return result.rowCount > 0;
    }

    async fetchWeeklyXpSnapshotTimestamps(): Promise<Record<string, Date>> {
        const result: Record<string, Date> = {};
        const res = await this.client.query<{rsn: string, timestamp: Date}>('SELECT * FROM weekly_xp_snapshot_timestamps;');
        for (const row of res.rows) {
            // Big ints are returned as strings in node-postgres
            result[row.rsn] = row.timestamp;
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

    async writePlayerVirtualLevels(rsn: string, virtualLevels: Record<string, number>): Promise<void> {
        if (Object.keys(virtualLevels).length === 0) {
            return;
        }
        const values = Object.keys(virtualLevels).map(skill => [rsn, skill, virtualLevels[skill]]);
        if (values.length === 0) {
            return;
        }
        await this.client.query(format('INSERT INTO player_virtual_levels VALUES %L ON CONFLICT (rsn, skill) DO UPDATE SET level = EXCLUDED.level;', values));
    }

    async deletePlayerVirtualLevel(rsn: string, skill: IndividualSkillName) {
        await this.client.query('DELETE FROM player_virtual_levels WHERE rsn = $1 AND skill = $2;', [rsn, skill]);
    }

    async fetchAllPlayerVirtualLevels(): Promise<Record<string, Partial<Record<IndividualSkillName, number>>>> {
        const result: Record<string, Partial<Record<IndividualSkillName, number>>> = {};
        const queryResult = await this.client.query<{rsn: string, skill: IndividualSkillName, level: number}>('SELECT * FROM player_virtual_levels;');
        for (const row of queryResult.rows) {
            if (!result[row.rsn]) {
                result[row.rsn] = {};
            }
            result[row.rsn][row.skill] = row.level;
        }
        return result;
    }

    async fetchPendingPlayerUpdates(rsn: string): Promise<PendingPlayerUpdate[]> {
        const queryResult = await this.client.query<{guild_id: Snowflake, rsn: string, type: PlayerUpdateType, key: PlayerUpdateKey, base_value: number, new_value: number}>('SELECT * FROM pending_player_updates WHERE rsn = $1;', [rsn]);
        return queryResult.rows.map(row => ({
            guildId: row.guild_id,
            rsn: row.rsn,
            type: row.type,
            key: row.key,
            baseValue: parseInt(row.base_value.toString()),
            newValue: parseInt(row.new_value.toString())
        }));
    }

    async writePendingPlayerUpdates(updates: PendingPlayerUpdate[]) {
        const values = updates.map(u => [u.guildId, u.rsn, u.type, u.key, u.baseValue, u.newValue]);
        if (values.length === 0) {
            return;
        }
        // IMPORTANT: Pending updates are coalesced by only updating the new_value, except in cases of rollbacks in which the lesser base_value must be used
        // EX1: write "fishing 10->12", write "fishing 12->13", result is "fishing 10->13" (typical case)
        // EX2: write "fishing 10->12", write "fishing 8->9", result is "fishing 8->9" (aggressive rollback)
        // EX3: write "fishing 20->27", write "fishing 22->23", result is "fishing 20->23" (partial rollback)
        await this.client.query(format('INSERT INTO pending_player_updates VALUES %L ON CONFLICT (guild_id, rsn, type, key) DO UPDATE SET new_value = EXCLUDED.new_value, base_value = LEAST(pending_player_updates.base_value, excluded.base_value);', values));
    }

    async deletePendingPlayerUpdate(update: PendingPlayerUpdate) {
        await this.client.query('DELETE FROM pending_player_updates WHERE guild_id = $1 AND rsn = $2 AND type = $3 AND key = $4;', [update.guildId, update.rsn, update.type, update.key]);
    }

    // TODO: Temp logic to see how this is working
    async fetchAllPendingPlayerUpdates() {
        const queryResult = await this.client.query<{guild_id: Snowflake, rsn: string, type: PlayerUpdateType, key: PlayerUpdateKey, base_value: number, new_value: number}>('SELECT * FROM pending_player_updates;');
        return queryResult.rows;
    }

    /**
     * Fetches all guild IDs tracking players and the players they're tracking.
     * @returns Mapping from guild ID to list of players tracked therein
     */
    async fetchAllTrackedPlayersByGuild(): Promise<Record<Snowflake, string[]>> {
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

    /**
     * Fetches all tracked players and which guilds are tracking them.
     * @returns Mapping from RSN to list of guild IDs tracking that player
     */
    async fetchAllTrackedPlayersByPlayer(): Promise<Record<string, Snowflake[]>> {
        const result: Record<Snowflake, string[]> = {};
        const queryResult = await this.client.query<{guild_id: Snowflake, rsn: string}>('SELECT * FROM tracked_players;');
        for (const row of queryResult.rows) {
            if (!result[row.rsn]) {
                result[row.rsn] = [];
            }
            result[row.rsn].push(row.guild_id);
        }
        return result;
    }

    async insertTrackedPlayer(guildId: Snowflake, rsn: string): Promise<void> {
        await this.client.query('INSERT INTO tracked_players VALUES ($1, $2) ON CONFLICT (guild_id, rsn) DO NOTHING;', [guildId, rsn]);
    }

    async deleteTrackedPlayer(guildId: Snowflake, rsn: string): Promise<void> {
        await this.client.query('DELETE FROM tracked_players WHERE guild_id = $1 AND rsn = $2;', [guildId, rsn]);
    }

    async deleteTrackedPlayerGlobally(rsn: string): Promise<void> {
        await this.client.query('DELETE FROM tracked_players WHERE rsn = $1;', [rsn]);
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

    async fetchAllPlayerRefreshTimestamps(): Promise<Record<string, Date>> {
        const result: Record<string, Date> = {};
        const queryResult = await this.client.query<{rsn: string, timestamp: Date}>('SELECT * FROM player_refresh_timestamps;');
        for (const row of queryResult.rows) {
            result[row.rsn] = row.timestamp;
        }
        return result;
    }

    async updatePlayerRefreshTimestamp(rsn: string, date: Date = new Date()): Promise<void> {
        await this.client.query('INSERT INTO player_refresh_timestamps VALUES ($1, $2) ON CONFLICT (rsn) DO UPDATE SET timestamp = EXCLUDED.timestamp;', [rsn, date]);
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

    async fetchAllGuildSettings(): Promise<Record<string, GuildSettingsMap>> {
        const result: Record<string, GuildSettingsMap> = {};
        const queryResult = await this.client.query<{guild_id: string, setting: GuildSetting, value: number}>('SELECT * FROM guild_settings');
        for (const row of queryResult.rows) {
            if (!result[row.guild_id]) {
                result[row.guild_id] = {};
            }
            result[row.guild_id][row.setting] = parseInt(row.value.toString());
        }
        return result;
    }

    async writeGuildSetting(guildId: Snowflake, setting: GuildSetting, value: number): Promise<void> {
        await this.client.query('INSERT INTO guild_settings VALUES ($1, $2, $3) ON CONFLICT (guild_id, setting) DO UPDATE SET value = EXCLUDED.value;', [guildId, setting, value]);
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

    async fetchDailyAnalyticsRows(date: Date): Promise<{label: DailyAnalyticsLabel, value: number}[]> {
        const result = await this.client.query<{date: Date, label: DailyAnalyticsLabel, value: number}>('SELECT * FROM daily_analytics WHERE date = $1', [date]);
        return result.rows.map(row => ({ label: row.label, value: row.value }));
    }
    
    async fetchMiscProperty(name: MiscPropertyName, options?: { log?: boolean }): Promise<string | null> {
        const shouldLog = options?.log ?? true;
        try {
            const queryResult = await this.client.query<{name: string, value: string}>('SELECT * FROM misc_properties WHERE name = $1;', [name]);
            if (queryResult.rowCount === 0) {
                if (shouldLog) {
                    await logger.log(`PG ERROR: No rows found for misc property \`${name}\``, MultiLoggerLevel.Error);
                }
                return null;
            }
            return queryResult.rows[0].value;
        } catch (err) {
            if (shouldLog) {
                await logger.log(`PG ERROR: Unable to fetch misc property \`${name}\`: \`${err}\``, MultiLoggerLevel.Error);
            }
            return null;
        }
    }
    
    async writeMiscProperty(name: MiscPropertyName, value: string): Promise<void> {
        await this.client.query('INSERT INTO misc_properties VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value;', [name, value]);
    }

    async fetchMiscPropertyElseWrite(name: MiscPropertyName, defaultValue: string): Promise<string> {
        // If the property exists, return that
        const result = await this.fetchMiscProperty(name, { log: false });
        if (result) {
            return result;
        }
        // Else, write the default value and return
        await this.writeMiscProperty(name, defaultValue);
        return defaultValue;
    }
}
