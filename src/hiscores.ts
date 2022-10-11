import hiscores, { Activity, Boss, BOSSES, Player, Skill, Stats } from "osrs-json-hiscores";
import { DEFAULT_BOSS_SCORE, DEFAULT_SKILL_LEVEL, SKILLS_NO_OVERALL } from "./constants";
import { IndividualSkillName, PlayerHiScores } from "./types";

import state from "./state";

export async function fetchHiScores(rsn: string): Promise<PlayerHiScores> {
    const rawPlayerInfo: Player = await hiscores.getStats(rsn);

    const stats: Stats | undefined = rawPlayerInfo[rawPlayerInfo.mode];

    if (!stats) {
        throw new Error(`Raw hi-scores data for player "${rsn}" doesn't contain stats for mode "${rawPlayerInfo.mode}"`);
    }


    // Attempt to patch over some of the missing data for this player (default to 1/0 if there's no pre-existing data)
    // The purpose of doing this is to avoid negative skill/kc diffs (caused by weird behavior of the so-called 'API')
    
    const levels: Partial<Record<IndividualSkillName, number>> = {};
    const levelsWithDefaults: Partial<Record<IndividualSkillName, number>> = {};
    for (const skill of SKILLS_NO_OVERALL) {
        if (skill in stats.skills) {
            const skillPayload: Skill = stats.skills[skill];
            if (skillPayload.level === -1 || skillPayload.xp === -1) {
                // If this skill is for some reason omitted from the payload (bad rank? inactivity? why?), then fill it in with existing data if possible
                if (state.hasLevel(rsn, skill)) {
                    levels[skill] = state.getLevel(rsn, skill);
                    levelsWithDefaults[skill] = state.getLevel(rsn, skill);
                } else {
                    // Can't fill in with existing data, so default to level 1 and mark as missing
                    levelsWithDefaults[skill] = DEFAULT_SKILL_LEVEL;
                }
            } else {
                // Otherwise, parse the number as normal...
                const level: number = skillPayload.level;
                if (typeof level !== 'number' || isNaN(level) || level < 1) {
                    throw new Error(`Invalid ${skill} level, '${level}' parsed to ${level}.\nPayload: ${JSON.stringify(stats.skills)}`);
                }
                levels[skill] = level;
                levelsWithDefaults[skill] = level;
            }
        } else {
            throw new Error(`Raw hi-scores data for player "${rsn}" missing skill "${skill}"`);
        }
    }

    const bosses: Partial<Record<Boss, number>> = {};
    const bossesWithDefaults: Partial<Record<Boss, number>> = {};
    for (const boss of BOSSES) {
        if (boss in stats.bosses) {
            const bossPayload: Activity = stats.bosses[boss];
            if (bossPayload.rank === -1 || bossPayload.score === -1) {
                // If this boss is for some reason omitted for the payload, then fill it in with existing data if possible
                if (state.hasBoss(rsn, boss)) {
                    bosses[boss] = state.getBoss(rsn, boss);
                    bossesWithDefaults[boss] = state.getBoss(rsn, boss);
                } else {
                    // Can't fill in with existing data, so default to zero kills and mark as missing
                    bossesWithDefaults[boss] = DEFAULT_BOSS_SCORE;
                }
            } else {
                // Otherwise, parse the number as normal...
                const killCount: number = bossPayload.score;
                if (typeof killCount !== 'number' || isNaN(killCount)) {
                    throw new Error(`Invalid ${boss} boss, '${killCount}' parsed to ${killCount}.\nPayload: ${JSON.stringify(stats.bosses)}`);
                }
                bosses[boss] = killCount;
                bossesWithDefaults[boss] = killCount;
            }
        } else {
            throw new Error(`Raw hi-scores data for player "${rsn}" missing boss "${boss}"`);
        }
    }

    const result: PlayerHiScores = {
        onHiScores: stats.skills.overall.rank !== -1,
        totalXp: stats.skills.overall.xp,
        levels,
        levelsWithDefaults: levelsWithDefaults as Record<IndividualSkillName, number>,
        bosses,
        bossesWithDefaults: bossesWithDefaults as Record<Boss, number>
    };

    // If there were missing skills, these values won't be accurate (so don't include them)
    if (Object.keys(levels).length === Object.keys(levelsWithDefaults).length) {
        result.totalXp = stats.skills.overall.xp;
        result.baseLevel = Math.min(...Object.values(levels));
        result.totalLevel = [0, ...Object.values(levels)].reduce((x, y) => x + y);
    }

    return result;
}