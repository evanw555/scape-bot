import { Boss, BOSSES, INVALID_FORMAT_ERROR } from 'osrs-json-hiscores';
import { isValidBoss, toSortedBosses, getBossName } from './boss-utility';
import { TextBasedChannel } from 'discord.js';
import { addReactsSync, randChoice } from 'evanw555.js';
import { IndividualSkillName, PlayerHiScores } from './types';
import { writePlayerBosses, writePlayerHiScoreStatus, writePlayerLevels } from './pg-storage';
import { fetchHiScores } from './hiscores';
import { dumpState } from './bot';
import { DEFAULT_BOSS_SCORE, DEFAULT_SKILL_LEVEL, SKILLS_NO_OVERALL } from './constants';

import { CONSTANTS } from './constants';
import state from './instances/state';
import logger from './instances/logger';

const validSkills: Set<string> = new Set(CONSTANTS.skills);
const validMiscThumbnails: Set<string> = new Set(CONSTANTS.miscThumbnails);

export function getThumbnail(name: string, options?: { is99?: boolean }) {
    if (validSkills.has(name)) {
        const skill = name;
        return {
            url: `${CONSTANTS.baseThumbnailUrl}${options?.is99 ? CONSTANTS.level99Path : ''}${skill}${CONSTANTS.imageFileExtension}`
        };
    } 
    if (isValidBoss(name)) {
        const boss = name;
        const thumbnailBoss = boss.replace(/[^a-zA-Z ]/g, '').replace(/ /g,'_').toLowerCase();
        return {
            url: `${CONSTANTS.baseThumbnailUrl}${thumbnailBoss}${CONSTANTS.imageFileExtension}`
        };
    }
    if (validMiscThumbnails.has(name)) {
        return {
            url: `${CONSTANTS.baseThumbnailUrl}${CONSTANTS.miscThumbnailPath}${name}${CONSTANTS.imageFileExtension}`
        };
    }
    return;
}

interface SendUpdateMessageOptions {
    // Decimal-coded color of the embed
    color?: number,
    // Title of the embed
    title?: string,
    // URL that this embed's title will link to
    url?: string,
    // If this update is for a 99 achievement
    is99?: boolean,
    // Text to add at the top of the message(s) (outside the embed)
    header?: string,
    // Emojis to add to the sent message(s) as reacts
    reacts?: string[]
}

export async function sendUpdateMessage(channels: TextBasedChannel[], text: string, name: string, options?: SendUpdateMessageOptions): Promise<void> {
    for (const channel of channels) {
        const message = await channel.send({
            content: options?.header,
            embeds: [ {
                description: text,
                thumbnail: getThumbnail(name, options),
                color: options?.color ?? 6316287,
                title: options?.title,
                url: options?.url
            } ]
        });
        // If any reacts are specified, add them
        if (options?.reacts) {
            addReactsSync(message, options.reacts);
        }
    }
}

export function camelize(str: string) {
    return str.replace(/(?:^\w|[A-Z]|\b\w)/g, function(word, index) {
        return index === 0 ? word.toLowerCase() : word.toUpperCase();
    }).replace(/\s+/g, '');
}

/**
 * Returns a diff of two maps.
 *
 * @param before map of number values
 * @param after map of number values, must be a superset of before
 * @param baselineValue for any key missing from the before map, default to this value
 * @returns A map containing the diff for entries where the value has increased
 */
export function computeDiff<T extends string>(before: Partial<Record<T, number>>, after: Record<T, number>, baselineValue: number): Partial<Record<T, number>> {
    // Validate that before's keys are a subset of after's
    if (!Object.keys(before).every(key => key in after)) {
        throw new Error(`Cannot compute diff, before ${Object.keys(before).join(',')} is not a subset of after ${Object.keys(after).join(',')}`);
    }

    // For each key, add the diff to the overall diff mapping
    const diff: Partial<Record<T, number>> = {};
    const kinds: T[] = Object.keys(after) as T[];
    for (const kind of kinds) {
        const beforeValue: number = before[kind] ?? baselineValue;
        const afterValue: number = after[kind];
        if (beforeValue !== afterValue) {
            // TODO: the default isn't necessarily 0, it could be 1 for skills (but does that really matter?)
            const thisDiff = afterValue - beforeValue;
            // Fail silently if the negative diff is because the user has fallen off the hi scores
            if (thisDiff < 0 && afterValue === 1) {
                throw new Error('');
            }
            // For bizarre cases, fail loudly
            if (typeof thisDiff !== 'number' || isNaN(thisDiff) || thisDiff < 0) {
                throw new Error(`Invalid ${kind} diff, '${afterValue}' minus '${beforeValue}' is '${thisDiff}'`);
            }
            diff[kind] = thisDiff;
        }
    }

    return diff;
}

/**
 * Returns a new map including key-value pairs from the input map,
 * but with entries omitted if their value matches the blacklisted value parameter.
 * @param input input map
 * @param blacklistedValue value used to determine which entries to omit
 */
export function filterValueFromMap<T>(input: Record<string, T>, blacklistedValue: T): Record<string, T> {
    const output: Record<string, T> = {};
    Object.keys(input).forEach((key) => {
        if (input[key] !== blacklistedValue) {
            output[key] = input[key];
        }
    });
    return output;
}

export function filterMap<T>(input: Record<string, T>, keyWhitelist: string[]): Record<string, T> {
    const result: Record<string, T> = {};
    for (const key of keyWhitelist) {
        if (key in input) {
            result[key] = input[key];
        }
    }
    return result;
}

export function toSortedSkillsNoOverall(skills: string[]): IndividualSkillName[] {
    const skillSubset: Set<string> = new Set(skills);
    return SKILLS_NO_OVERALL.filter((skill: IndividualSkillName) => skillSubset.has(skill));
}

export async function updatePlayer(rsn: string, spoofedDiff?: Record<string, number>): Promise<void> {
    // Retrieve the player's hiscores data
    let data: PlayerHiScores;
    try {
        data = await fetchHiScores(rsn);
    } catch (err) {
        if ((err instanceof Error) && err.message === INVALID_FORMAT_ERROR) {
            // If the API has changed, disable the bot and send a message
            if (!state.isDisabled()) {
                state.setDisabled(true);
                await dumpState();
                await sendUpdateMessage(state.getAllTrackingChannels(), 'The hiscores API has changed, the bot is now disabled. Please fix this, then re-enable the bot', 'wrench', { color: 7303023 });
            }
        } else {
            logger.log(`Error while fetching player hiscores for ${rsn}: \`${err}\``);
        }
        return;
    }

    // Check whether the player's overall hiscore state needs to be updated...
    if (!data.onHiScores && state.isPlayerOnHiScores(rsn)) {
        // If player was previously on the hiscores, take them off
        state.removePlayerFromHiScores(rsn);
        await dumpState();
        await writePlayerHiScoreStatus(rsn, false);
        await sendUpdateMessage(state.getTrackingChannelsForPlayer(rsn), `**${rsn}** has fallen off the hiscores`, 'unhappy', { color: 12919812 });
    } else if (data.onHiScores && !state.isPlayerOnHiScores(rsn)) {
        // If player was previously off the hiscores, add them back on!
        state.addPlayerToHiScores(rsn);
        await dumpState();
        await writePlayerHiScoreStatus(rsn, true);
        await sendUpdateMessage(state.getTrackingChannelsForPlayer(rsn), `**${rsn}** has made it back onto the hiscores`, 'happy', { color: 16569404 });
    }

    // Check if levels have changes and send notifications
    if (state.hasLevels(rsn)) {
        await updateLevels(rsn, data.levelsWithDefaults, spoofedDiff);
    } else {
        // If this player has no levels in the state, prime with initial data (NOT including assumed defaults)
        state.setLevels(rsn, data.levels);
        state.setLastUpdated(rsn, new Date());
        await dumpState();
        await writePlayerLevels(rsn, data.levels);
    }

    // Check if bosses have changes and send notifications
    if (state.hasBosses(rsn)) {
        await updateKillCounts(rsn, data.bossesWithDefaults, spoofedDiff);
    } else {
        // If this player has no bosses in the state, prime with initial data (NOT including assumed defaults)
        state.setBosses(rsn, data.bosses);
        state.setLastUpdated(rsn, new Date());
        await dumpState();
        await writePlayerBosses(rsn, data.bosses);
    }
}

export async function updateLevels(rsn: string, newLevels: Record<IndividualSkillName, number>, spoofedDiff?: Record<string, number>): Promise<void> {
    // We shouldn't be doing this if this player doesn't have any skill info in the state
    if (!state.hasLevels(rsn)) {
        return;
    }

    // Compute diff for each level
    let diff: Partial<Record<IndividualSkillName, number>>;
    try {
        if (spoofedDiff) {
            diff = {};
            for (const skill of SKILLS_NO_OVERALL) {
                if (skill in spoofedDiff) {
                    diff[skill] = spoofedDiff[skill];
                    newLevels[skill] += spoofedDiff[skill];
                }
            }
        } else {
            diff = computeDiff(state.getLevels(rsn), newLevels, DEFAULT_SKILL_LEVEL);
        }
    } catch (err) {
        if (err instanceof Error && err.message) {
            logger.log(`Failed to compute level diff for player ${rsn}: ${err.message}`);
        }
        return;
    }
    if (!diff) {
        return;
    }
    // Send a message for any skill that is now 99 and remove it from the diff
    const updatedSkills: IndividualSkillName[] = toSortedSkillsNoOverall(Object.keys(diff));
    for (const skill of updatedSkills) {
        const newLevel = newLevels[skill];
        if (newLevel === 99) {
            const levelsGained = diff[skill];
            await sendUpdateMessage(state.getTrackingChannelsForPlayer(rsn),
            `**${rsn}** has gained `
                + (levelsGained === 1 ? 'a level' : `**${levelsGained}** levels`)
                + ` in **${skill}** and is now level **99**`,
            skill, {
                header: '@everyone',
                is99: true,
                reacts: ['🇬', '🇿']
            });
            delete diff[skill];
        }
    }
    // Send a message showing all the levels gained
    switch (updatedSkills.length) {
    case 0:
        break;
    case 1: {
        const skill = updatedSkills[0];
        const levelsGained = diff[skill];
        const text = `**${rsn}** has gained `
            + (levelsGained === 1 ? 'a level' : `**${levelsGained}** levels`)
            + ` in **${skill}** and is now level **${newLevels[skill]}**`;
        logger.log(text);
        await sendUpdateMessage(state.getTrackingChannelsForPlayer(rsn), text, skill);
        break;
    }
    default: {
        const text = updatedSkills.map((skill) => {
            const levelsGained = diff[skill];
            return `${levelsGained === 1 ? 'a level' : `**${levelsGained}** levels`} in **${skill}** and is now level **${newLevels[skill]}**`;
        }).join('\n');
        logger.log(text);
        await sendUpdateMessage(state.getTrackingChannelsForPlayer(rsn), `**${rsn}** has gained...\n${text}`, 'overall');
        break;
    }
    }

    // If not spoofing the diff, update player's levels
    if (!spoofedDiff) {
        // Write only updated skills to PG
        await writePlayerLevels(rsn, filterMap(newLevels, updatedSkills));

        state.setLevels(rsn, newLevels);
        state.setLastUpdated(rsn, new Date());
        await dumpState();
    }
}

export async function updateKillCounts(rsn: string, killCounts: Record<Boss, number>, spoofedDiff?: Record<string, number>): Promise<void> {
    // We shouldn't be doing this if this player doesn't have any boss info in the state
    if (!state.hasBosses(rsn)) {
        return;
    }

    // Compute diff for each boss
    let diff: Partial<Record<Boss, number>>;
    try {
        if (spoofedDiff) {
            diff = {};
            for (const boss of BOSSES) {
                if (boss in spoofedDiff) {
                    diff[boss] = spoofedDiff[boss];
                    killCounts[boss] += spoofedDiff[boss];
                }
            }
        } else {
            diff = computeDiff(state.getBosses(rsn), killCounts, DEFAULT_BOSS_SCORE);
        }
    } catch (err) {
        if (err instanceof Error && err.message) {
            logger.log(`Failed to compute boss KC diff for player ${rsn}: ${err.message}`);
        }
        return;
    }
    if (!diff) {
        return;
    }
    // Send a message showing all the incremented boss KCs
    const dopeKillVerbs = [
        'has killed',
        'killed',
        'has slain',
        'slew',
        'slaughtered',
        'butchered'
    ];
    const dopeKillVerb: string = randChoice(...dopeKillVerbs);
    const updatedBosses: Boss[] = toSortedBosses(Object.keys(diff));
    switch (updatedBosses.length) {
    case 0:
        break;
    case 1: {
        const boss = updatedBosses[0];
        const killCountIncrease = diff[boss];
        const bossName = getBossName(boss);
        const text = killCounts[boss] === 1
            ? `**${rsn}** has slain **${bossName}** for the first time!`
            : `**${rsn}** ${dopeKillVerb} **${bossName}** `
                    + (killCountIncrease === 1 ? 'again' : `**${killCountIncrease}** more times`)
                    + ` and is now at **${killCounts[boss]}** kills`;
        logger.log(text);
        sendUpdateMessage(state.getTrackingChannelsForPlayer(rsn), text, bossName, { color: 10363483 });
        break;
    }
    default: {
        const text = updatedBosses.map((boss) => {
            const killCountIncrease = diff[boss];
            const bossName = getBossName(boss);
            return killCounts[boss] === 1
                ? `**${bossName}** for the first time!`
                : `**${bossName}** ${killCountIncrease === 1 ? 'again' : `**${killCountIncrease}** more times`} and is now at **${killCounts[boss]}**`;
        }).join('\n');
        logger.log(text);
        sendUpdateMessage(
            state.getTrackingChannelsForPlayer(rsn),
            `**${rsn}** has killed...\n${text}`,
            getBossName(updatedBosses[0]),
            { color: 10363483 }
        );
        break;
    }
    }

    // If not spoofing the diff, update player's kill counts
    if (!spoofedDiff) {
        // Write only updated bosses to PG
        await writePlayerBosses(rsn, filterMap(killCounts, updatedBosses));

        state.setBosses(rsn, killCounts);
        state.setLastUpdated(rsn, new Date());
        await dumpState();
    }
}

export function getQuantityWithUnits(quantity: number): string {
    if (quantity < 1000) {
        return quantity.toString();
    } else if (quantity < 1000000) {
        return (quantity / 1000).toFixed(1) + 'k';
    } else {
        return (quantity / 1000000).toFixed(1) + 'm';
    }
}

export function getNextFridayEvening(): Date {
    // Get next Friday at 5:10pm
    const nextFriday: Date = new Date();
    nextFriday.setHours(17, 10, 0, 0);
    nextFriday.setHours(nextFriday.getHours() + 24 * ((12 - nextFriday.getDay()) % 7));
    if (nextFriday.getTime() <= new Date().getTime()) {
        nextFriday.setHours(nextFriday.getHours() + (24 * 7));
    }
    return nextFriday;
}
