const constants = require('./static/constants.json');

/**
 * Boss name with capitalization
 * @typedef {string} BossName
 */

/**
  * Boss name in all lowercase
  * @typedef {string} BossID
  */

const validBossIDs = new Set(constants.bosses.map(b => createBossID(b)));

/**
 * Removes special chars, replaces spaces with underscores,
 * and returns lowercase of boss
 * @param {string} boss
 * @returns {BossID}
 */
function createBossID(boss) {
    let bossID = boss.replace(/[^a-zA-Z ]/g, '').replace(/ /g,'_').toLowerCase();
    return bossID;
}

Array.prototype.toSortedBosses = function() {
    const bossSubset = new Set(this);
    return [...validBossIDs].filter(bossID => bossSubset.has(bossID));
};

const BossUtility = {
    createBossID,
    /**
     * Gets boss name from boss
     * @param {string} boss
     * @returns {BossName}
     */
    getBossName(boss) {
        const bossName = constants.bosses.find(b => BossUtility.createBossID(b) === BossUtility.createBossID(boss));
        return bossName;
    },
    /**
     * Checks that boss is valid
     * @param {BossID|BossName|string} boss
     * @returns {boolean}
     */
    isValidBoss(boss) {
        const bossID = BossUtility.createBossID(boss);
        return validBossIDs.has(bossID);
    }
};

module.exports = BossUtility;
