import { Snowflake } from 'discord.js';
import { Boss } from 'osrs-json-hiscores';
import { Client as PGClient } from 'pg';
import format from 'pg-format';

import logger from './log';
import state from './state';
import { IndividualSkillName } from './types';

const TABLES: Record<string, string> = {
    'weekly_xp_snapshots': 'CREATE TABLE weekly_xp_snapshots (rsn VARCHAR(12) PRIMARY KEY, xp BIGINT);',
    'player_levels': 'CREATE TABLE player_levels (rsn VARCHAR(12), skill VARCHAR(12), level SMALLINT, PRIMARY KEY (rsn, skill));',
    'player_bosses': 'CREATE TABLE player_bosses (rsn VARCHAR(12), boss VARCHAR(32), score SMALLINT, PRIMARY KEY (rsn, boss));'
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

export async function fetchPlayerLevels(rsn: string): Promise<Partial<Record<IndividualSkillName, number>>> {
    const client: PGClient = state.getPGClient();
    const result: Partial<Record<IndividualSkillName, number>> = {};
    const queryResult = await client.query<{rsn: string, skill: IndividualSkillName, level: number}>('SELECT * FROM player_levels WHERE rsn = $1', [rsn]);
    for (const row of queryResult.rows) {
        result[row.skill] = row.level;
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

export async function fetchPlayerBosses(rsn: string): Promise<Partial<Record<Boss, number>>> {
    const client: PGClient = state.getPGClient();
    const result: Partial<Record<Boss, number>> = {};
    const queryResult = await client.query<{rsn: string, boss: Boss, score: number}>('SELECT * FROM player_bosses WHERE rsn = $1', [rsn]);
    for (const row of queryResult.rows) {
        result[row.boss] = row.score;
    }
    return result;
}
