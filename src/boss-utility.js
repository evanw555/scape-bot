const constants = require('../static/constants.json');

/**
 * Boss name with capitalization
 * @typedef {string} BossName
 */

/**
  * Boss name in all lowercase
  * @typedef {string} BossID
  */

const validBossNames = new Set(constants.bosses);
const validBossIDs = new Set(constants.bosses.map(b => sanitizeBossName(b)));

Array.prototype.toSortedBosses = function() {
    const bossSubset = new Set(this);
    return [...validBossIDs].filter(bossID => bossSubset.has(bossID));
};

/**
 * Returns lowercase of boss name
 * @param {BossName} bossName
 * @returns {BossID}
 */
function sanitizeBossName(bossName) {
    const bossID = bossName.toLowerCase();
    return bossID;
}

/**
 * Gets boss name from ID
 * @param {BossID} bossID
 * @returns {BossName}
 */
function getBossName(bossID) {
    const bossName = constants.bosses.find(b => sanitizeBossName(b) === bossID);
    return bossName;
}

/**
 * Checks that boss is valid
 * @param {BossID|BossName} boss
 * @returns {boolean}
 */
function isValidBoss(boss) {
    return validBossNames.has(boss) || validBossIDs.has(boss);
}

module.exports = {
    sanitizeBossName,
    getBossName,
    isValidBoss
};
