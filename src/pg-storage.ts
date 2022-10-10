import { Snowflake } from 'discord.js';
import { Client as PGClient, QueryResult } from 'pg';
import format from 'pg-format';
import logger from './log';

const TABLES: Record<string, string> = {
    'weekly_xp_snapshots': 'CREATE TABLE weekly_xp_snapshots (rsn VARCHAR(12) PRIMARY KEY, xp BIGINT);',
    'player_skills': 'CREATE TABLE player_skills (rsn VARCHAR(12), skill VARCHAR(12), xp INTEGER, PRIMARY KEY (rsn, skill));'
}

export async function initializeTables(client: PGClient): Promise<void> {
    for (const [ tableName, tableSchema ] of Object.entries(TABLES)) {
        if (await doesTableExist(client, tableName)) {
            await logger.log(`✅ Table \`${tableName}\` exists`);
        } else {
            await client.query(tableSchema);
            await logger.log(`⚠️ Table \`${tableName}\` created`);
        }
    }
}

export async function doesTableExist(client: PGClient, name: string): Promise<boolean> {
    return (await client.query<{ exists: boolean }>('SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1);', [name])).rows[0].exists;
}

export async function writeWeeklyXpSnapshots(client: PGClient, snapshots: Record<Snowflake, number>): Promise<void> {
    await client.query(format('INSERT INTO weekly_xp_snapshots VALUES %L ON CONFLICT (rsn) DO UPDATE SET xp = EXCLUDED.xp;', Object.entries(snapshots)));
}

export async function fetchWeeklyXpSnapshots(client: PGClient): Promise<Record<Snowflake, number>> {
    const result: Record<Snowflake, number> = {};
    const res = await client.query<{rsn: string, xp: number}>('SELECT * FROM weekly_xp_snapshots;');
    for (const row of res.rows) {
        result[row.rsn] = row.xp;
    }
    return result;
}
