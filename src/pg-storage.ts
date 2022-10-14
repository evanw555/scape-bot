import { Snowflake } from 'discord.js';
import { Boss } from 'osrs-json-hiscores';
import { Client as PGClient } from 'pg';
import format from 'pg-format';
import { IndividualSkillName } from './types';

import state from './instances/state';
import logger from './instances/logger';

const TABLES: Record<string, string> = {
    'weekly_xp_snapshots': 'CREATE TABLE weekly_xp_snapshots (rsn VARCHAR(12) PRIMARY KEY, xp BIGINT);',
    'player_levels': 'CREATE TABLE player_levels (rsn VARCHAR(12), skill VARCHAR(12), level SMALLINT, PRIMARY KEY (rsn, skill));',
    'player_bosses': 'CREATE TABLE player_bosses (rsn VARCHAR(12), boss VARCHAR(32), score SMALLINT, PRIMARY KEY (rsn, boss));',
    'tracked_players': 'CREATE TABLE tracked_players (guild_id BIGINT, rsn VARCHAR(12), PRIMARY KEY (guild_id, rsn));',
    'tracking_channels': 'CREATE TABLE tracking_channels (guild_id BIGINT PRIMARY KEY, channel_id BIGINT);',
    'player_hiscore_status': 'CREATE TABLE player_hiscore_status (rsn VARCHAR(12) PRIMARY KEY, on_hiscores BOOLEAN);',
    'bot_counters': 'CREATE TABLE bot_counters (user_id BIGINT PRIMARY KEY, counter INTEGER);'
}

export async function initializeTables(): Promise<void> {
    const client: PGClient = state.getPGClient();
    for (const [ tableName, tableSchema ] of Object.entries(TABLES)) {
        if (await doesTableExist(tableName)) {
            await logger.log(`✅ Table \`${tableName}\` exists`);
        } else {
            await client.query(tableSchema);
            await logger.log(`⚠️ Table \`${tableName}\` created`);
        }
    }
}

export async function doesTableExist(name: string): Promise<boolean> {
    const client: PGClient = state.getPGClient();
    return (await client.query<{ exists: boolean }>('SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1);', [name])).rows[0].exists;
}

export async function writeWeeklyXpSnapshots(snapshots: Record<Snowflake, number>): Promise<void> {
    const client: PGClient = state.getPGClient();
    await client.query(format('INSERT INTO weekly_xp_snapshots VALUES %L ON CONFLICT (rsn) DO UPDATE SET xp = EXCLUDED.xp;', Object.entries(snapshots)));
}

export async function fetchWeeklyXpSnapshots(): Promise<Record<Snowflake, number>> {
    const client: PGClient = state.getPGClient();
    const result: Record<Snowflake, number> = {};
    const res = await client.query<{rsn: string, xp: number}>('SELECT * FROM weekly_xp_snapshots;');
    for (const row of res.rows) {
        result[row.rsn] = row.xp;
    }
    return result;
}

export async function writePlayerLevels(rsn: string, levels: Record<string, number>): Promise<void> {
    if (Object.keys(levels).length === 0) {
        return;
    }
    const client: PGClient = state.getPGClient();
    const values = Object.keys(levels).map(skill => [rsn, skill, levels[skill]]);
    if (values.length === 0) {
        return;
    }
    await client.query(format('INSERT INTO player_levels VALUES %L ON CONFLICT (rsn, skill) DO UPDATE SET level = EXCLUDED.level;', values));
}

export async function fetchAllPlayerLevels(): Promise<Record<string, Partial<Record<IndividualSkillName, number>>>> {
    const client: PGClient = state.getPGClient();
    const result: Record<string, Partial<Record<IndividualSkillName, number>>> = {};
    const queryResult = await client.query<{rsn: string, skill: IndividualSkillName, level: number}>('SELECT * FROM player_levels;');
    for (const row of queryResult.rows) {
        if (!result[row.rsn]) {
            result[row.rsn] = {};
        }
        result[row.rsn][row.skill] = row.level;
    }
    return result;
}

export async function writePlayerBosses(rsn: string, bosses: Record<string, number>): Promise<void> {
    const client: PGClient = state.getPGClient();
    const values = Object.keys(bosses).map(boss => [rsn, boss, bosses[boss]]);
    if (values.length === 0) {
        return;
    }
    await client.query(format('INSERT INTO player_bosses VALUES %L ON CONFLICT (rsn, boss) DO UPDATE SET score = EXCLUDED.score;', values));
}

export async function fetchAllPlayerBosses(): Promise<Record<string, Partial<Record<Boss, number>>>> {
    const client: PGClient = state.getPGClient();
    const result: Record<string, Partial<Record<Boss, number>>> = {};
    const queryResult = await client.query<{rsn: string, boss: Boss, score: number}>('SELECT * FROM player_bosses;');
    for (const row of queryResult.rows) {
        if (!result[row.rsn]) {
            result[row.rsn] = {};
        }
        result[row.rsn][row.boss] = row.score;
    }
    return result;
}

export async function fetchAllTrackedPlayers(): Promise<Record<Snowflake, string[]>> {
    const client: PGClient = state.getPGClient();
    const result: Record<Snowflake, string[]> = {};
    const queryResult = await client.query<{guild_id: Snowflake, rsn: string}>('SELECT * FROM tracked_players;');
    for (const row of queryResult.rows) {
        if (!result[row.guild_id]) {
            result[row.guild_id] = [];
        }
        result[row.guild_id].push(row.rsn);
    }
    return result;
}

export async function insertTrackedPlayer(guildId: Snowflake, rsn: string): Promise<void> {
    const client: PGClient = state.getPGClient();
    await client.query('INSERT INTO tracked_players VALUES ($1, $2) ON CONFLICT (guild_id, rsn) DO NOTHING;', [guildId, rsn]);
}

export async function deleteTrackedPlayer(guildId: Snowflake, rsn: string): Promise<void> {
    const client: PGClient = state.getPGClient();
    await client.query('DELETE FROM tracked_players WHERE guild_id = $1 AND rsn = $2;', [guildId, rsn]);
}

export async function fetchAllTrackingChannels(): Promise<Record<Snowflake, Snowflake>> {
    const client: PGClient = state.getPGClient();
    const result: Record<Snowflake, Snowflake> = {};
    const queryResult = await client.query<{guild_id: Snowflake, channel_id: Snowflake}>('SELECT * FROM tracking_channels;');
    for (const row of queryResult.rows) {
        result[row.guild_id] = row.channel_id;
    }
    return result;
}

export async function updateTrackingChannel(guildId: Snowflake, channelId: Snowflake): Promise<void> {
    const client: PGClient = state.getPGClient();
    await client.query('INSERT INTO tracking_channels VALUES ($1, $2) ON CONFLICT (guild_id) DO UPDATE SET channel_id = EXCLUDED.channel_id;', [guildId, channelId]);
}

export async function deleteTrackingChannel(guildId: Snowflake, channelId: Snowflake): Promise<void> {
    const client: PGClient = state.getPGClient();
    await client.query('DELETE FROM tracking_channels WHERE guild_id = $1 AND channel_id = $2;', [guildId, channelId]);
}

export async function fetchAllPlayersWithHiScoreStatus(onHiScores: boolean): Promise<string[]> {
    const client: PGClient = state.getPGClient();
    const queryResult = await client.query<{rsn: string, on_hiscores: boolean}>('SELECT * FROM player_hiscore_status WHERE on_hiscores = $1;', [onHiScores]);
    return queryResult.rows.map(row => row.rsn);
}

export async function writePlayerHiScoreStatus(rsn: string, onHiScores: boolean): Promise<void> {
    const client: PGClient = state.getPGClient();
    await client.query('INSERT INTO player_hiscore_status VALUES ($1, $2) ON CONFLICT (rsn, on_hiscores) DO UPDATE SET on_hiscores = EXCLUDED.on_hiscores;', [rsn, onHiScores]);
}

export async function fetchBotCounters(): Promise<Record<Snowflake, number>> {
    const client: PGClient = state.getPGClient();
    const result: Record<Snowflake, number> = {};
    const queryResult = await client.query<{user_id: Snowflake, counter: number}>('SELECT * FROM bot_counters;');
    for (const row of queryResult.rows) {
        result[row.user_id] = row.counter;
    }
    return result;
}

export async function writeBotCounter(userId: Snowflake, counter: number): Promise<void> {
    const client: PGClient = state.getPGClient();
    await client.query('INSERT INTO bot_counters VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET counter = EXCLUDED.counter;', [userId, counter]);
}