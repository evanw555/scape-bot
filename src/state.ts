import { APIRole, Role, Snowflake, TextChannel } from 'discord.js';
import { Boss } from 'osrs-json-hiscores';
import { MultiLoggerLevel } from 'evanw555.js';
import { IndividualClueType, IndividualSkillName, IndividualActivityName } from './types';
import { ACTIVE_THRESHOLD_MILLIS, INACTIVE_THRESHOLD_MILLIES } from './constants';
import PlayerQueue from './player-queue';

import logger from './instances/logger';

export default class State {
    private _isValid: boolean;
    private _timestamp?: Date;
    private _disabled?: boolean;
    private readonly _playersOffHiScores: Set<string>;
    private readonly _levels: Record<string, Partial<Record<IndividualSkillName, number>>>;
    private readonly _bosses: Record<string, Partial<Record<Boss, number>>>;
    private readonly _clues: Record<string, Partial<Record<IndividualClueType, number>>>;
    private readonly _activities: Record<string, Partial<Record<IndividualActivityName, number>>>;
    private readonly _botCounters: Record<Snowflake, number>;
    private readonly _lastUpdate: Record<string, Date>;
    private readonly _displayNames: Record<string, string>;
    private readonly _totalXp: Record<string, number>;
    private readonly _maintainerIds: Set<Snowflake>;

    private readonly _masterPlayerQueue: PlayerQueue;
    private readonly _guildsByPlayer: Record<Snowflake, Set<Snowflake>>;
    private readonly _playersByGuild: Record<Snowflake, Set<Snowflake>>;

    private readonly _trackingChannelsByGuild: Record<Snowflake, TextChannel>;
    private readonly _privilegedRolesByGuild: Record<Snowflake, Role | APIRole>;

    constructor() {
        this._isValid = false;
        this._playersOffHiScores = new Set<string>();

        this._levels = {};
        this._bosses = {};
        this._clues = {};
        this._activities = {};

        this._botCounters = {};
        this._lastUpdate = {};
        this._displayNames = {};
        this._totalXp = {};
        this._maintainerIds = new Set();

        this._masterPlayerQueue = new PlayerQueue({
            queues: [{
                label: 'Active (<3d)',
                threshold: ACTIVE_THRESHOLD_MILLIS
            }, {
                label: 'Inactive (<4w)',
                threshold: INACTIVE_THRESHOLD_MILLIES
            }, {
                label: 'Archive (4w+)',
                threshold: Number.POSITIVE_INFINITY
            }],
            counterMax: 10
        });
        this._guildsByPlayer = {};
        this._playersByGuild = {};
        this._trackingChannelsByGuild = {};
        this._privilegedRolesByGuild = {};
    }

    isValid(): boolean {
        return this._isValid;
    }

    setValid(isValid: boolean): void {
        this._isValid = isValid;
    }

    isDisabled(): boolean {
        return this._disabled ?? false;
    }

    setDisabled(disabled: boolean): void {
        if (disabled) {
            this._disabled = true;
        } else {
            this._disabled = undefined;
        }
    }

    /**
     * This should be invoked whenever a player experiences some sort of update.
     * This lets the player queue know which players to update more frequently.
     * @param rsn the player to mark as active
     * @param timestamp optional parameter to set the last-active timestamp, defaults to now
     */
    markPlayerAsActive(rsn: string, timestamp?: Date): void {
        this._masterPlayerQueue.markAsActive(rsn, timestamp);
    }

    getTimeSincePlayerLastActive(rsn: string): number {
        return this._masterPlayerQueue.getTimeSinceLastActive(rsn);
    }

    hasPlayerActivityTimestamp(rsn: string): boolean {
        return this._masterPlayerQueue.hasActivityTimestamp(rsn);
    }

    getPlayerQueueDebugString(): string {
        return this._masterPlayerQueue.getDebugString();
    }

    nextTrackedPlayer(): string | undefined {
        return this._masterPlayerQueue.next();
    }

    isTrackingPlayer(guildId: Snowflake, rsn: string): boolean {
        return guildId in this._playersByGuild && this._playersByGuild[guildId].has(rsn);
    }

    isTrackingAnyPlayers(guildId: Snowflake): boolean {
        return guildId in this._playersByGuild && this._playersByGuild[guildId].size > 0;
    }

    addTrackedPlayer(guildId: Snowflake, rsn: string): void {
        // If this guild doesn't have a player set yet, initialize it
        if (!this._playersByGuild[guildId]) {
            this._playersByGuild[guildId] = new Set();
        }
        // Add this player to the guild's player set
        this._playersByGuild[guildId].add(rsn);
        // If this player doesn't have a guild set yet, initialize it
        if (!this._guildsByPlayer[rsn]) {
            this._guildsByPlayer[rsn] = new Set();
        }
        // Add this guild to the player's guild set
        this._guildsByPlayer[rsn].add(guildId);

        // Add to the master queue
        this._masterPlayerQueue.add(rsn);
    }

    removeTrackedPlayer(guildId: Snowflake, rsn: string): void {
        // Attempt to delete the player from the guild's player set
        this._playersByGuild[guildId]?.delete(rsn);
        // If this guild no longer is tracking any players, delete its player set
        if (!this.isTrackingAnyPlayers(guildId)) {
            delete this._playersByGuild[guildId];
            void logger.log(`Deleted player set for guild ${guildId}`, MultiLoggerLevel.Debug);
        }
        // Attempt to delete the guild from the player's guild set
        this._guildsByPlayer[rsn]?.delete(guildId);
        // If no longer being tracked in any guilds, delete all info related to this player
        if (!this.isPlayerTrackedInAnyGuilds(rsn)) {
            // Delete the player's guild set
            delete this._guildsByPlayer[rsn];
            // Remove from the master queue
            this._masterPlayerQueue.remove(rsn);
            // Delete player-related data
            delete this._levels[rsn];
            delete this._bosses[rsn];
            delete this._clues[rsn];
            delete this._activities[rsn];
            delete this._lastUpdate[rsn];
            delete this._displayNames[rsn];
            delete this._totalXp[rsn];
            this._playersOffHiScores.delete(rsn);
            void logger.log(`Removed player ${rsn} from the master queue`, MultiLoggerLevel.Debug);
        }
    }

    getAllTrackedPlayers(guildId: Snowflake): string[] {
        if (this.isTrackingAnyPlayers(guildId)) {
            return Array.from(this._playersByGuild[guildId]).sort();
        } else {
            return [];
        }
    }

    getNumTrackedPlayers(guildId: Snowflake): number {
        return this.getAllTrackedPlayers(guildId).length;
    }

    getAllGloballyTrackedPlayers(): string[] {
        return this._masterPlayerQueue.toSortedArray();
    }

    getNumGloballyTrackedPlayers(): number {
        return this._masterPlayerQueue.size();
    }

    clearAllTrackedPlayers(guildId: Snowflake): void {
        for (const rsn of this.getAllTrackedPlayers(guildId)) {
            this.removeTrackedPlayer(guildId, rsn);
        }
    }

    isPlayerTrackedInAnyGuilds(rsn: string): boolean {
        return rsn in this._guildsByPlayer && this._guildsByPlayer[rsn].size > 0;
    }

    getGuildsTrackingPlayer(rsn: string): Snowflake[] {
        if (this.isPlayerTrackedInAnyGuilds(rsn)) {
            return Array.from(this._guildsByPlayer[rsn]).sort();
        } else {
            return [];
        }
    }

    // TODO: Delete this method in favor of setPlayerHiScoreStatus
    addPlayerToHiScores(rsn: string): void {
        this.setPlayerHiScoreStatus(rsn, true);
    }

    // TODO: Delete this method in favor of setPlayerHiScoreStatus
    removePlayerFromHiScores(rsn: string): void {
        this.setPlayerHiScoreStatus(rsn, false);
    }

    setPlayerHiScoreStatus(rsn: string, onHiScores: boolean): void {
        // This logic is confusing because it's predicated on the assumption that most players will be ON the hiscores
        if (onHiScores) {
            this._playersOffHiScores.delete(rsn);
        } else {
            this._playersOffHiScores.add(rsn);
        }
    }

    isPlayerOnHiScores(rsn: string): boolean {
        return !this._playersOffHiScores.has(rsn);
    }

    getNumPlayersOffHiScores(): number {
        return this._playersOffHiScores.size;
    }

    getTrackingChannel(guildId: Snowflake): TextChannel {
        if (!this._trackingChannelsByGuild[guildId]) {
            throw new Error('Tracking channel does not exist');
        }
        return this._trackingChannelsByGuild[guildId];
    }

    setTrackingChannel(guildId: Snowflake, channel: TextChannel): void {
        this._trackingChannelsByGuild[guildId] = channel;
    }

    clearTrackingChannel(guildId: Snowflake): void {
        delete this._trackingChannelsByGuild[guildId];
    }

    hasTrackingChannel(guildId: Snowflake): boolean {
        return guildId in this._trackingChannelsByGuild;
    }

    getAllTrackingChannels(): TextChannel[] {
        return Object.values(this._trackingChannelsByGuild);
    }

    getTrackingChannelsForPlayer(rsn: string): TextChannel[] {
        return this.getGuildsTrackingPlayer(rsn)
            .filter(guildId => this.hasTrackingChannel(guildId))
            .map(guildId => this.getTrackingChannel(guildId));
    }

    getPrivilegedRole(guildId: Snowflake): Role | APIRole {
        if (!this._privilegedRolesByGuild[guildId]) {
            throw new Error('Privileged role does not exist');
        }
        return this._privilegedRolesByGuild[guildId];
    }

    setPrivilegedRole(guildId: Snowflake, role: Role | APIRole): void {
        this._privilegedRolesByGuild[guildId] = role;
    }

    clearPrivilegedRole(guildId: Snowflake): void {
        delete this._privilegedRolesByGuild[guildId];
    }

    hasPrivilegedRole(guildId: Snowflake): boolean {
        return guildId in this._privilegedRolesByGuild;
    }

    getLastUpdated(rsn: string): Date | undefined {
        return this._lastUpdate[rsn];
    }

    setLastUpdated(rsn: string, date: Date): void {
        this._lastUpdate[rsn] = date;
    }

    getDisplayName(rsn: string): string {
        return this._displayNames[rsn] ?? rsn;
    }

    hasDisplayName(rsn: string): boolean {
        return rsn in this._displayNames;
    }

    setDisplayName(rsn: string, displayName: string): void {
        this._displayNames[rsn] = displayName;
    }

    getDisplayNames(rsns: string[]): string[] {
        return rsns.map(rsn => this.getDisplayName(rsn));
    }

    // TODO: Will this be needed after we're done populating names?
    getNumPlayerDisplayNames(): number {
        return Object.keys(this._displayNames).length;
    }

    getTotalXp(rsn: string): number {
        return this._totalXp[rsn] ?? 0;
    }

    hasTotalXp(rsn: string): boolean {
        return rsn in this._totalXp;
    }

    setTotalXp(rsn: string, xp: number) {
        // TODO: Temp logging to ensure this is always positive
        if (xp < 1) {
            void logger.log(`**WARNING!** Attempted to set total XP for **${rsn}** to \`${xp}\``, MultiLoggerLevel.Warn);
        }
        this._totalXp[rsn] = xp;
    }

    // TODO: Will this be needed after we're done populating total XP?
    getNumPlayerTotalXp(): number {
        return Object.keys(this._totalXp).length;
    }

    addMaintainerId(userId: Snowflake): void {
        this._maintainerIds.add(userId);
    }

    isMaintainer(userId: Snowflake): boolean {
        return this._maintainerIds.has(userId);
    }

    hasLevels(rsn: string): boolean {
        return rsn in this._levels;
    }

    /**
     * NOTE: This only contains values that are definitively known via the API (does NOT contain assumed defaults)
     */
    getLevels(rsn: string): Partial<Record<IndividualSkillName, number>> {
        return this._levels[rsn];
    }

    /**
     * NOTE: It is expected that the input map only contains values that are definitively known via the API (does NOT contain assumed defaults) 
     */
    setLevels(rsn: string, levels: Partial<Record<IndividualSkillName, number>>): void {
        this._levels[rsn] = levels;
    }

    /**
     * NOTE: It is expected that the input map only contains values that are definitively known via the API (does NOT contain assumed defaults) 
     */
    setAllLevels(allLevels: Record<string, Record<string, number>>): void {
        for (const [rsn, levels] of Object.entries(allLevels)) {
            this.setLevels(rsn, levels);
        }
    }

    hasLevel(rsn: string, skill: string): boolean {
        return this.hasLevels(rsn) && skill in this._levels[rsn];
    }

    getLevel(rsn: string, skill: IndividualSkillName): number {
        if (!this.hasLevel(rsn, skill)) {
            throw new Error(`Trying to get ${skill} level for ${rsn} without checking if it's in the state`);
        }
        return this._levels[rsn][skill] as number;
    }

    setLevel(rsn: string, skill: IndividualSkillName, level: number): void {
        if (!this.hasLevels(rsn)) {
            throw new Error(`Trying to set ${skill} score for ${rsn} without there being pre-existing levels`);
        }
        this._levels[rsn][skill] = level;
    }

    hasBosses(rsn: string): boolean {
        return rsn in this._bosses;
    }

    /**
     * NOTE: This only contains values that are definitively known via the API (does NOT contain assumed defaults)
     */
    getBosses(rsn: string): Partial<Record<Boss, number>> {
        return this._bosses[rsn];
    }

    /**
     * NOTE: It is expected that the input map only contains values that are definitively known via the API (does NOT contain assumed defaults)
     */
    setBosses(rsn: string, bosses: Partial<Record<Boss, number>>): void {
        this._bosses[rsn] = bosses;
    }

    /**
     * NOTE: It is expected that the input map only contains values that are definitively known via the API (does NOT contain assumed defaults)
     */
    setAllBosses(allBosses: Record<string, Partial<Record<Boss, number>>>): void {
        for (const [rsn, value] of Object.entries(allBosses)) {
            this.setBosses(rsn, value);
        }
    }

    hasBoss(rsn: string, boss: string): boolean {
        return this.hasBosses(rsn) && boss in this._bosses[rsn];
    }

    getBoss(rsn: string, boss: Boss): number {
        if (!this.hasBoss(rsn, boss)) {
            throw new Error(`Trying to get ${boss} score for ${rsn} without checking if it's in the state`);
        }
        return this._bosses[rsn][boss] as number;
    }

    setBoss(rsn: string, boss: Boss, score: number): void {
        if (!this.hasBosses(rsn)) {
            throw new Error(`Trying to set ${boss} score for ${rsn} without there being pre-existing bosses`);
        }
        this._bosses[rsn][boss] = score;
    }

    hasClues(rsn: string): boolean {
        return rsn in this._clues;
    }

    /**
     * NOTE: This only contains values that are definitively known via the API (does NOT contain assumed defaults)
     */
    getClues(rsn: string): Partial<Record<IndividualClueType, number>> {
        return this._clues[rsn];
    }

    /**
     * NOTE: It is expected that the input map only contains values that are definitively known via the API (does NOT contain assumed defaults) 
     */
    setClues(rsn: string, clues: Partial<Record<IndividualClueType, number>>): void {
        this._clues[rsn] = clues;
    }

    /**
     * NOTE: It is expected that the input map only contains values that are definitively known via the API (does NOT contain assumed defaults) 
     */
    setAllClues(allClues: Record<string, Partial<Record<IndividualClueType, number>>>): void {
        for (const [rsn, clues] of Object.entries(allClues)) {
            this.setClues(rsn, clues);
        }
    }

    hasClue(rsn: string, clue: IndividualClueType): boolean {
        return this.hasClues(rsn) && clue in this._clues[rsn];
    }

    getClue(rsn: string, clue: IndividualClueType): number {
        if (!this.hasClue(rsn, clue)) {
            throw new Error(`Trying to get ${clue} score for ${rsn} without checking if it's in the state`);
        }
        return this._clues[rsn][clue] as number;
    }

    setClue(rsn: string, clue: IndividualClueType, score: number): void {
        if (!this.hasClues(rsn)) {
            throw new Error(`Trying to set ${clue} score for ${rsn} without there being pre-existing clues`);
        }
        this._clues[rsn][clue] = score;
    }

    hasActivities(rsn: string): boolean {
        return rsn in this._activities;
    }

    /**
     * NOTE: This only contains values that are definitively known via the API (does NOT contain assumed defaults)
     */
    getActivities(rsn: string): Partial<Record<IndividualActivityName, number>> {
        return this._activities[rsn];
    }

    /**
     * NOTE: It is expected that the input map only contains values that are definitively known via the API (does NOT contain assumed defaults) 
     */
    setActivities(rsn: string, activities: Partial<Record<IndividualActivityName, number>>): void {
        this._activities[rsn] = activities;
    }

    /**
     * NOTE: It is expected that the input map only contains values that are definitively known via the API (does NOT contain assumed defaults) 
     */
    setAllActivities(allActivities: Record<string, Partial<Record<IndividualActivityName, number>>>): void {
        for (const [rsn, activities] of Object.entries(allActivities)) {
            this.setActivities(rsn, activities);
        }
    }

    hasActivity(rsn: string, activity: IndividualActivityName): boolean {
        return this.hasActivities(rsn) && activity in this._activities[rsn];
    }

    getActivity(rsn: string, activity: IndividualActivityName): number {
        if (!this.hasActivity(rsn, activity)) {
            throw new Error(`Trying to get ${activity} score for ${rsn} without checking if it's in the state`);
        }
        return this._activities[rsn][activity] as number;
    }

    setActivity(rsn: string, activity: IndividualActivityName, score: number): void {
        if (!this.hasActivities(rsn)) {
            throw new Error(`Trying to set ${activity} score for ${rsn} without there being pre-existing activities`);
        }
        this._activities[rsn][activity] = score;
    }

    getBotCounter(botId: Snowflake): number {
        return this._botCounters[botId];
    }

    setBotCounters(botCounters: Record<Snowflake, number>): void {
        Object.entries(botCounters).forEach(([botId, count]) => {
            this._botCounters[botId] = count;
        });
    }

    incrementBotCounter(botId: Snowflake, delta = 1): void {
        this._botCounters[botId] = (this._botCounters[botId] ?? 0) + delta;
    }

    hasTimestamp(): boolean {
        return this._timestamp !== undefined;
    }

    getTimestamp(): Date {
        if (!this._timestamp) {
            throw new Error('Timestamp does not exist');
        }
        return this._timestamp;
    }

    setTimestamp(timestamp: Date): void {
        this._timestamp = timestamp;
    }

    /**
     * TODO: Is there a better way to do this?
     * 
     * @returns All guild IDs which are either tracking players or have a tracking channel set
     */
    getAllRelevantGuilds(): Snowflake[] {
        const allGuildIds: Set<Snowflake> = new Set();
        for (const guildId of Object.keys(this._trackingChannelsByGuild)) {
            allGuildIds.add(guildId);
        }
        for (const guildId of Object.keys(this._playersByGuild)) {
            allGuildIds.add(guildId);
        }
        return Array.from(allGuildIds).sort();
    }

    /**
     * @returns Sorted list of all relevant guild IDs, from most players tracked to fewest players tracked
     */
    getGuildsByPlayerCount(): Snowflake[] {
        const allGuildIds: Snowflake[] = this.getAllRelevantGuilds();
        allGuildIds.sort((x, y) => this.getNumTrackedPlayers(y) - this.getNumTrackedPlayers(x));
        return allGuildIds;
    }

    /**
     * TODO: This is just used on startup to troubleshoot some issues. Should it be removed?
     */
    toDebugString(): string {
        return this.getAllGloballyTrackedPlayers().map(rsn => `**${rsn}:** ${this.getTrackingChannelsForPlayer(rsn).join(', ')}`).join('\n');
    }

    /**
     * @returns String representing the duration between each refresh for any active player, inactive, and archived player
     */
    getRefreshDurationString(): string {
        return this._masterPlayerQueue.getDurationString();
    }

    getLabeledRefreshDurationStrings(): { label: string, duration: string }[] {
        return this._masterPlayerQueue.getLabeledDurationStrings();
    }
}
