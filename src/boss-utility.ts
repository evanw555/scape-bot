import { loadJson } from './load-json.js';
import { camelize } from "./util.js";
const constants = loadJson('static/constants.json');

/**
 * Boss name with capitalization and spacing
 * @typedef {string} BossName
 */

/**
  * Boss name in camelcase with only alphanumeric characters
  * @typedef {string} BossID
  */

const validBossNames = new Set(Object.values(constants.bossNamesMap));
const validBossIDs = new Set(Object.keys(constants.bossNamesMap));

export function toSortedBosses(bosses: string[]): string[] {
    const bossSubset = new Set(bosses);
    return [...validBossIDs].filter(bossID => bossSubset.has(bossID));
};

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
 * Gets boss name from ID
 * @param {BossID} bossID
 * @returns {BossName}
 */
 export function getBossName(bossID: string): string {
    const bossName = Object.values(constants.bossNamesMap).find((b: string) => sanitizeBossName(b) === bossID) as string;
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
