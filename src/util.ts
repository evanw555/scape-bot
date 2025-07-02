import { Boss, BOSSES, INVALID_FORMAT_ERROR, FORMATTED_BOSS_NAMES, getRSNFormat, HISCORES_ERROR } from 'osrs-json-hiscores';
import fs from 'fs';
import { APIEmbed, ActionRowData, BaseMessageOptions, ButtonStyle, ChatInputCommandInteraction, ComponentType, MessageActionRowComponentData, MessageCreateOptions, PermissionFlagsBits, PermissionsBitField, Snowflake, TextBasedChannel, TextChannel } from 'discord.js';
import { addReactsSync, DiscordTimestampFormat, filterMap, getPercentChangeString, getQuantityWithUnits, groupByProperty, MultiLoggerLevel, naturalJoin, randChoice, toDiscordTimestamp } from 'evanw555.js';
import { IndividualClueType, IndividualSkillName, IndividualActivityName, PlayerHiScores, NegativeDiffError, CommandsType, SlashCommand, DailyAnalyticsLabel, PendingPlayerUpdate, PlayerUpdateType, PlayerUpdateKey, GuildSetting } from './types';
import { fetchHiScores, isPlayerNotFoundError } from './hiscores';
import { AUTH, CONSTANTS, BOSS_EMBED_COLOR, CLUES_NO_ALL, CLUE_EMBED_COLOR, COMPLETE_VERB_BOSSES, DEFAULT_BOSS_SCORE, DEFAULT_CLUE_SCORE, DEFAULT_SKILL_LEVEL, DOPE_COMPLETE_VERBS, DOPE_KILL_VERBS, GRAY_EMBED_COLOR, RED_EMBED_COLOR, SKILLS_NO_OVERALL, SKILL_EMBED_COLOR, YELLOW_EMBED_COLOR, REQUIRED_PERMISSIONS, REQUIRED_PERMISSION_NAMES, CONFIG, DEFAULT_AXIOS_CONFIG, OTHER_ACTIVITIES, DEFAULT_ACTIVITY_SCORE, ACTIVITY_EMBED_COLOR, OTHER_ACTIVITIES_MAP } from './constants';

import state from './instances/state';
import logger from './instances/logger';
import pgStorageClient from './instances/pg-storage-client';
import timeSlotInstance from './instances/timeslot';
import timer from './instances/timer';

const validSkills: Set<string> = new Set(CONSTANTS.skills);
const validClues: Set<string> = new Set(CLUES_NO_ALL);
const validMiscThumbnails: Set<string> = new Set(CONSTANTS.miscThumbnails);

// Volatile structure to track negative diff strikes
const negativeDiffStrikes: Record<string, number> = {};

// Volatile structure for pausing display name queries to avoid getting stuck in a rate-limiting loop
let pauseDisplayNameQueries = false;

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

export function getRankingIconUrl(setId: string, rank: number | 'preview'): string {
    return `${CONSTANTS.baseThumbnailUrl}rankings/${setId}/${rank}${CONSTANTS.imageFileExtension}`;
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

interface SendUpdateMessageOptions {
    // Emojis to add to the sent message(s) as reacts
    reacts?: string[]
}

export function buildUpdateEmbed(text: string, name: string, options?: UpdateMessageOptions) {
    return {
        description: text,
        thumbnail: getThumbnail(name, options),
        color: options?.color ?? SKILL_EMBED_COLOR,
        title: options?.title,
        url: options?.url
    };
}

export function buildUpdateMessage(text: string, name: string, options?: UpdateMessageOptions) {
    return {
        content: options?.header,
        embeds: [buildUpdateEmbed(text, name, options), ...(options?.extraEmbeds ?? [])]
    };
}

export async function sendUpdateMessageRaw(channels: TextBasedChannel[], payload: MessageCreateOptions, options?: SendUpdateMessageOptions) {
    for (const channel of channels) {
        try {
            const message = await channel.send(payload);
            // If any reacts are specified, add them
            if (options?.reacts) {
                try {
                    await addReactsSync(message, options.reacts);
                } catch (err) {
                    // Reacts aren't as important, so treat them as a minor failure
                    await logger.log(`Unable to add reacts to message: \`${err}\``, MultiLoggerLevel.Debug);
                }
            }
        } catch (err) {
            // Mark this channel as problematic for later auditing
            if (channel instanceof TextChannel) {
                state.addProblematicTrackingChannel(channel);
            }
            // Log info about this failure
            let errorMessage = `Unable to send update message \`${payload.content?.slice(0, 100) ?? ''}${payload.embeds?.map(e => JSON.stringify(e)).join(',') ?? ''}\` to channel`;
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

export async function sendUpdateMessage(channels: TextBasedChannel[], text: string, name: string, options?: SendUpdateMessageOptions & UpdateMessageOptions): Promise<void> {
    const updateMessage = buildUpdateMessage(text, name, options);
    await sendUpdateMessageRaw(channels, updateMessage, options);
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
export function computeDiff<T extends string>(before: Partial<Record<T, number>>, after: Partial<Record<T, number>>, baselineValue: number): Partial<Record<T, number>> {
    // Validate that before's keys are a subset of after's
    if (!Object.keys(before).every(key => key in after)) {
        throw new Error(`Cannot compute diff, before ${Object.keys(before).join(',')} is not a subset of after ${Object.keys(after).join(',')}`);
    }

    // For each key, add the diff to the overall diff mapping
    const diff: Partial<Record<T, number>> = {};
    const kinds: T[] = Object.keys(after) as T[];
    for (const kind of kinds) {
        const beforeValue: number = before[kind] ?? baselineValue;
        const afterValue: number = after[kind] as number;
        // Validate value types (e.g. strange subtraction behavior if a string is passed in)
        if (typeof beforeValue !== 'number' || typeof afterValue !== 'number') {
            throw new Error(`Invalid types for **${kind}** diff, before \`${beforeValue}\` is type ${typeof beforeValue} and after \`${typeof afterValue}\` is type ${typeof afterValue}`);
        }
        // If there's been a change in this value, compute and add to diff map
        if (beforeValue !== afterValue) {
            // TODO: the default isn't necessarily 0, it could be 1 for skills (but does that really matter?)
            const thisDiff = afterValue - beforeValue;
            // Fail silently if the negative diff is because the user has fallen off the hi scores
            if (thisDiff < 0 && afterValue === 1) {
                throw new Error('');
            }
            // If there's an otherwise negative diff, throw a special error (that should result in a rollback)
            if (thisDiff < 0) {
                throw new NegativeDiffError(`Negative **${kind}** diff: \`${afterValue} - ${beforeValue} = ${thisDiff}\``);
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
        } else if (isPlayerNotFoundError(err)) {
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
            // TODO: Re-enable this logic once osrs-json-hiscores returns a more nuanced error message?
            // if (options?.primer || state.getTimeSincePlayerLastActive(rsn) < INACTIVE_THRESHOLD_MILLIES) {
            //     // TODO: Can we make this less hacky? We just want to archive them while also keeping a timestamp for them (so we can purge them later...)
            //     const archiveTimestamp = new Date(new Date().getTime() - INACTIVE_THRESHOLD_MILLIES);
            //     await pgStorageClient.updatePlayerActivityTimestamp(rsn, archiveTimestamp);
            //     state.markPlayerAsActive(rsn, archiveTimestamp);
            //     // TODO: Temp logging to see how this is playing out
            //     await logger.log(`Archive player **${state.getDisplayName(rsn)}** due to update 404`, MultiLoggerLevel.Debug);

            // }
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
    let processPendingUpdates = false;

    // Check if levels have changed and send notifications
    if (state.hasLevels(rsn)) {
        const a = await updateLevels(rsn, data.levelsWithDefaults, options?.spoofedDiff);
        activity = activity || a;
        processPendingUpdates = processPendingUpdates || a;
    } else {
        // If this player has no levels in the state, prime with initial data (NOT including assumed defaults)
        state.setLevels(rsn, data.levels);
        await pgStorageClient.writePlayerLevels(rsn, data.levels);
        state.setLastRefresh(rsn, new Date());
        await pgStorageClient.updatePlayerRefreshTimestamp(rsn, new Date());
    }

    // Check if bosses have changed and send notifications
    if (state.hasBosses(rsn)) {
        const a = await updateKillCounts(rsn, data.bossesWithDefaults, options?.spoofedDiff);
        activity = activity || a;
        processPendingUpdates = processPendingUpdates || a;
    } else {
        // If this player has no bosses in the state, prime with initial data (NOT including assumed defaults)
        state.setBosses(rsn, data.bosses);
        await pgStorageClient.writePlayerBosses(rsn, data.bosses);
        state.setLastRefresh(rsn, new Date());
        await pgStorageClient.updatePlayerRefreshTimestamp(rsn, new Date());
    }

    // Check if clues have changed and send notifications
    if (state.hasClues(rsn)) {
        const a = await updateClues(rsn, data.cluesWithDefaults, options?.spoofedDiff);
        activity = activity || a;
        processPendingUpdates = processPendingUpdates || a;
    } else {
        // If this player has no clues in the state, prime with initial data (NOT including assumed defaults)
        state.setClues(rsn, data.clues);
        await pgStorageClient.writePlayerClues(rsn, data.clues);
        state.setLastRefresh(rsn, new Date());
        await pgStorageClient.updatePlayerRefreshTimestamp(rsn, new Date());
    }

    // Check if other activities have changed and send notifications
    if (state.hasActivities(rsn)) {
        const a = await updateActivities(rsn, data.activitiesWithDefaults, options?.spoofedDiff);
        activity = activity || a;
        processPendingUpdates = processPendingUpdates || a;
    } else {
        // If this player has no activities in the state, prime with initial data (NOT including assumed defaults)
        state.setActivities(rsn, data.activities);
        await pgStorageClient.writePlayerActivities(rsn, data.activities);
        state.setLastRefresh(rsn, new Date());
        await pgStorageClient.updatePlayerRefreshTimestamp(rsn, new Date());
    }

    // Check if virtual levels have changed and send notifications
    if (state.hasVirtualLevels(rsn)) {
        // TODO: Do we need to count this as "activity"? Total XP should already cover this
        await updateVirtualLevels(rsn, data.virtualLevels);
    } else {
        // If this player has no virtual levels in the state, prime them with initial data (only including levels above 99)
        state.setVirtualLevels(rsn, data.virtualLevels);
        await pgStorageClient.writePlayerVirtualLevels(rsn, data.virtualLevels);
    }

    // If the player has a valid total XP value, process it
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
        // Populate this player's weekly XP snapshot in PG in case it's missing (e.g. for new players)
        const wasSnapshotMissing = await pgStorageClient.writeWeeklyXpSnapshotIfMissing(rsn, data.totalXp);
        if (wasSnapshotMissing) {
            await logger.log(`Populated missing weekly XP snapshot (**${getQuantityWithUnits(data.totalXp)}**) for **${state.getDisplayName(rsn)}**`, MultiLoggerLevel.Warn);
            // TODO: Temp logic to ensure the weekly XP snapshot has an accurate corresponding timestamp
            await pgStorageClient.writeWeeklyXpSnapshotTimestampIfMissing(rsn, new Date());
        }
    }

    // If the player saw any sort of activity (or if we're priming a new player's data)
    if (activity || options?.primer) {
        // Mark the player as active
        state.markPlayerAsActive(rsn);
        await pgStorageClient.updatePlayerActivityTimestamp(rsn);
    }

    // If the player has enough negative diff strikes, run the rollback procedure on them
    if (negativeDiffStrikes[rsn] >= 20) {
        await rollBackPlayerStats(rsn, data);
        delete negativeDiffStrikes[rsn];
    }

    // If the player saw any valid activity, clear their diff strikes
    if (activity) {
        delete negativeDiffStrikes[rsn];
    }

    // TODO: Temp logic for time slot activity analysis
    if (activity) {
        timeSlotInstance.incrementPlayer(rsn);
    }

    // Prototype logic for processing pending player updates
    if (processPendingUpdates) {
        // Increment player updates counter
        timer.incrementPlayerUpdates();
        // Fetch all pending updates for this player
        const allUpdates = await pgStorageClient.fetchPendingPlayerUpdates(rsn);
        // Group each update by guild ID
        const updatesByGuild = groupByProperty(allUpdates, 'guildId');
        for (const [guildId, updates] of Object.entries(updatesByGuild)) {
            // If this guild isn't actually tracking this player, delete the update and continue
            if (!state.isTrackingPlayer(guildId, rsn)) {
                for (const update of updates) {
                    await pgStorageClient.deletePendingPlayerUpdate(update);
                }
                // TODO: Temp logging to see how this is working
                await logger.log(`Deleted **${updates.length}** pending update(s) for player **${state.getDisplayName(rsn)}** not tracked by guild \`${guildId}\``, MultiLoggerLevel.Warn);
                continue;
            }
            // If the guild has no tracking channel, save the pending update for once it's set
            if (!state.hasTrackingChannel(guildId)) {
                continue;
            }
            const trackingChannel = state.getTrackingChannel(guildId);
            // This should theoretically never be empty, but check just to be safe
            if (updates.length > 0) {
                // Filter all pending updates using the guild's rules
                const updatesToSend = filterUpdatesForGuild(updates);
                if (updatesToSend.length > 0) {
                    // Construct messages for the filtered updates and send them out
                    await sendPlayerUpdates(trackingChannel, updatesToSend);
                    // Delete all the updates
                    // TODO: Can we batch this?
                    // TODO: Can we only delete updates that are actually sent out?
                    for (const update of updatesToSend) {
                        await pgStorageClient.deletePendingPlayerUpdate(update);
                    }
                    await logger.log(`Sent **${updatesToSend.length}** update(s) for **${state.getDisplayName(rsn)}** (**${updates.length}** in PG)`, MultiLoggerLevel.Debug);
                }
            }
        }
    }
}

/**
 * Given a list of pending player updates, filter it by applying a guild's config rules to it.
 * @param updates The unfiltered list of pending player updates
 * @returns The filtered list of pending player updates
 */
export function filterUpdatesForGuild(updates: PendingPlayerUpdate[]): PendingPlayerUpdate[] {
    if (updates.length === 0) {
        return [];
    }
    // Validate that these are all for the same guild
    const guildId = updates[0].guildId;
    if (updates.some(u => u.guildId !== guildId)) {
        throw new Error('Cannot filter updates for multiple guilds using one guild\'s rules');
    }
    // TODO: Actually read from a guild's settings once that's set up
    const SKILL_INTERVAL_FIVE_THRESHOLD = state.getGuildSettingWithDefault(guildId, GuildSetting.SkillBroadcastFiveThreshold);
    const SKILL_INTERVAL_ONE_THRESHOLD = state.getGuildSettingWithDefault(guildId, GuildSetting.SkillBroadcastOneThreshold);
    const BOSS_INTERVAL = state.getGuildSettingWithDefault(guildId, GuildSetting.BossBroadcastInterval);
    const CLUE_INTERVAL = state.getGuildSettingWithDefault(guildId, GuildSetting.ClueBroadcastInterval);
    const ACTIVITY_INTERVAL = state.getGuildSettingWithDefault(guildId, GuildSetting.MinigameBroadcastInterval);
    // Filter by applying mock rules
    return updates.filter(u => {
        switch (u.type) {
        case PlayerUpdateType.Skill: {
            // Skill updates are disabled if the 1-threshold is zero
            if (SKILL_INTERVAL_ONE_THRESHOLD === 0) {
                return false;
            }
            // If the value is above the 1-threshold, test against 1
            if (u.newValue >= SKILL_INTERVAL_ONE_THRESHOLD) {
                return diffPassesMilestone(u.baseValue, u.newValue, 1);
            }
            // If the 5-threshold is zero, then nothing below the 1-threshold should be reported
            if (SKILL_INTERVAL_FIVE_THRESHOLD === 0) {
                return false;
            }
            // If the value is against the 5-threshold, test against 5
            if (u.newValue >= SKILL_INTERVAL_FIVE_THRESHOLD) {
                return diffPassesMilestone(u.baseValue, u.newValue, 5);
            }
            // Otherwise, test against 10
            return diffPassesMilestone(u.baseValue, u.newValue, 10);
        }
        case PlayerUpdateType.Boss: {
            if (BOSS_INTERVAL === 0) {
                return false;
            }
            return diffPassesMilestone(u.baseValue, u.newValue, BOSS_INTERVAL);
        }
        case PlayerUpdateType.Clue: {
            if (CLUE_INTERVAL === 0) {
                return false;
            }
            return diffPassesMilestone(u.baseValue, u.newValue, CLUE_INTERVAL);
        }
        case PlayerUpdateType.Activity: {
            if (BOSS_INTERVAL === 0) {
                return false;
            }
            return diffPassesMilestone(u.baseValue, u.newValue, ACTIVITY_INTERVAL);
        }
        }
    });
}

/**
 * Given some update's "before" score and "after" score, determine if the diff passes a milestone.
 * This is the generic filtering function used to determine is one particular update should be sent out.
 * @param a The "before" score
 * @param b The "after" score
 * @param interval The score diff threshold
 * @returns True if the provided diff passes a milestone using the given interval
 */
export function diffPassesMilestone(a: number, b: number, interval: number): boolean {
    // If the interval is zero, it should never pass
    if (interval === 0) {
        return false;
    }
    // If the diff is at least the interval, it MUST pass a milestone
    if (b - a >= interval) {
        return true;
    }
    // Otherwise, it passes if the new value is greater yet its mod is lower
    return b > a && ((b % interval) < (a % interval));
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
        if (err instanceof NegativeDiffError) {
            negativeDiffStrikes[rsn] = (negativeDiffStrikes[rsn] ?? 0) + 1;
        } else if (err instanceof Error && err.message) {
            await logger.log(`Failed to compute level diff for player ${rsn}: ${err.message}`, MultiLoggerLevel.Error);
        }
        return false;
    }
    if (!diff) {
        return false;
    }

    const updatedSkills: IndividualSkillName[] = toSortedSkillsNoOverall(Object.keys(diff));

    if (updatedSkills.length > 0) {
        for (const guildId of state.getGuildsTrackingPlayer(rsn)) {
            // Construct the pending player updates
            const updates: PendingPlayerUpdate[] = updatedSkills.map(skill => ({
                guildId,
                rsn,
                type: PlayerUpdateType.Skill,
                key: skill,
                baseValue: state.hasLevel(rsn, skill) ? state.getLevel(rsn, skill) : DEFAULT_SKILL_LEVEL,
                newValue: newLevels[skill]
            }));

            // Store pending player updates to PG
            await pgStorageClient.writePendingPlayerUpdates(updates);
            // await testingChannel.send(`Wrote **${updates.length}** pending **skill** update row(s) for **${state.getDisplayName(rsn)}**`);
        }
    }

    // If not spoofing the diff, update player's levels
    if (!spoofedDiff) {
        // Write only updated skills to PG
        await pgStorageClient.writePlayerLevels(rsn, filterMap(newLevels, { keyWhitelist: updatedSkills }));
        state.setLevels(rsn, newLevels);
        state.setLastRefresh(rsn, new Date());
        await pgStorageClient.updatePlayerRefreshTimestamp(rsn, new Date());
        if (updatedSkills.length > 0) {
            await logger.log(`**${rsn}** update: \`${JSON.stringify(diff)}\``, MultiLoggerLevel.Debug);
            return true;
        }
    }
    return false;
}

export function constructSkill99UpdateMessage(update: PendingPlayerUpdate): MessageCreateOptions {
    const { guildId, rsn, key: skill, baseValue, newValue } = update;
    const levelsGained = newValue - baseValue;
    return buildUpdateMessage(
        `**${state.getDisplayName(rsn)}** has gained `
            + (levelsGained === 1 ? 'a level' : `**${levelsGained}** levels`)
            + ` in **${skill}** and is now level **99**`,
        skill, {
            // Tag @everyone only if the guild has opted in to it
            header: state.isGuildSettingEnabled(guildId, GuildSetting.TagEveryoneOnSkill99) ? '@everyone' : undefined,
            is99: true
        });
}

export function constructSkillUpdateEmbeds(updates: PendingPlayerUpdate[]): APIEmbed[] {
    // Send a message showing all the levels gained for all non-99 skills
    switch (updates.length) {
    case 0: {
        return [];
    }
    case 1: {
        const { rsn, key: skill, baseValue, newValue } = updates[0];
        const levelsGained = newValue - baseValue;
        // Show quotes around the word "level" if it's a virtual level above 99
        const quote = newValue > 99 ? '"' : '';
        const text = `**${state.getDisplayName(rsn)}** has gained `
            + (levelsGained === 1 ? `a ${quote}level${quote}` : `**${levelsGained}** ${quote}levels${quote}`)
            + ` in **${skill}** and is now level **${newValue}**`;
        return [buildUpdateEmbed(text, skill)];
        // await sendUpdateMessage(state.getTrackingChannelsForPlayer(rsn), text, skill);
    }
    default: {
        const text = updates.map((u) => {
            const { key: skill, baseValue, newValue } = u;
            const levelsGained = newValue - baseValue;
            // Show quotes around the word "level" if it's a virtual level above 99
            const quote = newValue > 99 ? '"' : '';
            return `${levelsGained === 1 ? `a ${quote}level${quote}` : `**${levelsGained}** ${quote}levels${quote}`} in **${skill}** and is now level **${newValue}**`;
        }).join('\n');
        const { rsn } = updates[0];
        return [buildUpdateEmbed(`**${state.getDisplayName(rsn)}** has gained...\n${text}`, 'overall')];
        // await sendUpdateMessage(state.getTrackingChannelsForPlayer(rsn), `**${state.getDisplayName(rsn)}** has gained...\n${text}`, 'overall');
    }
    }
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
        if (err instanceof NegativeDiffError) {
            negativeDiffStrikes[rsn] = (negativeDiffStrikes[rsn] ?? 0) + 1;
        } else if (err instanceof Error && err.message) {
            await logger.log(`Failed to compute boss KC diff for player ${rsn}: ${err.message}`, MultiLoggerLevel.Error);
        }
        return false;
    }
    if (!diff) {
        return false;
    }

    const updatedBosses: Boss[] = Object.keys(diff) as Boss[];

    if (updatedBosses.length > 0) {
        for (const guildId of state.getGuildsTrackingPlayer(rsn)) {
            // Construct the pending player updates
            const updates: PendingPlayerUpdate[] = updatedBosses.map(boss => ({
                guildId,
                rsn,
                type: PlayerUpdateType.Boss,
                key: boss,
                baseValue: state.hasBoss(rsn, boss) ? state.getBoss(rsn, boss) : DEFAULT_BOSS_SCORE,
                newValue: newScores[boss]
            }));

            // Store pending player updates to PG
            await pgStorageClient.writePendingPlayerUpdates(updates);
            // await testingChannel.send(`Wrote **${updates.length}** pending **boss** update row(s) for **${state.getDisplayName(rsn)}**`);
        }
    }

    // If not spoofing the diff, update player's boss scores
    if (!spoofedDiff) {
        // Write only updated bosses to PG
        await pgStorageClient.writePlayerBosses(rsn, filterMap(newScores, { keyWhitelist: updatedBosses }));
        state.setBosses(rsn, newScores);
        state.setLastRefresh(rsn, new Date());
        await pgStorageClient.updatePlayerRefreshTimestamp(rsn, new Date());
        if (updatedBosses.length > 0) {
            await logger.log(`**${rsn}** update: \`${JSON.stringify(diff)}\``, MultiLoggerLevel.Debug);
            return true;
        }
    }
    return false;
}

export function constructBossUpdateEmbeds(updates: PendingPlayerUpdate[]): APIEmbed[] {
    // Send a message showing all the incremented boss scores
    // Only use a kill verb if all the updated bosses are "killable" bosses, else use a complete verb
    const verb: string = updates.some(u => COMPLETE_VERB_BOSSES.has(u.key as Boss)) ? randChoice(...DOPE_COMPLETE_VERBS) : randChoice(...DOPE_KILL_VERBS);
    switch (updates.length) {
    case 0: {
        return [];
    }
    case 1: {
        const { rsn, key: boss, baseValue, newValue } = updates[0];
        const scoreIncrease = newValue - baseValue;
        const bossName = getBossName(boss as Boss);
        // Note that this will be funky if the KC is 1, but currently the hiscores don't report KCs until >1
        const text = newValue === scoreIncrease
            ? `**${state.getDisplayName(rsn)}** ${verb} **${bossName}** for the first **${scoreIncrease}** times!`
            : `**${state.getDisplayName(rsn)}** ${verb} **${bossName}** `
                    + (scoreIncrease === 1 ? 'again' : `**${scoreIncrease}** more times`)
                    + ` for a total of **${newValue}**`;
        return [buildUpdateEmbed(text, boss, { color: BOSS_EMBED_COLOR })];
        // await sendUpdateMessage(state.getTrackingChannelsForPlayer(rsn), text, boss, { color: BOSS_EMBED_COLOR });
    }
    default: {
        const text = updates.map((u) => {
            const { key: boss, baseValue, newValue } = u;
            const scoreIncrease = newValue - baseValue;
            const bossName = getBossName(boss as Boss);
            // Note that this will be funky if the KC is 1, but currently the hiscores don't report KCs until >1
            return newValue === scoreIncrease
                ? `**${bossName}** for the first **${scoreIncrease}** times!`
                : `**${bossName}** ${scoreIncrease === 1 ? 'again' : `**${scoreIncrease}** more times`} for a total of **${newValue}**`;
        }).join('\n');
        const { rsn, key: firstBoss } = updates[0];
        return [buildUpdateEmbed(
            `**${state.getDisplayName(rsn)}** ${verb}...\n${text}`,
            // Show the first boss in the list as the icon
            firstBoss,
            { color: BOSS_EMBED_COLOR }
        )];
        // await sendUpdateMessage(
        //     state.getTrackingChannelsForPlayer(rsn),
        //     `**${state.getDisplayName(rsn)}** ${verb}...\n${text}`,
        //     // Show the first boss in the list as the icon
        //     updatedBosses[0],
        //     { color: BOSS_EMBED_COLOR }
        // );
    }
    }
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
        if (err instanceof NegativeDiffError) {
            negativeDiffStrikes[rsn] = (negativeDiffStrikes[rsn] ?? 0) + 1;
        } else if (err instanceof Error && err.message) {
            await logger.log(`Failed to compute clue score diff for player ${rsn}: ${err.message}`, MultiLoggerLevel.Error);
        }
        return false;
    }
    if (!diff) {
        return false;
    }

    const updatedClues: IndividualClueType[] = toSortedCluesNoAll(Object.keys(diff));

    if (updatedClues.length > 0) {
        for (const guildId of state.getGuildsTrackingPlayer(rsn)) {
            // Construct the pending player updates
            const updates: PendingPlayerUpdate[] = updatedClues.map(clue => ({
                guildId,
                rsn,
                type: PlayerUpdateType.Clue,
                key: clue,
                baseValue: state.hasClue(rsn, clue) ? state.getClue(rsn, clue) : DEFAULT_CLUE_SCORE,
                newValue: newScores[clue]
            }));

            // Store pending player updates to PG
            await pgStorageClient.writePendingPlayerUpdates(updates);
            // await testingChannel.send(`Wrote **${updates.length}** pending **clue** update row(s) for **${state.getDisplayName(rsn)}**`);
        }
    }

    // If not spoofing the diff, update player's clue scores
    if (!spoofedDiff) {
        // Write only updated clues to PG
        await pgStorageClient.writePlayerClues(rsn, filterMap(newScores, { keyWhitelist: updatedClues }));
        state.setClues(rsn, newScores);
        state.setLastRefresh(rsn, new Date());
        await pgStorageClient.updatePlayerRefreshTimestamp(rsn, new Date());
        if (updatedClues.length > 0) {
            await logger.log(`**${rsn}** update: \`${JSON.stringify(diff)}\``, MultiLoggerLevel.Debug);
            return true;
        }
    }
    return false;
}

export function constructClueUpdateEmbeds(updates: PendingPlayerUpdate[]): APIEmbed[] {
    // Send a message showing the updated clues
    const getClueCompletionPhrase = (_clue: PlayerUpdateKey, _scoreGained: number, _newScore: number): string => {
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
    switch (updates.length) {
    case 0: {
        return [];
    }
    case 1: {
        const { rsn, key: clue, baseValue, newValue } = updates[0];
        const scoreGained = newValue - baseValue;
        const text = `**${state.getDisplayName(rsn)}** has completed ${getClueCompletionPhrase(clue, scoreGained, newValue)}`;
        return [buildUpdateEmbed(text, clue, { color: CLUE_EMBED_COLOR })];
        // await sendUpdateMessage(state.getTrackingChannelsForPlayer(rsn), text, clue, { color: CLUE_EMBED_COLOR });
    }
    default: {
        const text = updates.map((u) => {
            const { key: clue, baseValue, newValue } = u;
            const scoreGained = newValue - baseValue;
            return getClueCompletionPhrase(clue, scoreGained, newValue);
        }).join('\n');
        const { rsn, key: lastClue } = updates[updates.length - 1];
        return [buildUpdateEmbed(`**${state.getDisplayName(rsn)}** has completed...\n${text}`,
            // Show the highest level clue as the icon
            lastClue,
            { color: CLUE_EMBED_COLOR })];
        // await sendUpdateMessage(state.getTrackingChannelsForPlayer(rsn),
        //     `**${state.getDisplayName(rsn)}** has completed...\n${text}`,
        //     // Show the highest level clue as the icon
        //     updatedClues[updatedClues.length - 1],
        //     { color: CLUE_EMBED_COLOR });
    }
    }
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
        if (err instanceof NegativeDiffError) {
            negativeDiffStrikes[rsn] = (negativeDiffStrikes[rsn] ?? 0) + 1;
        } else if (err instanceof Error && err.message) {
            await logger.log(`Failed to compute activity score diff for player ${rsn}: ${err.message}`, MultiLoggerLevel.Error);
        }
        return false;
    }
    if (!diff) {
        return false;
    }

    const updatedActivities: IndividualActivityName[] = Object.keys(diff) as IndividualActivityName[];

    if (updatedActivities.length > 0) {
        for (const guildId of state.getGuildsTrackingPlayer(rsn)) {
            // Construct the pending player updates
            const updates: PendingPlayerUpdate[] = updatedActivities.map(activity => ({
                guildId,
                rsn,
                type: PlayerUpdateType.Activity,
                key: activity,
                baseValue: state.hasActivity(rsn, activity) ? state.getActivity(rsn, activity) : DEFAULT_ACTIVITY_SCORE,
                newValue: newScores[activity]
            }));

            // Store pending player updates to PG
            await pgStorageClient.writePendingPlayerUpdates(updates);
            // await testingChannel.send(`Wrote **${updates.length}** pending **activity** update row(s) for **${state.getDisplayName(rsn)}**`);
        }
    }

    // If not spoofing the diff, update player's activities
    if (!spoofedDiff) {
        // Write only updated activities to PG
        await pgStorageClient.writePlayerActivities(rsn, filterMap(newScores, { keyWhitelist: updatedActivities }));
        state.setActivities(rsn, newScores);
        state.setLastRefresh(rsn, new Date());
        await pgStorageClient.updatePlayerRefreshTimestamp(rsn, new Date());
        if (updatedActivities.length > 0) {
            await logger.log(`**${rsn}** update: \`${JSON.stringify(diff)}\``, MultiLoggerLevel.Debug);
            return true;
        }
    }
    return false;
}

export function constructActivitiesUpdateEmbeds(updates: PendingPlayerUpdate[]): APIEmbed[] {
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
        return quantityText + ` ${_activity} for a total of **${_newScore}**`;
    };
    const getActivityPhrase = (_activity: string, _scoreGained: number, _newScore: number): string => {
        switch (_activity) {
        case 'leaguePoints':
            return `has earned ${getActivityCompletionPhrase(`**${getActivityName(_activity)}**`, _scoreGained, _newScore)}`;
        case 'lastManStanding':
            return `has a score of **${_newScore}** in **Last Man Standing**`;
        case 'pvpArena':
            return `has a score of **${_newScore}** in the **PvP Arena**`;
        case 'soulWarsZeal':
            return `has earned ${getActivityCompletionPhrase(`**${getActivityName(_activity)}**`, _scoreGained, _newScore)}`;
        case 'riftsClosed':
            return `closed another ${_scoreGained === 1 ? '' : `**${_scoreGained}** `}**${_scoreGained === 1 ? 'rift' : 'rifts'}** for a total of **${_newScore}**`;
        case 'colosseumGlory':
            return `has earned ${getActivityCompletionPhrase(`**${getActivityName(_activity)}**`, _scoreGained, _newScore)}`;
        case 'collectionsLogged':
            return `has filled ${getActivityCompletionPhrase('**Collection Log** slot' + (_scoreGained === 1 ? '' : 's'), _scoreGained, _newScore)}`;
        default:
            return 'N/A';
        }
    };
    // TODO: Filter/validate that they're actually activities?
    // const updatedActivities: IndividualActivityName[] = updates.map(u => u.key) as IndividualActivityName[];
    switch (updates.length) {
    case 0: {
        return [];
    }
    case 1: {
        const { rsn, key: activity, baseValue, newValue } = updates[0];
        const scoreGained = newValue - baseValue;
        const text = `**${state.getDisplayName(rsn)}** ${getActivityPhrase(activity, scoreGained, newValue)}`;
        return [buildUpdateEmbed(text, activity, { color: ACTIVITY_EMBED_COLOR })];
        // await sendUpdateMessage(state.getTrackingChannelsForPlayer(rsn), text, activity, { color: ACTIVITY_EMBED_COLOR });
    }
    default: {
        const text = updates.map((u) => {
            const { key: activity, baseValue, newValue } = u;
            const scoreGained = newValue - baseValue;
            return getActivityPhrase(activity, scoreGained, newValue);
        }).join('\n');
        const { rsn, key: firstActivity } = updates[0];
        return [buildUpdateEmbed(`**${state.getDisplayName(rsn)}**...\n${text}`,
            // Show the first activity as the icon
            firstActivity,
            { color: ACTIVITY_EMBED_COLOR })];
        // await sendUpdateMessage(state.getTrackingChannelsForPlayer(rsn),
        //     `**${state.getDisplayName(rsn)}**...\n${text}`,
        //     // Show the first activity as the icon
        //     updatedActivities[0],
        //     { color: ACTIVITY_EMBED_COLOR });
    }
    }
}

export async function updateVirtualLevels(rsn: string, newVirtualLevels: Partial<Record<IndividualSkillName, number>>): Promise<boolean> {
    // We shouldn't be doing this if this player doesn't have any virtual levels in the state
    if (!state.hasVirtualLevels(rsn)) {
        return false;
    }

    // Compute diff for each level
    let diff: Partial<Record<IndividualSkillName, number>>;
    try {
        diff = computeDiff(state.getVirtualLevels(rsn), newVirtualLevels, 99);
    } catch (err) {
        if (err instanceof NegativeDiffError) {
            negativeDiffStrikes[rsn] = (negativeDiffStrikes[rsn] ?? 0) + 1;
        } else if (err instanceof Error && err.message) {
            await logger.log(`Failed to compute virtual level diff for player ${rsn}: ${err.message}`, MultiLoggerLevel.Error);
        }
        return false;
    }
    if (!diff) {
        return false;
    }

    const updatedSkills: IndividualSkillName[] = toSortedSkillsNoOverall(Object.keys(diff));

    if (updatedSkills.length > 0) {
        // Directly send a notification to all guilds tracking this player
        for (const guildId of state.getGuildsTrackingPlayer(rsn)) {
            // Only send if the guild has this setting (and skill updates) enabled
            if (state.isGuildSettingEnabled(guildId, GuildSetting.ShowVirtualSkillUpdates)
                && state.isGuildSettingEnabled(guildId, GuildSetting.SkillBroadcastOneThreshold)
                && state.hasTrackingChannel(guildId)) {
                // Construct the pending player updates
                // TODO: Should we actually save these though? Don't want them to coalesce with normal skill updates, also don't want them to send all at once once enabled
                const updates: PendingPlayerUpdate[] = updatedSkills.map(skill => ({
                    guildId,
                    rsn,
                    type: PlayerUpdateType.Skill,
                    key: skill,
                    baseValue: state.hasVirtualLevel(rsn, skill) ? state.getVirtualLevel(rsn, skill) : 99,
                    // Asserting here that the value exists because all keys in the diff must exist in the new values map
                    newValue: newVirtualLevels[skill] as number
                }));
                // Send the notification directly now (don't save as a pending update, so missed updates will be dropped)
                await sendUpdateMessageRaw([state.getTrackingChannel(guildId)], { embeds: constructSkillUpdateEmbeds(updates) });
            }
        }
        // TODO: Temp logging to see how this is working
        await logger.log(`**${rsn}** virtual update: \`${JSON.stringify(diff)}\``, MultiLoggerLevel.Warn);
        // Set in the state (not to PG... yet)
        state.setVirtualLevels(rsn, newVirtualLevels);
        // Write only updated virtual levels to PG
        await pgStorageClient.writePlayerVirtualLevels(rsn, filterMap(newVirtualLevels, { keyWhitelist: updatedSkills }));

        return true;
    }

    // TODO: Write to PG and handle the actual state stuff here

    return false;
}

export async function sendPlayerUpdates(channel: TextChannel, updates: PendingPlayerUpdate[]) {
    if (updates.length === 0) {
        return;
    }
    // Validate that all updates are for the same guild and RSN
    if (updates.some(u => u.guildId !== updates[0].guildId || u.rsn !== updates[0].rsn)) {
        throw new Error('Tried to send out updates with mixed guilds/RSNs');
    }
    // Construct and send skill updates
    const skillUpdates99 = updates.filter(u => u.type === PlayerUpdateType.Skill && u.newValue === 99);
    for (const u of skillUpdates99) {
        const payload99 = constructSkill99UpdateMessage(u);
        // Only add reacts if the guild is configured to do so
        const reacts = state.isGuildSettingEnabled(u.guildId, GuildSetting.ReactOnSkill99) ? ['🇬', '🇿'] : undefined;
        await sendUpdateMessageRaw([channel], payload99, { reacts });
    }
    // Construct update embeds
    const embeds: APIEmbed[] = [];
    embeds.push(...constructSkillUpdateEmbeds(updates.filter(u => u.type === PlayerUpdateType.Skill && u.newValue !== 99)));
    embeds.push(...constructBossUpdateEmbeds(updates.filter(u => u.type === PlayerUpdateType.Boss)));
    embeds.push(...constructClueUpdateEmbeds(updates.filter(u => u.type === PlayerUpdateType.Clue)));
    embeds.push(...constructActivitiesUpdateEmbeds(updates.filter(u => u.type === PlayerUpdateType.Activity)));
    // If there are any embeds, send the payload
    if (embeds.length > 0) {
        await sendUpdateMessageRaw([channel], { embeds });
    }
}

export async function rollBackPlayerStats(rsn: string, data: PlayerHiScores) {
    const logs: string[] = [];
    // For any negative diff that's detected, roll it back in the state and in PG
    for (const skill of SKILLS_NO_OVERALL) {
        if (state.hasLevel(rsn, skill)) {
            const before = state.getLevel(rsn, skill);
            const after = data.levelsWithDefaults[skill];
            if (after - before < 0) {
                state.setLevel(rsn, skill, after);
                await pgStorageClient.writePlayerLevels(rsn, { [skill]: after });
                logs.push(`**${skill}** ${before} → ${after}`);
            }
        }
    }
    for (const boss of BOSSES) {
        if (state.hasBoss(rsn, boss)) {
            const before = state.getBoss(rsn, boss);
            const after = data.bossesWithDefaults[boss];
            if (after - before < 0) {
                state.setBoss(rsn, boss, after);
                await pgStorageClient.writePlayerBosses(rsn, { [boss]: after });
                logs.push(`**${getBossName(boss)}** ${before} → ${after}`);
            }
        }
    }
    for (const clue of CLUES_NO_ALL) {
        if (state.hasClue(rsn, clue)) {
            const before = state.getClue(rsn, clue);
            const after = data.cluesWithDefaults[clue];
            if (after - before < 0) {
                state.setClue(rsn, clue, after);
                await pgStorageClient.writePlayerClues(rsn, { [clue]: after });
                logs.push(`**${clue}** ${before} → ${after}`);
            }
        }
    }
    for (const activity of OTHER_ACTIVITIES) {
        if (state.hasActivity(rsn, activity)) {
            const before = state.getActivity(rsn, activity);
            const after = data.activitiesWithDefaults[activity];
            if (after - before < 0) {
                state.setActivity(rsn, activity, after);
                await pgStorageClient.writePlayerActivities(rsn, { [activity]: after });
                logs.push(`**${getActivityName(activity)}** ${before} → ${after}`);
            }
        }
    }
    // Send out a notification to all affected servers
    const text = `Rollback detected on hi-scores for **${state.getDisplayName(rsn)}**:\n`
        + logs.join('\n')
        + '\n_(This may just be a temporary issue with the hi-scores)_';
    await sendUpdateMessage(state.getTrackingChannelsForPlayer(rsn), text, 'wrench', { color: GRAY_EMBED_COLOR });
    await logger.log(text, MultiLoggerLevel.Warn);
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
        const n = Object.keys(purgeResults).length;
        if (n > 0) {
            await logger.log(`(\`${label}\`) ${n > 10 ? `**${n}** players` : naturalJoin(globallyUntrackedPlayers, { bold: true })} now globally untracked, `
                + `purged rows: \`${JSON.stringify(purgeResults)}\``, MultiLoggerLevel.Warn);
        }
    }
}

export function getNextFridayEvening(): Date {
    // Get next Friday at 5:20pm (must be after the daily job)
    const nextFriday: Date = new Date();
    nextFriday.setHours(17, 20, 0, 0);
    nextFriday.setHours(nextFriday.getHours() + 24 * ((12 - nextFriday.getDay()) % 7));
    // If this time is in the past, fast-forward to following week
    if (nextFriday.getTime() <= new Date().getTime()) {
        nextFriday.setHours(nextFriday.getHours() + (24 * 7));
    }
    return nextFriday;
}

export function getNextEvening(): Date {
    // Get today at 5:10pm (must be before the weekly job)
    const nextEvening: Date = new Date();
    nextEvening.setHours(17, 10, 0, 0);
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
    let contentString = 'When each tracked player was last refreshed:\n';
    const orderedPlayers: string[] = players.filter(rsn => state.getLastRefresh(rsn) !== undefined)
        .sort((x, y) => (state.getLastRefresh(y)?.getTime() ?? 0) - (state.getLastRefresh(x)?.getTime() ?? 0));
    const datelessPlayers: string[] = players.filter(rsn => !orderedPlayers.includes(rsn));
    if (datelessPlayers.length > 0) {
        contentString += `- (**${datelessPlayers.length}** ${datelessPlayers.length === 1 ? 'player hasn\'t' : 'players haven\'t'} been refreshed yet)\n`;
    }
    for (let i = 0; i < orderedPlayers.length; i++) {
        const rsn = orderedPlayers[i];
        const date = state.getLastRefresh(rsn);
        if (date) {
            const over24HoursAgo = (new Date().getTime() - date.getTime()) > 1000 * 60 * 60 * 24;
            const format: DiscordTimestampFormat = over24HoursAgo ? DiscordTimestampFormat.ShortDateTime : DiscordTimestampFormat.LongTime;
            const line = `- **${state.getDisplayName(rsn)}**: ${toDiscordTimestamp(date, format)}\n`;
            // The cutoff text is based on the remaining players from the previous iteration,
            // so we can just use the index (instead i + 1 to indicate count)
            const cutoffText = `- **plus ${orderedPlayers.length - i} more...**`;
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
    if (pauseDisplayNameQueries) {
        throw new Error('Display name queries on hold due to rate limiting');
    }
    try {
        return await getRSNFormat(rsn, DEFAULT_AXIOS_CONFIG);
    } catch (err) {
        // HiScores not responding, so pause display name queries temporarily
        if ((err instanceof Error) && err.message === HISCORES_ERROR) {
            pauseDisplayNameQueries = true;
            setTimeout(() => {
                pauseDisplayNameQueries = false;
            }, 60_000);
        }
        throw err;
    }
}

export function readDir(dir: string): string[] {
    return fs.readdirSync(dir);
}

/**
 * Constructs the help table text for a given list of commands.
 * @param commands List of commands (slash commands or hidden commands)
 * @param isAdmin If true, the user we're generating help text for is an admin and thus should be able to see admin-privileged commands.
 * @param hasPrivilegedRole If true, the user we're generating help text for has the privileged role in their server.
 * @returns The help text table for this user.
 */
export function getHelpText(commands: CommandsType, isAdmin = false, hasPrivilegedRole = false): string {
    const commandKeys = Object.keys(commands).filter((key) => {
        if (isAdmin) {
            return true;
        }
        const command = commands[key] as SlashCommand;
        if (hasPrivilegedRole) {
            return !command.admin;
        }
        return !command.admin && !command.privilegedRole;
    });
    commandKeys.sort();
    const maxLengthKey = Math.max(...commandKeys.map((key) => {
        return key.length;
    }));
    const innerText = commandKeys
        .map(key => `/${key.padEnd(maxLengthKey)} :: ${commands[key].text}`)
        .join('\n');
    return `\`\`\`asciidoc\n${innerText}\`\`\``;
}

export async function getAnalyticsTrends() {
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);

    const analyticsToday = await pgStorageClient.fetchDailyAnalyticsRows(new Date());
    const numPlayersToday = analyticsToday.filter(row => row.label === DailyAnalyticsLabel.NumPlayers)[0]?.value ?? 0;
    const numGuildsToday = analyticsToday.filter(row => row.label === DailyAnalyticsLabel.NumGuilds)[0]?.value ?? 0;

    const analyticsLastWeek = await pgStorageClient.fetchDailyAnalyticsRows(lastWeek);
    const numPlayersLastWeek = analyticsLastWeek.filter(row => row.label === DailyAnalyticsLabel.NumPlayers)[0]?.value ?? 0;
    const numGuildsLastWeek = analyticsLastWeek.filter(row => row.label === DailyAnalyticsLabel.NumGuilds)[0]?.value ?? 0;

    const analyticsLastMonth = await pgStorageClient.fetchDailyAnalyticsRows(lastMonth);
    const numPlayersLastMonth = analyticsLastMonth.filter(row => row.label === DailyAnalyticsLabel.NumPlayers)[0]?.value ?? 0;
    const numGuildsLastMonth = analyticsLastMonth.filter(row => row.label === DailyAnalyticsLabel.NumGuilds)[0]?.value ?? 0;

    return {
        players: {
            today: numPlayersToday,
            lastWeek: numPlayersLastWeek,
            weeklyDiff: numPlayersToday - numPlayersLastWeek,
            weeklyChange: getPercentChangeString(numPlayersLastWeek, numPlayersToday),
            lastMonth: numPlayersLastMonth,
            monthlyDiff: numPlayersToday - numPlayersLastMonth,
            monthlyChange: getPercentChangeString(numPlayersLastMonth, numPlayersToday)
        },
        guilds: {
            today: numGuildsToday,
            lastWeek: numGuildsLastWeek,
            weeklyDiff: numGuildsToday - numGuildsLastWeek,
            weeklyChange: getPercentChangeString(numGuildsLastWeek, numGuildsToday),
            lastMonth: numGuildsLastMonth,
            monthlyDiff: numGuildsToday - numGuildsLastMonth,
            monthlyChange: getPercentChangeString(numGuildsLastMonth, numGuildsToday)
        }
    };
}

export async function getAnalyticsTrendsEmbeds(): Promise<APIEmbed[]> {
    const trends = await getAnalyticsTrends();
    return [{
        title: 'Num Players',
        description: `__Today__: **${trends.players.today}**\n`
            + `__Last Week__: **${trends.players.lastWeek}** (${trends.players.weeklyChange})\n`
            + `__Last Month__: **${trends.players.lastMonth}** (${trends.players.monthlyChange})`
    }, {
        title: 'Num Guilds',
        description: `__Today__: **${trends.guilds.today}**\n`
        + `__Last Week__: **${trends.guilds.lastWeek}** (${trends.guilds.weeklyChange})\n`
        + `__Last Month__: **${trends.guilds.lastMonth}** (${trends.guilds.monthlyChange})`
    }];
}

// TODO: Delete this and use the function above when we figure out how to send directly to a test channel and not rely on text loggers
export async function getAnalyticsTrendsString(): Promise<string> {
    const trends = await getAnalyticsTrends();
    return '__Num Players__\n'
        + `Today: **${trends.players.today}**\n`
        + `Last Week: **${trends.players.lastWeek}** (${trends.players.weeklyChange})\n`
        + `Last Month: **${trends.players.lastMonth}** (${trends.players.monthlyChange})\n`
        + '__Num Guilds__\n'
        + `Today: **${trends.guilds.today}**\n`
        + `Last Week: **${trends.guilds.lastWeek}** (${trends.guilds.weeklyChange})\n`
        + `Last Month: **${trends.guilds.lastMonth}** (${trends.guilds.monthlyChange})`;
}

export function resolveHiScoresUrlTemplate(): string {
    let gameModeSuffix = '';
    if (AUTH.gameMode && AUTH.gameMode !== 'main') {
        gameModeSuffix = `_${AUTH.gameMode}`;
    }
    return `https://secure.runescape.com/m=hiscore_oldschool${gameModeSuffix}/hiscorepersonal.ws?user1=`;
}

/**
 * For some level (including virtual levels beyond 99), return how much XP is required to achieve that level.
 * This is primarily used for computing virtual levels.
 * @param level Some skill level
 * @returns The XP required to achieve it
 */
export function computeXpForLevel(level: number): number {
    let total = 0;
    for (let i = 1; i < level; i++) {
        total += Math.floor(i + 300 * Math.pow(2, i / 7));
    }
    return Math.floor(0.25 * total);
}

/**
 * For some XP amount, return what level this equates to (including virtual levels beyond 99).
 * This is primarily used for computing virtual levels.
 * @param xp Some amount of XP
 * @returns The level this equates to
 */
export function computeLevelForXp(xp: number): number {
    for (let i = 126; i > 0; i--) {
        if (computeXpForLevel(i) <= xp) {
            return i;
        }
    }
    return 1;
}

/**
 * Construct the root settings menu payload.
 * @returns Root settings menu payload
 */
export function getRootSettingsMenu(): BaseMessageOptions {
    // TODO: Use guild ID to show dynamic payload content?
    return {
        embeds: [{
            title: 'ScapeBot Settings',
            description: '**Skill Settings:**'
                + '\n> Configure skill updates for your guild, such as thresholds for showing every 1/5/10 levels'
                + '\n**Weekly Settings:**'
                + '\n> Configure the weekly XP ranking updates, such as the number of players to show'
                + '\n**Other Settings:**'
                + '\n> Configure other settings, such as how often to show boss and clue updates'
                + '\nUse the `/channel` command to choose where updates are sent, and use the `/role` command to set who can add/remove tracked players.'
        }],
        components: [{
            type: ComponentType.ActionRow,
            components: [{
                type: ComponentType.Button,
                style: ButtonStyle.Secondary,
                label: 'Skill Settings',
                custom_id: 'settings:skills'
            }, {
                type: ComponentType.Button,
                style: ButtonStyle.Secondary,
                label: 'Weekly Settings',
                custom_id: 'settings:weekly'
            }, {
                type: ComponentType.Button,
                style: ButtonStyle.Secondary,
                label: 'Other Settings',
                custom_id: 'settings:other'
            }]
        }]
    };
}
