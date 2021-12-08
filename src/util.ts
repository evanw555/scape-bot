import log from "./log.js";
import state from "./state.js";

import osrs from 'osrs-json-api';
import { isValidBoss, sanitizeBossName, toSortedBosses, getBossName } from './boss-utility.js';

import { loadJson } from './load-json.js';
import { TextBasedChannels } from "discord.js";
import { PlayerPayload } from "./types.js";
const constants = loadJson('static/constants.json');

const validSkills = new Set(constants.skills);

export function getThumbnail(name, args) {
    if (validSkills.has(name)) {
        const skill = name;
        return {
            url: `${constants.baseThumbnailUrl}${(args && args.is99) ? constants.level99Path : ''}${skill}${constants.imageFileExtension}`
        };
    } 
    if (isValidBoss(name)) {
        const boss = name;
        const thumbnailBoss = boss.replace(/[^a-zA-Z ]/g, '').replace(/ /g,'_').toLowerCase();
        return {
            url: `${constants.baseThumbnailUrl}${thumbnailBoss}${constants.imageFileExtension}`
        };
    }
    return;
};

export function sendUpdateMessage(channel, text, name, args?) {
    channel.send({
        embeds: [ {
            description: text,
            thumbnail: getThumbnail(name, args),
            color: (args && args.color) || 6316287,
            title: args && args.title,
            url: args && args.url
        } ]
    });
};

// input: 3
// expected output: 0,1,2
export function getRandomInt(max) {
    return Math.floor(Math.random() * Math.floor(max));
};

export function computeDiff(before, after) {
    const counts = Object.keys(before);
    const diff = {};
    counts.forEach((kind) => {
        if (before[kind] !== after[kind]) {
            const thisDiff = after[kind] - before[kind];
            if (typeof thisDiff !== 'number' || isNaN(thisDiff) || thisDiff < 0) {
                throw new Error(`Invalid ${kind} diff, '${after[kind]}' minus '${before[kind]}' is '${thisDiff}'`);
            }
            diff[kind] = thisDiff;
        }
    });
    return diff;
};

export function updatePlayer(player: string, spoofedDiff?: Record<string, number>): void {
    // Retrieve the player's hiscores data
    osrs.hiscores.getPlayer(player).then((value: PlayerPayload) => {
        // Parse the player's hiscores data
        let playerData;
        try {
            playerData = parsePlayerPayload(value);
        } catch (err) {
            log.push(`Failed to parse payload for player ${player}: ${err.toString()}`);
            return;
        }

        updateLevels(player, playerData.skills, spoofedDiff);
        updateKillCounts(player, playerData.bosses, spoofedDiff);
        
    }).catch((err) => {
        log.push(`Error while fetching player hiscores for ${player}: ${err.toString()}`);
    });
};


export function parsePlayerPayload(payload: PlayerPayload) {
    const result = {
        skills: {},
        bosses: {}
    };
    Object.keys(payload.skills).forEach((skill: string) => {
        if (skill !== 'overall') {
            const rawLevel: string = payload.skills[skill].level;
            const level: number = parseInt(rawLevel);
            if (typeof level !== 'number' || isNaN(level) || level < 1) {
                throw new Error(`Invalid ${skill} level, '${rawLevel}' parsed to ${level}.\nPayload: ${JSON.stringify(payload.skills)}`);
            }
            result.skills[skill] = level;
        }
    });
    Object.keys(payload.bosses).forEach((bossName: string) => {
        const bossID: string = sanitizeBossName(bossName);
        const rawKillCount: string = payload.bosses[bossName].score;
        const killCount: number = parseInt(rawKillCount);
        if (typeof killCount !== 'number' || isNaN(killCount)) {
            throw new Error(`Invalid ${bossID} boss, '${rawKillCount}' parsed to ${killCount}.\nPayload: ${JSON.stringify(payload.bosses)}`);
        }
        if (killCount < 0) {
            result.bosses[bossID] = 0;
            return;
        }
        result.bosses[bossID] = killCount;
    });
    return result;
};

export function toSortedSkills(skills: string[]): string[] {
    const skillSubset = new Set(skills);
    return constants.skills.filter(skill => skillSubset.has(skill));
}

export function updateLevels(player, newLevels, spoofedDiff?) {
    // If channel is set and user already has levels tracked
    if (state.hasTrackingChannel() && state._levels.hasOwnProperty(player)) {
        // Compute diff for each level
        let diff;
        try {
            if (spoofedDiff) {
                diff = {};
                Object.keys(spoofedDiff).forEach((skill) => {
                    if (validSkills.has(skill)) {
                        diff[skill] = spoofedDiff[skill];
                        newLevels[skill] += diff[skill];
                    }
                });
            } else {
                diff = computeDiff(state._levels[player], newLevels);
            }
        } catch (err) {
            log.push(`Failed to compute level diff for player ${player}: ${err.toString()}`);
            return;
        }
        if (!diff) {
            return;
        }
        // Send a message for any skill that is now 99 and remove it from the diff
        toSortedSkills(Object.keys(diff)).forEach((skill) => {
            const newLevel = newLevels[skill];
            if (newLevel === 99) {
                const levelsGained = diff[skill];
                sendUpdateMessage(state.getTrackingChannel(),
                    `**${player}** has gained `
                        + (levelsGained === 1 ? 'a level' : `**${levelsGained}** levels`)
                        + ` in **${skill}** and is now level **99**\n\n`
                        + `@everyone congrats **${player}**!`,
                    skill, {
                        is99: true
                    });
                delete diff[skill];
            }
        });
        // Send a message showing all the levels gained
        switch (Object.keys(diff).length) {
            case 0:
                break;
            case 1: {
                const skill = Object.keys(diff)[0];
                const levelsGained = diff[skill];
                sendUpdateMessage(state.getTrackingChannel(),
                    `**${player}** has gained `
                        + (levelsGained === 1 ? 'a level' : `**${levelsGained}** levels`)
                        + ` in **${skill}** and is now level **${newLevels[skill]}**`,
                    skill);
                break;
            }
            default: {
                const text = toSortedSkills(Object.keys(diff)).map((skill) => {
                    const levelsGained = diff[skill];
                    return `${levelsGained === 1 ? 'a level' : `**${levelsGained}** levels`} in **${skill}** and is now level **${newLevels[skill]}**`;
                }).join('\n');
                sendUpdateMessage(state.getTrackingChannel(), `**${player}** has gained...\n${text}`, 'overall');
                break;
            }
        }
    }
    // If not spoofing the diff, update player's levels
    if (!spoofedDiff) {
        state._levels[player] = newLevels;
        state._lastUpdate[player] = new Date();
    }
};

export function updateKillCounts(player, killCounts, spoofedDiff?) {
    // If channel is set and user already has bosses tracked
    if (state.getTrackingChannel() && state._bosses.hasOwnProperty(player)) {
        // Compute diff for each boss
        let diff;
        try {
            if (spoofedDiff) {
                diff = {};
                Object.keys(spoofedDiff).forEach((bossID) => {
                    if (isValidBoss(bossID)) {
                        diff[bossID] = spoofedDiff[bossID];
                        killCounts[bossID] += diff[bossID];
                    }
                });
            } else {
                diff = computeDiff(state._bosses[player], killCounts);
            }
        } catch (err) {
            log.push(`Failed to compute boss KC diff for player ${player}: ${err.toString()}`);
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
        const dopeKillVerb = dopeKillVerbs[getRandomInt(dopeKillVerbs.length)];
        switch (Object.keys(diff).length) {
            case 0:
                break;
            case 1: {
                const bossID = Object.keys(diff)[0];
                const killCountIncrease = diff[bossID];
                const bossName = getBossName(bossID);
                const text = killCounts[bossID] === 1
                    ? `**${player}** has slain **${bossName}** for the first time!`
                    : `**${player}** ${dopeKillVerb} **${bossName}** `
                        + (killCountIncrease === 1 ? 'again' : `**${killCountIncrease}** more times`)
                        + ` and is now at **${killCounts[bossID]}** kills`;
                sendUpdateMessage(state.getTrackingChannel(), text, bossID, {color: 10363483});
                break;
            }
            default: {
                const sortedBosses = toSortedBosses(Object.keys(diff));
                const text = sortedBosses.map((bossID) => {
                    const killCountIncrease = diff[bossID];
                    const bossName = getBossName(bossID);
                    return killCounts[bossID] === 1
                        ? `**${bossName}** for the first time!`
                        : `**${bossName}** ${killCountIncrease === 1 ? 'again' : `**${killCountIncrease}** more times`} and is now at **${killCounts[bossID]}**`;
                }).join('\n');
                sendUpdateMessage(state.getTrackingChannel(), `**${player}** has killed...\n${text}`, sortedBosses[0], {color: 10363483});
                break;
            }
        }
    }
    // If not spoofing the diff, update player's kill counts
    if (!spoofedDiff) {
        state._bosses[player] = killCounts;
        state._lastUpdate[player] = new Date();
    }
};

export function updatePlayers(players: string[]): void {
    if (players) {
        players.forEach((player) => {
            updatePlayer(player);
        });
    }
};

export function sendRestartMessage(channel: TextBasedChannels): void {
    if (channel) {
        // Send greeting message to some channel
        const baseText: string = `ScapeBot online in channel **${state.getTrackingChannel()}**, currently`;
        if (state.isTrackingAnyPlayers()) {
            channel.send(`${baseText} tracking players **${state.getAllTrackedPlayers().join('**, **')}**`);
        } else {
            channel.send(`${baseText} not tracking any players`);
        }
    } else {
        log.push('Attempted to send a bot restart message, but the specified channel is undefined!');
    }
};
