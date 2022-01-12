import log from "./log.js";
import state from "./state.js";

import osrs from 'osrs-json-api';
import { isValidBoss, sanitizeBossName, toSortedBosses, getBossName } from './boss-utility.js';

import { loadJson } from './load-json.js';
import { TextBasedChannels } from "discord.js";
import { BossPayload, PlayerPayload, SkillPayload } from "./types.js";
const constants = loadJson('static/constants.json');

const validSkills: Set<string> = new Set(constants.skills);
const validMiscThumbnails: Set<string> = new Set(constants.miscThumbnails);

export function getThumbnail(name: string, args: Record<string, any>) {
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
    if (validMiscThumbnails.has(name)) {
        return {
            url: `${constants.baseThumbnailUrl}${constants.miscThumbnailPath}${name}${constants.imageFileExtension}`
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
export function getRandomInt(max: number): number {
    return Math.floor(Math.random() * Math.floor(max));
};

export function computeDiff(before: Record<string, number>, after: Record<string, number>): Record<string, number> {
    // Construct the union of all keys from before and after objects (this is needed in the case of new keys)
    const keyUnion: Set<string> = new Set();
    Object.keys(before)
        .concat(Object.keys(after))
        .forEach(key => keyUnion.add(key));

    // For each key, add the diff to the overall diff mapping
    const diff = {};
    keyUnion.forEach((kind) => {
        if (before[kind] !== after[kind]) {
            // TODO: the default isn't necessarily 0, it could be 1 for skills (but does that really matter?)
            const thisDiff = (after[kind] ?? 0) - (before[kind] ?? 0);
            if (typeof thisDiff !== 'number' || isNaN(thisDiff) || thisDiff < 0) {
                throw new Error(`Invalid ${kind} diff, '${after[kind]}' minus '${before[kind]}' is '${thisDiff}'`);
            }
            diff[kind] = thisDiff;
        }
    });
    return diff;
};

/**
 * Returns a new map including key-value pairs from the input map,
 * but with entries omitted if their value matches the blacklisted value parameter.
 * @param input input map
 * @param blacklistedValue value used to determine which entries to omit
 */
export function filterValueFromMap<T>(input: Record<string, T>, blacklistedValue: T): Record<string, T> {
    const output = {};
    Object.keys(input).forEach((key) => {
        if (input[key] !== blacklistedValue) {
            output[key] = input[key];
        }
    });
    return output;
}

export function updatePlayer(player: string, spoofedDiff?: Record<string, number>): void {
    // Retrieve the player's hiscores data
    osrs.hiscores.getPlayer(player).then((value: PlayerPayload) => {
        // Check whether the player's overall hiscore state needs to be updated...
        if (value.skills.overall.rank === '-1' && state.isPlayerOnHiScores(player)) {
            // If player was previously on the hiscores, take them off
            state.removePlayerFromHiScores(player);
            sendUpdateMessage(state.getTrackingChannel(), `**${player}** has fallen off the hiscores`, 'unhappy', { color: 12919812 });
        } else if (value.skills.overall.rank !== '-1' && !state.isPlayerOnHiScores(player)) {
            // If player was previously off the hiscores, add them back on!
            state.addPlayerToHiScores(player);
            sendUpdateMessage(state.getTrackingChannel(), `**${player}** has made it back onto the hiscores`, 'happy', { color: 16569404 });
        }

        // Parse the player's hiscores data
        let playerData: Record<string, Record<string, number>>;
        try {
            playerData = parsePlayerPayload(value);
        } catch (err) {
            log.push(`Failed to parse payload for player ${player}: ${err.toString()}`);
            return;
        }

        // Attempt to patch over some of the missing data for this player (default to 1/0 if there's no pre-existing data)
        // The purpose of doing this is to avoid negative skill/kc diffs (caused by weird behavior of the so-called "API")
        const skills: Record<string, number> = patchMissingLevels(player, playerData.skills, 1);
        const bosses: Record<string, number> = patchMissingBosses(player, playerData.bosses, 0);

        updateLevels(player, skills, spoofedDiff);
        updateKillCounts(player, bosses, spoofedDiff);
    }).catch((err) => {
        log.push(`Error while fetching player hiscores for ${player}: ${err.toString()}`);
    });
};


export function parsePlayerPayload(payload: PlayerPayload): Record<string, Record<string, number>> {
    const result: Record<string, Record<string, number>> = {
        skills: {},
        bosses: {}
    };
    Object.keys(payload.skills).forEach((skill: string) => {
        if (skill !== 'overall') {
            const skillPayload: SkillPayload = payload.skills[skill];
            if (skillPayload.level === '1' && skillPayload.xp === '-1') {
                // If this skill is for some reason omitted from the payload (bad rank? inactivity? why?), then explicitly mark this using NaN
                result.skills[skill] = NaN;
            } else {
                // Otherwise, parse the number as normal...
                const rawLevel: string = skillPayload.level;
                const level: number = parseInt(rawLevel);
                if (typeof level !== 'number' || isNaN(level) || level < 1) {
                    throw new Error(`Invalid ${skill} level, '${rawLevel}' parsed to ${level}.\nPayload: ${JSON.stringify(payload.skills)}`);
                }
                result.skills[skill] = level;
            }
        }
    });
    Object.keys(payload.bosses).forEach((bossName: string) => {
        const bossPayload: BossPayload = payload.bosses[bossName];
        const bossID: string = sanitizeBossName(bossName);
        if (bossPayload.rank === '-1' && bossPayload.score === '-1') {
            // If this boss is for some reason omitted for the payload, then explicitly mark this using NaN
            result.bosses[bossID] = NaN;
        } else {
            // Otherwise, parse the number as normal...
            const rawKillCount: string = bossPayload.score;
            const killCount: number = parseInt(rawKillCount);
            if (typeof killCount !== 'number' || isNaN(killCount)) {
                throw new Error(`Invalid ${bossID} boss, '${rawKillCount}' parsed to ${killCount}.\nPayload: ${JSON.stringify(payload.bosses)}`);
            }
            result.bosses[bossID] = killCount;
        }
    });
    return result;
};

/**
 * With a parsed skills payload as input, attempt to fill in missing levels (NaN) using pre-existing player skill information.
 * If such pre-existing skill information does not exist, then fall back onto some arbitrary number.
 */
export function patchMissingLevels(player: string, levels: Record<string, number>, fallbackValue: number = NaN): Record<string, number> {
    const result: Record<string, number> = {};
    Object.keys(levels).forEach((skill) => {
        if (isNaN(levels[skill])) {
            result[skill] = state.hasLevels(player) ? state.getLevels(player)[skill] : fallbackValue;
        } else {
            result[skill] = levels[skill];
        }
    });
    return result;
}

/**
 * With a parsed bosses payload as input, attempt to fill in missing killcounts (NaN) using pre-existing player kill count information.
 * If such pre-existing boss information does not exist, then fall back onto some arbitrary number.
 */
 export function patchMissingBosses(player: string, bosses: Record<string, number>, fallbackValue: number = NaN): Record<string, number> {
    const result: Record<string, number> = {};
    Object.keys(bosses).forEach((bossId) => {
        if (isNaN(bosses[bossId])) {
            result[bossId] = state.hasBosses(player) ? state.getBosses(player)[bossId] : fallbackValue;
        } else {
            result[bossId] = bosses[bossId];
        }
    });
    return result;
}

export function toSortedSkills(skills: string[]): string[] {
    const skillSubset = new Set(skills);
    return constants.skills.filter(skill => skillSubset.has(skill));
}

export function updateLevels(player: string, newLevels: Record<string, number>, spoofedDiff?: Record<string, number>): void {
    // If channel is set and user already has levels tracked
    if (state.hasTrackingChannel() && state.hasLevels(player)) {
        // Compute diff for each level
        let diff: Record<string, number>;
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
                diff = computeDiff(state.getLevels(player), newLevels);
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
        state.setLevels(player, newLevels);
        state._lastUpdate[player] = new Date();
    }
};

export function updateKillCounts(player, killCounts, spoofedDiff?) {
    // If channel is set and user already has bosses tracked
    if (state.getTrackingChannel() && state.hasBosses(player)) {
        // Compute diff for each boss
        let diff: Record<string, number>;
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
                diff = computeDiff(state.getBosses(player), killCounts);
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
        state.setBosses(player, killCounts);
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

export function sendRestartMessage(channel: TextBasedChannels, downtimeMillis: number): void {
    if (channel) {
        // Send greeting message to some channel
        const baseText: string = `ScapeBot online after ${getDurationString(downtimeMillis)} of downtime. In channel **${state.getTrackingChannel()}**, currently`;
        if (state.isTrackingAnyPlayers()) {
            channel.send(`${baseText} tracking players **${state.getAllTrackedPlayers().join('**, **')}**`);
        } else {
            channel.send(`${baseText} not tracking any players`);
        }
    } else {
        log.push('Attempted to send a bot restart message, but the specified channel is undefined!');
    }
};

export function getDurationString(milliseconds: number) {
    if (milliseconds === 0) {
        return 'no time at all';
    }
    if (milliseconds === 1) {
        return '1 millisecond';
    }
    if (milliseconds < 1000) {
        return `${milliseconds} milliseconds`;
    }
    const seconds = Math.floor(milliseconds / 1000);
    if (seconds === 1) {
        return '1 second';
    }
    if (seconds < 60) {
        return `${seconds} seconds`;
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes === 1) {
        return '1 minute';
    }
    if (minutes < 60) {
        return `${minutes} minutes`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours === 1) {
        return '1 hour';
    }
    if (hours < 48) {
        return `${hours} hours`;
    }
    const days = Math.floor(hours / 24);
    return `${days} days`;
}
