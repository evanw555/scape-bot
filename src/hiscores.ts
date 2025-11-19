import hiscores, { Activity, Boss, BOSSES, PLAYER_NOT_FOUND_ERROR, Skill, Stats } from 'osrs-json-hiscores';
import { AUTH, CLUES_NO_ALL, DEFAULT_ACTIVITY_SCORE, DEFAULT_AXIOS_CONFIG, DEFAULT_BOSS_SCORE, DEFAULT_CLUE_SCORE, DEFAULT_SKILL_LEVEL, OTHER_ACTIVITIES, SKILLS_NO_OVERALL } from './constants';
import { IndividualActivityName, IndividualClueType, IndividualSkillName, PlayerHiScores } from './types';
import { computeLevelForXp } from './util';

import state from './instances/state';

export async function fetchHiScores(rsn: string): Promise<PlayerHiScores> {
    const stats: Stats = await hiscores.getStatsByGamemode(rsn, AUTH.gameMode, DEFAULT_AXIOS_CONFIG);

    // Attempt to patch over some of the missing data for this player (default to 1/0 if there's no pre-existing data)
    // The purpose of doing this is to avoid negative skill/kc diffs (caused by weird behavior of the so-called 'API')
    
    const levels: Partial<Record<IndividualSkillName, number>> = {};
    const levelsWithDefaults: Partial<Record<IndividualSkillName, number>> = {};
    const virtualLevels: Partial<Record<IndividualSkillName, number>> = {};
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
                // Compute the virtual level, include it if it's greater than 99
                const virtualLevel = computeLevelForXp(skillPayload.xp);
                if (virtualLevel > 99) {
                    virtualLevels[skill] = virtualLevel;
                }
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
            // As of now, it's possible for the hiscores to return an unranked (-1) KC with a valid score, so only validate that the score is positive
            if (bossPayload.score < 1) {
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
                    throw new Error(`Invalid ${boss} score, '${killCount}' parsed to ${killCount}.\nPayload: ${JSON.stringify(stats.bosses)}`);
                }
                bosses[boss] = killCount;
                bossesWithDefaults[boss] = killCount;
            }
        } else {
            throw new Error(`Raw hi-scores data for player "${rsn}" missing boss "${boss}"`);
        }
    }

    const clues: Partial<Record<IndividualClueType, number>> = {};
    const cluesWithDefaults: Partial<Record<IndividualClueType, number>> = {};
    for (const clue of CLUES_NO_ALL) {
        if (clue in stats.clues) {
            const cluePayload: Activity = stats.clues[clue];
            // As of now, it's possible for the hiscores to return an unranked (-1) clue with a valid score, so only validate that the score is positive
            if (cluePayload.score < 1) {
                // If this clue is for some reason omitted for the payload, then fill it in with existing data if possible
                if (state.hasClue(rsn, clue)) {
                    clues[clue] = state.getClue(rsn, clue);
                    cluesWithDefaults[clue] = state.getClue(rsn, clue);
                } else {
                    // Can't fill in with existing data, so default to zero score and mark as missing
                    cluesWithDefaults[clue] = DEFAULT_CLUE_SCORE;
                }
            } else {
                // Otherwise, parse the number as normal...
                const score: number = cluePayload.score;
                if (typeof score !== 'number' || isNaN(score)) {
                    throw new Error(`Invalid ${clue} score, '${score}' parsed to ${score}.\nPayload: ${JSON.stringify(stats.clues)}`);
                }
                clues[clue] = score;
                cluesWithDefaults[clue] = score;
            }
        }
    }

    const activities: Partial<Record<IndividualActivityName, number>> = {};
    const activitiesWithDefaults: Partial<Record<IndividualActivityName, number>> = {};
    for (const activity of OTHER_ACTIVITIES) {
        if (activity in stats) {
            const activityPayload: Activity = stats[activity];
            // As of now, it's possible for the hiscores to return an unranked (-1) activity with a valid score, so only validate that the score is positive
            if (activityPayload.score < 1) {
                // If this activity is for some reason omitted for the payload, then fill it in with existing data if possible
                if (state.hasActivity(rsn, activity)) {
                    activities[activity] = state.getActivity(rsn, activity);
                    activitiesWithDefaults[activity] = state.getActivity(rsn, activity);
                } else {
                    // Can't fill in with existing data, so default to zero score and mark as missing
                    activitiesWithDefaults[activity] = DEFAULT_ACTIVITY_SCORE;
                }
            } else {
                // Otherwise, parse the number as normal...
                const score: number = activityPayload.score;
                if (typeof score !== 'number' || isNaN(score)) {
                    throw new Error(`Invalid ${activity} score, '${score}' parsed to ${score}.\nPayload: ${JSON.stringify(stats)}`);
                }
                activities[activity] = score;
                activitiesWithDefaults[activity] = score;
            }
        }
    }

    const result: PlayerHiScores = {
        onHiScores: stats.skills.overall.rank !== -1,
        levels,
        levelsWithDefaults: levelsWithDefaults as Record<IndividualSkillName, number>,
        virtualLevels,
        bosses,
        bossesWithDefaults: bossesWithDefaults as Record<Boss, number>,
        clues,
        cluesWithDefaults: cluesWithDefaults as Record<IndividualClueType, number>,
        activities,
        activitiesWithDefaults: activitiesWithDefaults as Record<IndividualActivityName, number>
    };

    // Total XP is considered "missing" if it has a value of zero
    if (stats.skills.overall.xp > 0) {
        result.totalXp = stats.skills.overall.xp;
    }

    // If there were missing skills, these values won't be accurate (so don't include them)
    if (Object.keys(levels).length === Object.keys(levelsWithDefaults).length) {
        result.baseLevel = Math.min(...Object.values(levels));
        result.totalLevel = [0, ...Object.values(levels)].reduce((x, y) => x + y);
    }

    return result;
}

/**
 * Utility function to check if a given error returned from the hiscores indicates that a player is not found.
 *
 * // TODO: This is problematic. Currently, the hiscores library we use catches EVERYTHING (even 5xx errors as "player not found")
 *
 * @param err The error returned from the hiscores
 * @returns True if the error is a "player not found"
 */
export function isPlayerNotFoundError(err: unknown): boolean {
    return (err instanceof Error) && err.message === PLAYER_NOT_FOUND_ERROR;
}
