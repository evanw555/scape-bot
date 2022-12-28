import { Boss, BOSSES, INVALID_FORMAT_ERROR, FORMATTED_BOSS_NAMES, getRSNFormat } from 'osrs-json-hiscores';
import { ChatInputCommandInteraction, Guild, TextBasedChannel, TextChannel } from 'discord.js';
import { addReactsSync, MultiLoggerLevel, randChoice } from 'evanw555.js';
import { IndividualClueType, IndividualSkillName, PlayerHiScores } from './types';
import { fetchHiScores } from './hiscores';
import { CONSTANTS, CONFIG, BOSS_EMBED_COLOR, CLUES_NO_ALL, CLUE_EMBED_COLOR, COMPLETE_VERB_BOSSES, DEFAULT_BOSS_SCORE, DEFAULT_CLUE_SCORE, DEFAULT_SKILL_LEVEL, DOPE_COMPLETE_VERBS, DOPE_KILL_VERBS, GRAY_EMBED_COLOR, PLAYER_404_ERROR, RED_EMBED_COLOR, SKILLS_NO_OVERALL, SKILL_EMBED_COLOR, YELLOW_EMBED_COLOR } from './constants';

import state from './instances/state';
import logger from './instances/logger';
import pgStorageClient from './instances/pg-storage-client';

const validSkills: Set<string> = new Set(CONSTANTS.skills);
const validClues: Set<string> = new Set(CLUES_NO_ALL);
const validMiscThumbnails: Set<string> = new Set(CONSTANTS.miscThumbnails);

export function getBossName(boss: Boss): string {
    return FORMATTED_BOSS_NAMES[boss] ?? 'Unknown';
}

export function isValidBoss(boss: string): boss is Boss {
    return BOSSES.indexOf(boss as Boss) > -1;
}

export function getThumbnail(name: string, options?: { is99?: boolean }) {
    if (validSkills.has(name)) {
        const skill = name;
        return {
            url: `${CONSTANTS.baseThumbnailUrl}${options?.is99 ? CONSTANTS.level99Path : ''}${skill}${CONSTANTS.imageFileExtension}`
        };
    }
    if (validClues.has(name)) {
        const clue = name;
        return {
            url: `${CONSTANTS.baseThumbnailUrl}${CONSTANTS.clueThumbnailPath}${clue}${CONSTANTS.imageFileExtension}`
        };
    }
    if (isValidBoss(name)) {
        const boss = name;
        return {
            url: `${CONSTANTS.baseThumbnailUrl}${boss}${CONSTANTS.imageFileExtension}`
        };
    }
    if (validMiscThumbnails.has(name)) {
        return {
            url: `${CONSTANTS.baseThumbnailUrl}${CONSTANTS.miscThumbnailPath}${name}${CONSTANTS.imageFileExtension}`
        };
    }
    return;
}

interface UpdateMessageOptions {
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
}

interface SendUpdateMessageOptions extends UpdateMessageOptions {
    // Emojis to add to the sent message(s) as reacts
    reacts?: string[]
}

export function buildUpdateMessage(text: string, name: string, options?: UpdateMessageOptions) {
    return {
        content: options?.header,
        embeds: [{
            description: text,
            thumbnail: getThumbnail(name, options),
            color: options?.color ?? SKILL_EMBED_COLOR,
            title: options?.title,
            url: options?.url
        }]
    };
}

export async function sendUpdateMessage(channels: TextBasedChannel[], text: string, name: string, options?: SendUpdateMessageOptions): Promise<void> {
    const updateMessage = buildUpdateMessage(text, name, options);
    for (const channel of channels) {
        try {
            const message = await channel.send(updateMessage);
            // If any reacts are specified, add them
            if (options?.reacts) {
                addReactsSync(message, options.reacts);
            }
        } catch (err) {
            let errorMessage = 'Unable to send update message to channel';
            if (channel instanceof TextChannel) {
                const textChannel: TextChannel = channel as TextChannel;
                const guild = textChannel.guild;
                errorMessage += ` \`#${textChannel.name}\` in guild _${guild.name}_`;
                if (state.hasTrackingChannel(guild.id)) {
                    const trackingChannel = state.getTrackingChannel(guild.id);
                    errorMessage += ` (tracking channel is \`#${trackingChannel.name}\`)`;
                } else {
                    errorMessage += ' (no tracking channel)';
                }
            } else {
                errorMessage += ` with ID \`${channel.id}\``;
            }
            await logger.log(`${errorMessage}: \`${err}\``, MultiLoggerLevel.Error);
        }
    }
}

export async function replyUpdateMessage(interaction: ChatInputCommandInteraction, text: string, name: string, options?: UpdateMessageOptions): Promise<void> {
    try {
        await interaction.reply(buildUpdateMessage(text, name, options));
    } catch (err) {
        await logger.log(`Unable to reply to interaction \`${interaction.id}\` with update message: \`${err}\``, MultiLoggerLevel.Error);
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
                throw new Error(`Invalid **${kind}** diff, \`${afterValue}\` minus \`${beforeValue}\` is \`${thisDiff}\``);
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

export function toSortedCluesNoAll(clues: string[]): IndividualClueType[] {
    const clueSubSet: Set<string> = new Set(clues);
    return CLUES_NO_ALL.filter((clue: IndividualClueType) => clueSubSet.has(clue));
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
                await pgStorageClient.writeMiscProperty('disabled', 'true');
                await sendUpdateMessage(state.getAllTrackingChannels(),
                    'The hiscores API has changed, the bot is now disabled. Waiting for the bot maintainers to fix this then re-enable...',
                    'wrench',
                    { color: GRAY_EMBED_COLOR });
            }
        } else if ((err instanceof Error) && err.message === PLAYER_404_ERROR) {
            // TODO: Should we re-enable the logic to remove 404 players? We haven't confirmed what this means yet.
            // If the player doesn't exist (this should be prevented by the validation in /track), remove globally
            // const guildsToRemoveFrom = state.getGuildsTrackingPlayer(rsn);
            // for (const guildId of guildsToRemoveFrom) {
            //     state.removeTrackedPlayer(guildId, rsn);
            //     await pgStorageClient.deleteTrackedPlayer(guildId, rsn);
            // }
            // await logger.log(`Received \`404\` when fetching hiscores for **${rsn}**, removed player from **${guildsToRemoveFrom.length}** guild(s).`, MultiLoggerLevel.Error);
        } else {
            logger.log(`Error while fetching player hiscores for ${rsn}: \`${err}\``, MultiLoggerLevel.Warn);
        }
        return;
    }

    // Check whether the player's overall hiscore state needs to be updated...
    if (!data.onHiScores && state.isPlayerOnHiScores(rsn)) {
        // If player was previously on the hiscores, take them off
        state.removePlayerFromHiScores(rsn);
        await pgStorageClient.writePlayerHiScoreStatus(rsn, false);
        await sendUpdateMessage(state.getTrackingChannelsForPlayer(rsn), `**${state.getDisplayName(rsn)}** has fallen off the hiscores`, 'unhappy', { color: RED_EMBED_COLOR });
    } else if (data.onHiScores && !state.isPlayerOnHiScores(rsn)) {
        // If player was previously off the hiscores, add them back on!
        state.addPlayerToHiScores(rsn);
        await pgStorageClient.writePlayerHiScoreStatus(rsn, true);
        await sendUpdateMessage(state.getTrackingChannelsForPlayer(rsn), `**${state.getDisplayName(rsn)}** has made it back onto the hiscores`, 'happy', { color: YELLOW_EMBED_COLOR });
    }

    let anyActivity = false;

    // Check if levels have changes and send notifications
    if (state.hasLevels(rsn)) {
        const activity = await updateLevels(rsn, data.levelsWithDefaults, spoofedDiff);
        anyActivity = anyActivity || activity;
    } else {
        // If this player has no levels in the state, prime with initial data (NOT including assumed defaults)
        state.setLevels(rsn, data.levels);
        state.setLastUpdated(rsn, new Date());
        await pgStorageClient.writePlayerLevels(rsn, data.levels);
    }

    // Check if bosses have changes and send notifications
    if (state.hasBosses(rsn)) {
        const activity = await updateKillCounts(rsn, data.bossesWithDefaults, spoofedDiff);
        anyActivity = anyActivity || activity;
    } else {
        // If this player has no bosses in the state, prime with initial data (NOT including assumed defaults)
        state.setBosses(rsn, data.bosses);
        state.setLastUpdated(rsn, new Date());
        await pgStorageClient.writePlayerBosses(rsn, data.bosses);
    }

    // Check if clues have changes and send notifications
    if (state.hasClues(rsn)) {
        const activity = await updateClues(rsn, data.cluesWithDefaults, spoofedDiff);
        anyActivity = anyActivity || activity;
    } else {
        // If this player has no clues in the state, prime with initial data (NOT including assumed defaults)
        state.setClues(rsn, data.clues);
        state.setLastUpdated(rsn, new Date());
        await pgStorageClient.writePlayerClues(rsn, data.clues);
    }

    // If the player saw any sort of activity
    if (anyActivity) {
        // Mark the player as active
        state.markPlayerAsActive(rsn);
        await pgStorageClient.updatePlayerActivityTimestamp(rsn);
        // If the player is missing a display name, try and fetch that now (since they're confirmed to be on the hiscores)
        if (!state.hasDisplayName(rsn)) {
            try {
                const displayName = await getRSNFormat(rsn);
                state.setDisplayName(rsn, displayName);
                await pgStorageClient.writePlayerDisplayName(rsn, displayName);
                await logger.log(`(Update) Fetched display name for **${rsn}** as **${displayName}** (**${state.getNumPlayerDisplayNames()}**/**${state.getNumGloballyTrackedPlayers()}** complete)`, MultiLoggerLevel.Warn);
            } catch (err) {
                await logger.log(`(Update) Failed to fetch display name for **${rsn}**: \`${err}\``, MultiLoggerLevel.Warn);
            }
        }
    }
}

export async function updateLevels(rsn: string, newLevels: Record<IndividualSkillName, number>, spoofedDiff?: Record<string, number>): Promise<boolean> {
    // We shouldn't be doing this if this player doesn't have any skill info in the state
    if (!state.hasLevels(rsn)) {
        return false;
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
            logger.log(`Failed to compute level diff for player ${rsn}: ${err.message}`, MultiLoggerLevel.Error);
        }
        return false;
    }
    if (!diff) {
        return false;
    }
    // Send a message for any skill that is now 99
    const updatedSkills: IndividualSkillName[] = toSortedSkillsNoOverall(Object.keys(diff));
    const updated99Skills = updatedSkills.filter(skill => newLevels[skill] === 99);
    for (const skill of updated99Skills) {
        const levelsGained = diff[skill];
        await sendUpdateMessage(state.getTrackingChannelsForPlayer(rsn),
            `**${state.getDisplayName(rsn)}** has gained `
                + (levelsGained === 1 ? 'a level' : `**${levelsGained}** levels`)
                + ` in **${skill}** and is now level **99**`,
            skill, {
                header: '@everyone',
                is99: true,
                reacts: ['🇬', '🇿']
            });
    }
    // Send a message showing all the levels gained for all non-99 skills
    const updatedIncompleteSkills = updatedSkills.filter(skill => !updated99Skills.includes(skill));
    switch (updatedIncompleteSkills.length) {
    case 0:
        break;
    case 1: {
        const skill = updatedIncompleteSkills[0];
        const levelsGained = diff[skill];
        const text = `**${state.getDisplayName(rsn)}** has gained `
            + (levelsGained === 1 ? 'a level' : `**${levelsGained}** levels`)
            + ` in **${skill}** and is now level **${newLevels[skill]}**`;
        await sendUpdateMessage(state.getTrackingChannelsForPlayer(rsn), text, skill);
        break;
    }
    default: {
        const text = updatedIncompleteSkills.map((skill) => {
            const levelsGained = diff[skill];
            return `${levelsGained === 1 ? 'a level' : `**${levelsGained}** levels`} in **${skill}** and is now level **${newLevels[skill]}**`;
        }).join('\n');
        await sendUpdateMessage(state.getTrackingChannelsForPlayer(rsn), `**${state.getDisplayName(rsn)}** has gained...\n${text}`, 'overall');
        break;
    }
    }

    // If not spoofing the diff, update player's levels
    if (!spoofedDiff) {
        // Write only updated skills to PG
        await pgStorageClient.writePlayerLevels(rsn, filterMap(newLevels, updatedSkills));
        state.setLevels(rsn, newLevels);
        state.setLastUpdated(rsn, new Date());
        if (updatedSkills.length > 0) {
            await logger.log(`**${rsn}** update: \`${JSON.stringify(diff)}\``, MultiLoggerLevel.Info);
            return true;
        }
    }
    return false;
}

export async function updateKillCounts(rsn: string, newScores: Record<Boss, number>, spoofedDiff?: Record<string, number>): Promise<boolean> {
    // We shouldn't be doing this if this player doesn't have any boss info in the state
    if (!state.hasBosses(rsn)) {
        return false;
    }

    // Compute diff for each boss
    let diff: Partial<Record<Boss, number>>;
    try {
        if (spoofedDiff) {
            diff = {};
            for (const boss of BOSSES) {
                if (boss in spoofedDiff) {
                    diff[boss] = spoofedDiff[boss];
                    newScores[boss] += spoofedDiff[boss];
                }
            }
        } else {
            diff = computeDiff(state.getBosses(rsn), newScores, DEFAULT_BOSS_SCORE);
        }
    } catch (err) {
        if (err instanceof Error && err.message) {
            logger.log(`Failed to compute boss KC diff for player ${rsn}: ${err.message}`, MultiLoggerLevel.Error);
        }
        return false;
    }
    if (!diff) {
        return false;
    }
    // Send a message showing all the incremented boss scores
    const updatedBosses: Boss[] = Object.keys(diff) as Boss[];
    // Only use a kill verb if all the updated bosses are "killable" bosses, else use a complete verb
    const verb: string = updatedBosses.some(boss => COMPLETE_VERB_BOSSES.has(boss)) ? randChoice(...DOPE_COMPLETE_VERBS) : randChoice(...DOPE_KILL_VERBS);
    switch (updatedBosses.length) {
    case 0:
        break;
    case 1: {
        const boss: Boss = updatedBosses[0];
        const scoreIncrease = diff[boss];
        const bossName = getBossName(boss);
        const text = newScores[boss] === 1
            ? `**${state.getDisplayName(rsn)}** ${verb} **${bossName}** for the first time!`
            : `**${state.getDisplayName(rsn)}** ${verb} **${bossName}** `
                    + (scoreIncrease === 1 ? 'again' : `**${scoreIncrease}** more times`)
                    + ` for a total of **${newScores[boss]}**`;
        sendUpdateMessage(state.getTrackingChannelsForPlayer(rsn), text, boss, { color: BOSS_EMBED_COLOR });
        break;
    }
    default: {
        const text = updatedBosses.map((boss) => {
            const scoreIncrease = diff[boss];
            const bossName = getBossName(boss);
            return newScores[boss] === 1
                ? `**${bossName}** for the first time!`
                : `**${bossName}** ${scoreIncrease === 1 ? 'again' : `**${scoreIncrease}** more times`} for a total of **${newScores[boss]}**`;
        }).join('\n');
        sendUpdateMessage(
            state.getTrackingChannelsForPlayer(rsn),
            `**${state.getDisplayName(rsn)}** ${verb}...\n${text}`,
            // Show the first boss in the list as the icon
            getBossName(updatedBosses[0]),
            { color: BOSS_EMBED_COLOR }
        );
        break;
    }
    }

    // If not spoofing the diff, update player's boss scores
    if (!spoofedDiff) {
        // Write only updated bosses to PG
        await pgStorageClient.writePlayerBosses(rsn, filterMap(newScores, updatedBosses));
        state.setBosses(rsn, newScores);
        state.setLastUpdated(rsn, new Date());
        if (updatedBosses.length > 0) {
            await logger.log(`**${rsn}** update: \`${JSON.stringify(diff)}\``, MultiLoggerLevel.Info);
            return true;
        }
    }
    return false;
}

export async function updateClues(rsn: string, newScores: Record<IndividualClueType, number>, spoofedDiff?: Record<string, number>): Promise<boolean> {
    // We shouldn't be doing this if this player doesn't have any clue info in the state
    if (!state.hasBosses(rsn)) {
        return false;
    }

    // Compute diff for each clue
    let diff: Partial<Record<IndividualClueType, number>>;
    try {
        if (spoofedDiff) {
            diff = {};
            for (const clue of CLUES_NO_ALL) {
                if (clue in spoofedDiff) {
                    diff[clue] = spoofedDiff[clue];
                    newScores[clue] += spoofedDiff[clue];
                }
            }
        } else {
            diff = computeDiff(state.getClues(rsn), newScores, DEFAULT_CLUE_SCORE);
        }
    } catch (err) {
        if (err instanceof Error && err.message) {
            logger.log(`Failed to compute clue score diff for player ${rsn}: ${err.message}`, MultiLoggerLevel.Error);
        }
        return false;
    }
    if (!diff) {
        return false;
    }
    // Send a message showing the updated clues
    const updatedClues: IndividualClueType[] = toSortedCluesNoAll(Object.keys(diff));
    switch (updatedClues.length) {
    case 0:
        break;
    case 1: {
        const clue = updatedClues[0];
        const scoreGained = diff[clue];
        const text = `**${state.getDisplayName(rsn)}** has completed `
            + (scoreGained === 1 ? 'another' : `**${scoreGained}** more`)
            + ` **${clue}** `
            + (scoreGained === 1 ? 'clue' : 'clues')
            + ` for a total of **${newScores[clue]}**`;
        await sendUpdateMessage(state.getTrackingChannelsForPlayer(rsn), text, clue, { color: CLUE_EMBED_COLOR });
        break;
    }
    default: {
        const text = updatedClues.map((clue) => {
            const scoreGained = diff[clue];
            return `${scoreGained === 1 ? 'another' : `**${scoreGained}** more`} **${clue}** ${scoreGained === 1 ? 'clue' : 'clues'} for a total of **${newScores[clue]}**`;
        }).join('\n');
        await sendUpdateMessage(state.getTrackingChannelsForPlayer(rsn),
            `**${state.getDisplayName(rsn)}** has completed...\n${text}`,
            // Show the highest level clue as the icon
            updatedClues[updatedClues.length - 1],
            { color: CLUE_EMBED_COLOR });
        break;
    }
    }

    // If not spoofing the diff, update player's clue scores
    if (!spoofedDiff) {
        // Write only updated clues to PG
        await pgStorageClient.writePlayerClues(rsn, filterMap(newScores, updatedClues));
        state.setClues(rsn, newScores);
        state.setLastUpdated(rsn, new Date());
        if (updatedClues.length > 0) {
            await logger.log(`**${rsn}** update: \`${JSON.stringify(diff)}\``, MultiLoggerLevel.Info);
            return true;
        }
    }
    return false;
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

/**
 * Takes a list of RSN strings and generates the content returned in the /details command,
 * keeping below the character limit without cutting off midline. If the character limit
 * is reached, it keeps up to the last line within the limit and adds a final line indicating
 * how many remaining players there are (ex: "plus 3 more...").
 */
export function generateDetailsContentString(players: string[]): string {
    const CONTENT_MAX_LENGTH = 2000;
    let contentString = '';
    for (let i = 0; i < players.length; i++) {
        const rsn = players[i];
        const line = `**${state.getDisplayName(rsn)}**: last updated **${state.getLastUpdated(rsn)?.toLocaleTimeString('en-US', { timeZone: CONFIG.timeZone })}**\n`;
        // The cutoff text is based on the remaining players from the previous iteration,
        // so we can just use the index (instead i + 1 to indicate count)
        const cutoffText = `**plus ${players.length - i} more...**`;
        // If appending to the content string will exceed the max character limit, add the
        // cutoff text and finish
        if (contentString.length + line.length > CONTENT_MAX_LENGTH - cutoffText.length) {
            contentString += cutoffText;
            break;
        }
        contentString += line;
    }
    return contentString;
}

/**
 * Given some RSN, return a cleaned-up version that can be deterministically derived from any valid variation of it.
 * @param rsn Some RSN
 * @returns Lower-cased RSN with hyphens and underscores converted to spaces
 */
export function sanitizeRSN(rsn: string): string {
    return rsn.replace(/[ _-]/g, '_').toLowerCase();
}

export async function sendDMToGuildOwner(guild: Guild, text: string) {
    const owner = await guild.fetchOwner();
    // Implicitly creates a DM channel with the owner
    await owner.send(text);
}
