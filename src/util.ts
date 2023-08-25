import { Boss, BOSSES, INVALID_FORMAT_ERROR, FORMATTED_BOSS_NAMES, getRSNFormat } from 'osrs-json-hiscores';
import fs from 'fs';
import { APIEmbed, ActionRowData, ButtonStyle, ChatInputCommandInteraction, ComponentType, Guild, MessageActionRowComponentData, MessageCreateOptions, PermissionFlagsBits, PermissionsBitField, Snowflake, TextBasedChannel, TextChannel } from 'discord.js';
import { addReactsSync, DiscordTimestampFormat, getPreciseDurationString, MultiLoggerLevel, naturalJoin, randChoice, toDiscordTimestamp } from 'evanw555.js';
import { IndividualClueType, IndividualSkillName, IndividualActivityName, PlayerHiScores } from './types';
import { fetchHiScores } from './hiscores';
import { CONSTANTS, BOSS_EMBED_COLOR, CLUES_NO_ALL, CLUE_EMBED_COLOR, COMPLETE_VERB_BOSSES, DEFAULT_BOSS_SCORE, DEFAULT_CLUE_SCORE, DEFAULT_SKILL_LEVEL, DOPE_COMPLETE_VERBS, DOPE_KILL_VERBS, GRAY_EMBED_COLOR, PLAYER_404_ERROR, RED_EMBED_COLOR, SKILLS_NO_OVERALL, SKILL_EMBED_COLOR, YELLOW_EMBED_COLOR, REQUIRED_PERMISSIONS, REQUIRED_PERMISSION_NAMES, INACTIVE_THRESHOLD_MILLIES, CONFIG, DEFAULT_AXIOS_CONFIG, OTHER_ACTIVITIES, DEFAULT_ACTIVITY_SCORE, ACTIVITY_EMBED_COLOR, OTHER_ACTIVITIES_MAP } from './constants';

import state from './instances/state';
import logger from './instances/logger';
import pgStorageClient from './instances/pg-storage-client';
import timeSlotInstance from './instances/timeslot';
import timer from './instances/timer';

const validSkills: Set<string> = new Set(CONSTANTS.skills);
const validClues: Set<string> = new Set(CLUES_NO_ALL);
const validMiscThumbnails: Set<string> = new Set(CONSTANTS.miscThumbnails);

export function getBossName(boss: Boss): string {
    return FORMATTED_BOSS_NAMES[boss] ?? 'Unknown';
}

export function getActivityName(activity: IndividualActivityName): string {
    return OTHER_ACTIVITIES_MAP[activity] ?? 'Unknown';
}

export function isValidBoss(boss: string): boss is Boss {
    return BOSSES.indexOf(boss as Boss) > -1;
}

export function isValidActivity(activity: string): activity is IndividualActivityName {
    return OTHER_ACTIVITIES.indexOf(activity as IndividualActivityName) > -1;
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
    if (isValidActivity(name)) {
        const activity = name;
        return {
            url: `${CONSTANTS.baseThumbnailUrl}${activity}${CONSTANTS.imageFileExtension}`
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
    // Extra embeds to add to the bottom of the message
    extraEmbeds?: APIEmbed[]
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
        }, ...(options?.extraEmbeds ?? [])]
    };
}

export async function sendUpdateMessage(channels: TextBasedChannel[], text: string, name: string, options?: SendUpdateMessageOptions): Promise<void> {
    const updateMessage = buildUpdateMessage(text, name, options);
    for (const channel of channels) {
        try {
            const message = await channel.send(updateMessage);
            // If any reacts are specified, add them
            if (options?.reacts) {
                await addReactsSync(message, options.reacts);
            }
        } catch (err) {
            let errorMessage = `Unable to send update message \`${text.slice(0, 100)}\` to channel`;
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
            await logger.log(`${errorMessage}: \`${err}\``, MultiLoggerLevel.Warn);
        }
    }
}

export async function replyUpdateMessage(interaction: ChatInputCommandInteraction, text: string, name: string, options?: UpdateMessageOptions): Promise<void> {
    try {
        await interaction.reply(buildUpdateMessage(text, name, options));
    } catch (err) {
        await logger.log(`Unable to reply to interaction \`${interaction.id}\` with update message: \`${err}\``, MultiLoggerLevel.Warn);
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

export async function updatePlayer(rsn: string, options?: { spoofedDiff?: Record<string, number>, primer?: boolean }): Promise<void> {
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
            // If the player can't be found yet still somehow shows up as "on" the hiscores, remove them silently.
            // This is needed because if there's a 404 when a player's data is "primed", their negative status won't be written
            // and thus they'll show up as "falling off" the hiscores when they can finally be found (but TBH we still don't know fully what a 404 means).
            if (state.isPlayerOnHiScores(rsn)) {
                await pgStorageClient.writePlayerHiScoreStatus(rsn, false);
                state.setPlayerHiScoreStatus(rsn, false);
                // TODO: Temp logging to see how this is playing out
                await logger.log(`Silently removed **${state.getDisplayName(rsn)}** from the hiscores due to update 404`, MultiLoggerLevel.Debug);
            }
            // If the player was active/inactive then suddenly sees a 404 (banned?), adjust their timestamp to bump them down to the archive queue
            if (options?.primer || state.getTimeSincePlayerLastActive(rsn) < INACTIVE_THRESHOLD_MILLIES) {
                // TODO: Can we make this less hacky? We just want to archive them while also keeping a timestamp for them (so we can purge them later...)
                const archiveTimestamp = new Date(new Date().getTime() - INACTIVE_THRESHOLD_MILLIES);
                await pgStorageClient.updatePlayerActivityTimestamp(rsn, archiveTimestamp);
                state.markPlayerAsActive(rsn, archiveTimestamp);
                // TODO: Temp logging to see how this is playing out
                await logger.log(`Archive player **${state.getDisplayName(rsn)}** due to update 404`, MultiLoggerLevel.Debug);

            }
            // TODO: Should we re-enable the logic to remove 404 players? We haven't confirmed what this means yet.
            // If the player doesn't exist (this should be prevented by the validation in /track), remove globally
            // const guildsToRemoveFrom = state.getGuildsTrackingPlayer(rsn);
            // for (const guildId of guildsToRemoveFrom) {
            //     state.removeTrackedPlayer(guildId, rsn);
            //     await pgStorageClient.deleteTrackedPlayer(guildId, rsn);
            // }
            // await logger.log(`Received \`404\` when fetching hiscores for **${rsn}**, removed player from **${guildsToRemoveFrom.length}** guild(s).`, MultiLoggerLevel.Error);
        } else {
            await logger.log(`Error while fetching player hiscores for ${rsn}: \`${err}\``, MultiLoggerLevel.Warn);
        }
        return;
    }

    // Try to fetch a missing display name only if "priming" or if the player is on the hiscores (since that's when the name becomes accessible)
    if ((options?.primer || data.onHiScores) && !state.hasDisplayName(rsn)) {
        try {
            const displayName = await fetchDisplayName(rsn);
            state.setDisplayName(rsn, displayName);
            await pgStorageClient.writePlayerDisplayName(rsn, displayName);
            await logger.log(`Fetched display name for **${rsn}** as **${displayName}** (**${state.getNumPlayerDisplayNames()}**/**${state.getNumGloballyTrackedPlayers()}** complete)`, MultiLoggerLevel.Debug);
        } catch (err) {
            // TODO: Reduce this down to Info if this appears to be working as expected (no repeated failures)
            await logger.log(`Failed to fetch display name for **${rsn}**: \`${err}\``, MultiLoggerLevel.Warn);
        }
    }

    // HiScore status (and display name) updating logic...
    if (options?.primer) {
        // This is the "primer" update, so write the player's hiscore status but DON'T notify
        state.setPlayerHiScoreStatus(rsn, data.onHiScores);
        await pgStorageClient.writePlayerHiScoreStatus(rsn, data.onHiScores);
        await logger.log(`**${state.getDisplayName(rsn)}** primed with **${data.onHiScores}** hiscore status`, MultiLoggerLevel.Debug);
    } else {
        // On normal updates, check whether the player's overall hiscore state needs to be updated...
        if (!data.onHiScores && state.isPlayerOnHiScores(rsn)) {
            // If player was previously on the hiscores, take them off
            state.removePlayerFromHiScores(rsn);
            await pgStorageClient.writePlayerHiScoreStatus(rsn, false);
            await sendUpdateMessage(state.getTrackingChannelsForPlayer(rsn), `**${state.getDisplayName(rsn)}** has fallen off the overall hiscores`, 'unhappy', { color: RED_EMBED_COLOR });
            // TODO: Temp logging to see how often this is being triggered
            await logger.log(`**${state.getDisplayName(rsn)}** has fallen off the overall hiscores`, MultiLoggerLevel.Warn);
        } else if (data.onHiScores && !state.isPlayerOnHiScores(rsn)) {
            // Player was previously off the hiscores, so add them back on!
            state.addPlayerToHiScores(rsn);
            await pgStorageClient.writePlayerHiScoreStatus(rsn, true);
            await sendUpdateMessage(state.getTrackingChannelsForPlayer(rsn), `**${state.getDisplayName(rsn)}** has made it onto the overall hiscores`, 'happy', { color: YELLOW_EMBED_COLOR });
            // TODO: Temp logging to see how often this is being triggered
            await logger.log(`**${state.getDisplayName(rsn)}** has made it onto the overall hiscores`, MultiLoggerLevel.Warn);
        }
    }

    let activity = false;

    // Check if levels have changes and send notifications
    if (state.hasLevels(rsn)) {
        const a = await updateLevels(rsn, data.levelsWithDefaults, options?.spoofedDiff);
        activity = activity || a;
    } else {
        // If this player has no levels in the state, prime with initial data (NOT including assumed defaults)
        state.setLevels(rsn, data.levels);
        state.setLastUpdated(rsn, new Date());
        await pgStorageClient.writePlayerLevels(rsn, data.levels);
    }

    // Check if bosses have changes and send notifications
    if (state.hasBosses(rsn)) {
        const a = await updateKillCounts(rsn, data.bossesWithDefaults, options?.spoofedDiff);
        activity = activity || a;
    } else {
        // If this player has no bosses in the state, prime with initial data (NOT including assumed defaults)
        state.setBosses(rsn, data.bosses);
        state.setLastUpdated(rsn, new Date());
        await pgStorageClient.writePlayerBosses(rsn, data.bosses);
    }

    // Check if clues have changes and send notifications
    if (state.hasClues(rsn)) {
        const a = await updateClues(rsn, data.cluesWithDefaults, options?.spoofedDiff);
        activity = activity || a;
    } else {
        // If this player has no clues in the state, prime with initial data (NOT including assumed defaults)
        state.setClues(rsn, data.clues);
        state.setLastUpdated(rsn, new Date());
        await pgStorageClient.writePlayerClues(rsn, data.clues);
    }

    // Check if other activities have changes and send notifications
    if (state.hasActivities(rsn)) {
        const a = await updateActivities(rsn, data.activitiesWithDefaults, options?.spoofedDiff);
        activity = activity || a;
    } else {
        // If this player has no activities in the state, prime with initial date (NOT including assumed defaults)
        state.setActivities(rsn, data.activities);
        state.setLastUpdated(rsn, new Date());
        await pgStorageClient.writePlayerActivities(rsn, data.activities);
    }

    // If the user is on the overall hiscores, process their total XP
    if (data.totalXp) {
        // If there's no total XP for this player, fill it in now
        // TODO: This is temp logic to avoid every player being marked as active while total XP values are being filled in. Delete this later...
        if (!state.hasTotalXp(rsn)) {
            // Update their total XP in the state and in PG
            state.setTotalXp(rsn, data.totalXp);
            await pgStorageClient.updatePlayerTotalXp(rsn, data.totalXp);
        }

        const gainedXp = data.totalXp > state.getTotalXp(rsn);
        // A positive change in total XP is considered "activity"
        activity = activity || gainedXp;
        // Update their total XP in the state and in PG
        if (gainedXp || !state.hasTotalXp(rsn)) {
            state.setTotalXp(rsn, data.totalXp);
            await pgStorageClient.updatePlayerTotalXp(rsn, data.totalXp);
        }
    }

    // If the player saw any sort of activity (or if we're priming a new player's data)
    if (activity || options?.primer) {
        // Mark the player as active
        state.markPlayerAsActive(rsn);
        await pgStorageClient.updatePlayerActivityTimestamp(rsn);
    }

    // TODO: Temp logic for time slot activity analysis
    if (activity) {
        timeSlotInstance.incrementPlayer(rsn);
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
            await logger.log(`Failed to compute level diff for player ${rsn}: ${err.message}`, MultiLoggerLevel.Error);
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
                // TODO: Disabling the @everyone tagnow , but make it configurable when we support server settings
                // header: '@everyone',
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
            await logger.log(`**${rsn}** update: \`${JSON.stringify(diff)}\``, MultiLoggerLevel.Debug);
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
            await logger.log(`Failed to compute boss KC diff for player ${rsn}: ${err.message}`, MultiLoggerLevel.Error);
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
        await sendUpdateMessage(state.getTrackingChannelsForPlayer(rsn), text, boss, { color: BOSS_EMBED_COLOR });
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
        await sendUpdateMessage(
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
            await logger.log(`**${rsn}** update: \`${JSON.stringify(diff)}\``, MultiLoggerLevel.Debug);
            return true;
        }
    }
    return false;
}

export async function updateClues(rsn: string, newScores: Record<IndividualClueType, number>, spoofedDiff?: Record<string, number>): Promise<boolean> {
    // We shouldn't be doing this if this player doesn't have any clue info in the state
    if (!state.hasClues(rsn)) {
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
            await logger.log(`Failed to compute clue score diff for player ${rsn}: ${err.message}`, MultiLoggerLevel.Error);
        }
        return false;
    }
    if (!diff) {
        return false;
    }
    // Send a message showing the updated clues
    const getClueCompletionPhrase = (_clue: IndividualClueType, _scoreGained: number, _newScore: number): string => {
        let quantityText = '';
        if (_scoreGained === 1 && _newScore === 1) {
            quantityText = 'their first';
        } else if (_scoreGained === _newScore) {
            quantityText = `**${_scoreGained}**`;
        } else if (_scoreGained === 1) {
            quantityText = 'another';
        } else {
            quantityText = `**${_scoreGained}** more`;
        }
        return quantityText + ` **${_clue}** ${_scoreGained === 1 ? 'clue' : 'clues'} for a total of **${_newScore}**`;
    };
    const updatedClues: IndividualClueType[] = toSortedCluesNoAll(Object.keys(diff));
    switch (updatedClues.length) {
    case 0:
        break;
    case 1: {
        const clue = updatedClues[0];
        const scoreGained = diff[clue] ?? 0;
        const text = `**${state.getDisplayName(rsn)}** has completed ${getClueCompletionPhrase(clue, scoreGained, newScores[clue])}`;
        await sendUpdateMessage(state.getTrackingChannelsForPlayer(rsn), text, clue, { color: CLUE_EMBED_COLOR });
        break;
    }
    default: {
        const text = updatedClues.map((clue) => {
            const scoreGained = diff[clue] ?? 0;
            return getClueCompletionPhrase(clue, scoreGained, newScores[clue]);
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
            await logger.log(`**${rsn}** update: \`${JSON.stringify(diff)}\``, MultiLoggerLevel.Debug);
            return true;
        }
    }
    return false;
}

export async function updateActivities(rsn: string, newScores: Record<IndividualActivityName, number>, spoofedDiff?: Record<string, number>): Promise<boolean> {
    // We shouldn't be doing this if this player doesn't have any activity info in the state
    if (!state.hasActivities(rsn)) {
        return false;
    }

    // Compute diff for each activity
    let diff: Partial<Record<IndividualActivityName, number>>;
    try {
        if (spoofedDiff) {
            diff = {};
            for (const activity of OTHER_ACTIVITIES) {
                if (activity in spoofedDiff) {
                    diff[activity] = spoofedDiff[activity];
                    newScores[activity] += spoofedDiff[activity];
                }
            }
        } else {
            diff = computeDiff(state.getActivities(rsn), newScores, DEFAULT_ACTIVITY_SCORE);
        }
    } catch (err) {
        if (err instanceof Error && err.message) {
            await logger.log(`Failed to compute activity score diff for player ${rsn}: ${err.message}`, MultiLoggerLevel.Error);
        }
        return false;
    }
    if (!diff) {
        return false;
    }
    // Send a message showing the updated activities
    const getActivityCompletionPhrase = (_activity: string, _scoreGained: number, _newScore: number): string => {
        let quantityText = '';
        if (_scoreGained === 1 && _newScore === 1) {
            quantityText = 'their first';
        } else if (_scoreGained === _newScore) {
            quantityText = `**${_scoreGained}**`;
        } else if (_scoreGained === 1) {
            quantityText = 'another';
        } else {
            quantityText = `**${_scoreGained}** more`;
        }
        return quantityText + ` **${_activity}** for a total of **${_newScore}**`;
    };
    const getActivityPhrase = (_activity: string, _scoreGained: number, _newScore: number): string => {
        switch (_activity) {
        case 'leaguePoints':
            return `has earned ${getActivityCompletionPhrase(getActivityName(_activity), _scoreGained, _newScore)}`;
        case 'lastManStanding':
            return `is now rank **${_newScore}** in **Last Man Standing**`;
        case 'pvpArena':
            return  `is now rank **${_newScore}** in the **PvP Arena**`;
        case 'soulWarsZeal':
            return `has earned ${getActivityCompletionPhrase(getActivityName(_activity), _scoreGained, _newScore)}`;
        case 'riftsClosed':
            return `closed another ${_scoreGained === 1 ? '' : `**${_scoreGained}** `}**${_scoreGained === 1 ? 'rift' : 'rifts'}** for a total of **${_newScore}**`;
        default:
            return 'N/A';
        }
    };
    const updatedActivities: IndividualActivityName[] = Object.keys(diff) as IndividualActivityName[];
    switch (updatedActivities.length) {
    case 0:
        break;
    case 1: {
        const activity = updatedActivities[0];
        const scoreGained = diff[activity] ?? 0;
        const text = `**${state.getDisplayName(rsn)}** ${getActivityPhrase(activity, scoreGained, newScores[activity])}`;
        await sendUpdateMessage(state.getTrackingChannelsForPlayer(rsn), text, activity, { color: ACTIVITY_EMBED_COLOR });
        break;
    }
    default: {
        const text = updatedActivities.map((activity) => {
            const scoreGained = diff[activity] ?? 0;
            return getActivityPhrase(activity, scoreGained, newScores[activity]);
        }).join('\n');
        await sendUpdateMessage(state.getTrackingChannelsForPlayer(rsn),
            `**${state.getDisplayName(rsn)}**...\n${text}`,
            // Show the first activity as the icon
            updatedActivities[0],
            { color: ACTIVITY_EMBED_COLOR });
        break;
    }
    }

    // If not spoofing the diff, update player's activities
    if (!spoofedDiff) {
        // Write only updated clues to PG
        await pgStorageClient.writePlayerClues(rsn, filterMap(newScores, updatedActivities));
        state.setActivities(rsn, newScores);
        state.setLastUpdated(rsn, new Date());
        if (updatedActivities.length > 0) {
            await logger.log(`**${rsn}** update: \`${JSON.stringify(diff)}\``, MultiLoggerLevel.Debug);
            return true;
        }
    }
    return false;
}

/**
 * Given a set of RSNs, trigger a purge of player data from PG if any of the players are globally untracked.
 * @param rsns Set of RSNs to check for purging
 * @param label Label for logging purposes only
 */
export async function purgeUntrackedPlayers(rsns: string[], label: string) {
    // If any of the given players are globally untracked, purge untracked player data
    const globallyUntrackedPlayers = rsns.filter(rsn => !state.isPlayerTrackedInAnyGuilds(rsn));
    if (globallyUntrackedPlayers.length > 0) {
        const purgeResults = await pgStorageClient.purgeUntrackedPlayerData();
        // If any rows were deleted, log this
        if (Object.keys(purgeResults).length > 0) {
            await logger.log(`(\`${label}\`) ${naturalJoin(globallyUntrackedPlayers, { bold: true })} now globally untracked, purged rows: \`${JSON.stringify(purgeResults)}\``, MultiLoggerLevel.Warn);
        }
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
    // If this time is in the past, fast-forward to following week
    if (nextFriday.getTime() <= new Date().getTime()) {
        nextFriday.setHours(nextFriday.getHours() + (24 * 7));
    }
    return nextFriday;
}

export function getNextEvening(): Date {
    // Get today at 5:20pm
    const nextEvening: Date = new Date();
    nextEvening.setHours(17, 20, 0, 0);
    // If this time is in the past, fast-forward to tomorrow
    if (nextEvening.getTime() <= new Date().getTime()) {
        nextEvening.setDate(nextEvening.getDate() + 1);
    }
    return nextEvening;
}

/**
 * Takes a list of RSN strings and generates the content returned in the /details command,
 * keeping below the character limit without cutting off midline. If the character limit
 * is reached, it keeps up to the last line within the limit and adds a final line indicating
 * how many remaining players there are (ex: "plus 3 more...").
 */
export function generateDetailsContentString(players: string[]): string {
    const CONTENT_MAX_LENGTH = 2000;
    let contentString = 'When each tracked player was last updated:\n';
    const orderedPlayers: string[] = players.filter(rsn => state.getLastUpdated(rsn) !== undefined)
        .sort((x, y) => (state.getLastUpdated(y)?.getTime() ?? 0) - (state.getLastUpdated(x)?.getTime() ?? 0));
    const datelessPlayers: string[] = players.filter(rsn => !orderedPlayers.includes(rsn));
    if (datelessPlayers.length > 0) {
        contentString += `(**${datelessPlayers.length}** ${datelessPlayers.length === 1 ? 'player hasn\'t' : 'players haven\'t'} been updated since the last reboot **${getPreciseDurationString(timer.getTimeSinceBoot())}** ago)\n`;
    }
    for (let i = 0; i < orderedPlayers.length; i++) {
        const rsn = orderedPlayers[i];
        const date = state.getLastUpdated(rsn);
        if (date) {
            const line = `**${state.getDisplayName(rsn)}**: ${toDiscordTimestamp(date, DiscordTimestampFormat.LongTime)}\n`;
            // The cutoff text is based on the remaining players from the previous iteration,
            // so we can just use the index (instead i + 1 to indicate count)
            const cutoffText = `**plus ${orderedPlayers.length - i} more...**`;
            // If appending to the content string will exceed the max character limit, add the
            // cutoff text and finish
            if (contentString.length + line.length > CONTENT_MAX_LENGTH - cutoffText.length) {
                contentString += cutoffText;
                break;
            }
            contentString += line;
        }
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

/**
 * TODO: This is copied from osrs-json-hiscores, should we open a PR to add this method there?
 * @param rsn username to validate
 * @throws error if the RSN fails validation
 */
export function validateRSN(rsn: string): void {
    if (typeof rsn !== 'string') {
        throw new Error('RSN must be a string');
    } else if (!/^[a-zA-Z0-9 _-]+$/.test(rsn)) {
        throw new Error('RSN contains invalid character');
    } else if (rsn.length > 12 || rsn.length < 1) {
        throw new Error('RSN must be between 1 and 12 characters');
    }
}

export async function sendDMToGuildOwner(guild: Guild, data: string | MessageCreateOptions) {
    const owner = await guild.fetchOwner();
    // Implicitly creates a DM channel with the owner
    await owner.send(data);
}

export function getBotPermissionsInChannel(channel: TextChannel): PermissionsBitField {
    const guild = channel.guild;
    const botMember = guild.members.me;

    // If the bot member somehow doesn't exist, throw an explicit exception
    if (!botMember) {
        throw new Error(`Bot does not have valid membership in guild \`${guild.id}\``);
    }

    return channel.permissionsFor(botMember);
}

/**
 * Checks if the bot has basic required permissions in the given channel.
 * Currently, just check for view channel and send messages permissions.
 *
 * @param channel text channel to check bot permissions for
 * @returns true if the bot has permissions in the given channel
 * @throws an error if the bot is somehow not a member of this guild
 */
export function botHasRequiredPermissionsInChannel(channel: TextChannel): boolean {
    const botPermissions = getBotPermissionsInChannel(channel);

    // TODO: How we can improve this...
    // A more robust solution would probably be to get default bot permissions (sans overwrites) and
    // compare them to the resolved permissions in the specific channel. If the permission bits are
    // at all different, then reject the command (since this will result in only partial functionality).
    // For now, checking that it can see the channel and send messages in it will cover 99% of cases.

    // Return true if the bot has all the required permissions
    return REQUIRED_PERMISSIONS.every(flag => botPermissions.has(flag));
}

/**
 * Returns a list of permission names corresponding to required permissions that the bot is missing in the given channel.
 *
 * @param channel text channel to check bot permissions for
 * @returns list of permission names (empty if the bot has all required permissions)
 */
export function getMissingRequiredChannelPermissionNames(channel: TextChannel): string[] {
    const botPermissions = getBotPermissionsInChannel(channel);

    // Return the name of each missing permission
    return REQUIRED_PERMISSION_NAMES.filter(n => !botPermissions.has(PermissionFlagsBits[n]));
}

export function getGuildWarningEmbeds(guildId: Snowflake | null): APIEmbed[] {
    if (!guildId) {
        return [];
    }
    const embeds: APIEmbed[] = [];
    // First, warn if there's no tracking channel set
    const numTrackedPlayers = state.getNumTrackedPlayers(guildId);
    if (numTrackedPlayers > 0) {
        if (state.hasTrackingChannel(guildId)) {
            const trackingChannel = state.getTrackingChannel(guildId);
            // Validate the bot's permissions in this channel
            if (!botHasRequiredPermissionsInChannel(trackingChannel)) {
                const missingPermissionNames = getMissingRequiredChannelPermissionNames(trackingChannel);
                const joinedPermissions = naturalJoin(missingPermissionNames, { bold: true });
                embeds.push(createWarningEmbed(`Missing required permissions to send player update messages to tracking channel ${trackingChannel}. I need these permissions: ${joinedPermissions}`));
            }
        } else {
            embeds.push(createWarningEmbed('No channel has been selected to receive player update messages. Please select a channel using the **/channel** command.'));
        }
    }

    return embeds;
}

export function createWarningEmbed(text: string): APIEmbed {
    return {
        description: text,
        thumbnail: {
            url: 'https://oldschool.runescape.wiki/images/Dungeon_icon.png'
        },
        color: RED_EMBED_COLOR
    };
}

/**
 * Generates an "action row" as a list of message components.
 * @param inviteText Text to show on the server invite button
 * @returns Action row component list
 */
export function getHelpComponents(inviteText: string): ActionRowData<MessageActionRowComponentData>[] {
    return [{
        type: ComponentType.ActionRow,
        components: [{
            type: ComponentType.Button,
            style: ButtonStyle.Link,
            label: inviteText,
            url: CONFIG.supportInviteUrl
        }]
    }];
}

export async function fetchDisplayName(rsn: string): Promise<string> {
    return getRSNFormat(rsn, DEFAULT_AXIOS_CONFIG);
}

export function readDir(dir: string): string[] {
    return fs.readdirSync(dir);
}