import { loadJson } from './load-json.js';
const constants = loadJson('static/constants.json');

/**
 * Boss name with capitalization
 * @typedef {string} BossName
 */

/**
  * Boss name in all lowercase
  * @typedef {string} BossID
  */

const validBossNames: Set<string> = new Set<string>(constants.bosses);
const validBossIDs: Set<string> = new Set<string>(constants.bosses.map(b => sanitizeBossName(b)));

export function toSortedBosses(bosses: string[]): string[] {
    const bossSubset = new Set(bosses);
    return [...validBossIDs].filter(bossID => bossSubset.has(bossID));
};

/**
 * Returns lowercase of boss name
 * @param {BossName} bossName
 * @returns {BossID}
 */
 export function sanitizeBossName(bossName: string): string {
    const bossID = bossName.toLowerCase();
    return bossID;
}

/**
 * Gets boss name from ID
 * @param {BossID} bossID
 * @returns {BossName}
 */
 export function getBossName(bossID: string): string {
    const bossName = constants.bosses.find(b => sanitizeBossName(b) === bossID);
    return bossName;
}

/**
 * Checks that boss is valid
 * @param {BossID|BossName} boss
 * @returns {boolean}
 */
export function isValidBoss(boss: string): boolean {
    return validBossNames.has(boss) || validBossIDs.has(boss);
}
