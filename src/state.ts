import { Snowflake, TextBasedChannel } from 'discord.js';
import { Client as PGClient } from 'pg';
import { CircularQueue } from 'evanw555.js';
import { IndividualSkillName } from './types';
import { Boss } from 'osrs-json-hiscores';

import logger from './instances/logger';

export default class State {
    private _isValid: boolean;
    private _timestamp?: Date;
    private _disabled?: boolean;
    private readonly _playersOffHiScores: Set<string>;
    private readonly _levels: Record<string, Partial<Record<IndividualSkillName, number>>>;
    private readonly _bosses: Record<string, Partial<Record<Boss, number>>>;
    private readonly _botCounters: Record<Snowflake, number>;
    private readonly _lastUpdate: Record<string, Date>;
    private _adminId?: Snowflake;

    private readonly _masterPlayerQueue: CircularQueue<string>;
    private readonly _guildsByPlayer: Record<Snowflake, Set<Snowflake>>;
    private readonly _playersByGuild: Record<Snowflake, Set<Snowflake>>;

    private readonly _trackingChannelsByGuild: Record<Snowflake, TextBasedChannel>;

    private _pgClient?: PGClient;

    constructor() {
        this._isValid = false;
        this._playersOffHiScores = new Set<string>();
        this._levels = {};
        this._bosses = {};
        this._botCounters = {};
        this._lastUpdate = {};

        this._masterPlayerQueue = new CircularQueue<string>();
        this._guildsByPlayer = {};
        this._playersByGuild = {};
        this._trackingChannelsByGuild = {};
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
            logger.log(`Deleted player set for guild ${guildId}`);
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
            delete this._lastUpdate[rsn];
            logger.log(`Removed player ${rsn} from the master queue`);
        }
    }

    getAllTrackedPlayers(guildId: Snowflake): string[] {
        if (this.isTrackingAnyPlayers(guildId)) {
            return Array.from(this._playersByGuild[guildId]).sort();
        } else {
            return [];
        }
    }

    getAllGloballyTrackedPlayers(): string[] {
        return this._masterPlayerQueue.toSortedArray();
    }

    clearAllTrackedPlayers(guildId: Snowflake): void {
        for (const rsn of this.getAllTrackedPlayers(guildId)) {
            this.removeTrackedPlayer(guildId, rsn);
        }
    }

    isPlayerTrackedInAnyGuilds(rsn: string): boolean {
        return this._guildsByPlayer[rsn] && this._guildsByPlayer[rsn].size > 0;
    }

    getGuildsTrackingPlayer(rsn: string): Snowflake[] {
        if (this.isPlayerTrackedInAnyGuilds(rsn)) {
            return Array.from(this._guildsByPlayer[rsn]).sort();
        } else {
            return [];
        }
    }

    addPlayerToHiScores(rsn: string): void {
        this._playersOffHiScores.delete(rsn);
    }

    removePlayerFromHiScores(rsn: string): void {
        this._playersOffHiScores.add(rsn);
    }

    isPlayerOnHiScores(rsn: string): boolean {
        return !this._playersOffHiScores.has(rsn);
    }

    getTrackingChannel(guildId: Snowflake): TextBasedChannel {
        if (!this._trackingChannelsByGuild[guildId]) {
            throw new Error('Tracking channel does not exist');
        }
        return this._trackingChannelsByGuild[guildId];
    }

    setTrackingChannel(guildId: Snowflake, channel: TextBasedChannel): void {
        // Theoretically this should always be true, but ensure the instance exists just to be sure
        if (channel) {
            this._trackingChannelsByGuild[guildId] = channel;
        }
    }

    hasTrackingChannel(guildId: Snowflake): boolean {
        return guildId in this._trackingChannelsByGuild;
    }

    getAllTrackingChannels(): TextBasedChannel[] {
        return Object.values(this._trackingChannelsByGuild);
    }

    getTrackingChannelsForPlayer(rsn: string): TextBasedChannel[] {
        return this.getGuildsTrackingPlayer(rsn)
            .filter(guildId => this.hasTrackingChannel(guildId))
            .map(guildId => this.getTrackingChannel(guildId));
    }

    getLastUpdated(rsn: string): Date | undefined {
        return this._lastUpdate[rsn];
    }

    setLastUpdated(rsn: string, date: Date): void {
        this._lastUpdate[rsn] = date;
    }

    setAdminId(adminId: string): void {
        this._adminId = adminId;
    }

    isAdmin(adminId: string): boolean {
        return this._adminId !== undefined && this._adminId === adminId;
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
    setLevels(rsn: string, levels: Record<string, number>): void {
        this._levels[rsn] = levels;
    }

    /**
     * NOTE: It is expected that the input map only contains values that are definitively known via the API (does NOT contain assumed defaults) 
     */
    setAllLevels(levels: Record<string, Record<string, number>>): void {
        Object.entries(levels).forEach(([rsn, value]) => {
            this.setLevels(rsn, value);
        });
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
    setBosses(rsn: string, bosses: Record<string, number>): void {
        this._bosses[rsn] = bosses;
    }

    /**
     * NOTE: It is expected that the input map only contains values that are definitively known via the API (does NOT contain assumed defaults) 
     */
    setAllBosses(bosses: Record<string, Record<string, number>>): void {
        Object.entries(bosses).forEach(([rsn, value]) => {
            this.setBosses(rsn, value);
        });
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

    setPGClient(pgCliet: PGClient): void {
        this._pgClient = pgCliet;
    }

    getPGClient(): PGClient {
        if (!this._pgClient) {
            throw new Error('The PG client is not set in the state object!');
        }
        return this._pgClient;
    }

    /**
     * TODO: This is just used on startup to troubleshoot some issues. Should it be removed?
     */
    toDebugString(): string {
        return this.getAllGloballyTrackedPlayers().map(rsn => `**${rsn}:** ${this.getTrackingChannelsForPlayer(rsn).join(', ')}`).join('\n');
    }
}
