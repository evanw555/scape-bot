import { Snowflake } from 'discord.js';
import { Client as PGClient } from 'pg';
import format from 'pg-format';

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
