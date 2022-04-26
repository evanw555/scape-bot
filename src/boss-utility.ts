import { camelize } from './util';
import { FORMATTED_BOSS_NAMES } from 'osrs-json-hiscores';

/**
 * Boss name with capitalization and spacing
 * @typedef {string} BossName
 */

/**
  * Boss name in camelcase with only alphanumeric characters
  * @typedef {string} BossID
  */

const validBossNames = new Set(Object.values(FORMATTED_BOSS_NAMES));
const validBossIDs = new Set(Object.keys(FORMATTED_BOSS_NAMES));

export function toSortedBosses(bosses: string[]): string[] {
    const bossSubset = new Set(bosses);
    return [...validBossIDs].filter(bossID => bossSubset.has(bossID));
}

/**
 * Converts boss name to camelcase and removes non-alphanumeric
 * characters
 * @param {BossName} bossName
 * @returns {BossID}
 */
export function sanitizeBossName(bossName: string): string {
    const bossID = camelize(bossName).replace(/\W/g, '');
    return bossID;
}

/**
 * Gets boss name from ID or returns string 'Unknown'
 * @param {BossID} bossID
 * @returns {BossName}
 */
export function getBossName(bossID: string): string {
    return FORMATTED_BOSS_NAMES[bossID] ?? 'Unknown';
}

/**
 * Checks that boss is valid
 * @param {BossID|BossName} boss
 * @returns {boolean}
 */
export function isValidBoss(boss: string): boolean {
    return validBossNames.has(boss) || validBossIDs.has(boss);
}
