import { Snowflake, TextBasedChannel } from 'discord.js';
import { CircularQueue } from 'evanw555.js';
import { SerializedGuildState, SerializedState } from './types';
import { filterValueFromMap } from './util';

class State {
    private _isValid: boolean;
    private _timestamp?: Date;
    private _disabled?: boolean;
    private readonly _playersOffHiScores: Set<string>;
    private readonly _levels: Record<string, Record<string, number>>;
    private readonly _bosses: Record<string, Record<string, number>>;
    private readonly _botCounters: Record<Snowflake, number>;
    private _weeklyTotalXpSnapshots: Record<string, number>;
    readonly _lastUpdate: Record<string, Date>;
    readonly _ownerIds: Set<string>;

    private readonly _masterPlayerQueue: CircularQueue<string>;
    private readonly _guildsByPlayer: Record<Snowflake, Set<Snowflake>>;
    private readonly _playersByGuild: Record<Snowflake, Set<Snowflake>>;

    private readonly _trackingChannelsByGuild: Record<Snowflake, TextBasedChannel>;

    // _trackingChannel?: TextBasedChannel;

    constructor() {
        this._isValid = false;
        this._playersOffHiScores = new Set<string>();
        this._levels = {};
        this._bosses = {};
        this._botCounters = {};
        this._weeklyTotalXpSnapshots = {};
        this._lastUpdate = {};
        this._ownerIds = new Set<string>();

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

    // getTrackedPlayers(): CircularQueue<string> {
    //     return this._players;
    // }

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

    addOwnerId(ownerId: string): void {
        this._ownerIds.add(ownerId);
    }

    isOwner(ownerId: string): boolean {
        return this._ownerIds.has(ownerId);
    }

    setAllLevels(levels: Record<string, Record<string, number>>): void {
        Object.entries(levels).forEach(([rsn, value]) => {
            this.setLevels(rsn, value);
        });
    }

    setAllBosses(bosses: Record<string, Record<string, number>>): void {
        Object.entries(bosses).forEach(([rsn, value]) => {
            this.setBosses(rsn, value);
        });
    }

    hasLevels(rsn: string): boolean {
        return this._levels[rsn] !== undefined;
    }

    getLevels(rsn: string): Record<string, number> {
        return this._levels[rsn];
    }

    setLevels(rsn: string, levels: Record<string, number>): void {
        this._levels[rsn] = levels;
    }

    hasBosses(rsn: string): boolean {
        return this._bosses[rsn] !== undefined;
    }

    getBosses(rsn: string): Record<string, number> {
        return this._bosses[rsn];
    }

    setBosses(rsn: string, bosses: Record<string, number>): void {
        // Remove entries with zero kills to avoid bloating the state file
        this._bosses[rsn] = filterValueFromMap(bosses, 0);
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

    getWeeklyTotalXpSnapshots(): Record<string, number> {
        return this._weeklyTotalXpSnapshots;
    }

    setWeeklyTotalXpSnapshots(snapshots: Record<string, number>): void {
        this._weeklyTotalXpSnapshots = snapshots;
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

    serialize(): SerializedState {
        const guilds: Record<Snowflake, SerializedGuildState> = {};
        for (const guildId of this.getAllRelevantGuilds()) {
            guilds[guildId] = {
                players: this.getAllTrackedPlayers(guildId)
            };
            if (this._trackingChannelsByGuild[guildId]) {
                guilds[guildId].trackingChannelId = this._trackingChannelsByGuild[guildId].id;
            }
        }
        return {
            timestamp: this._timestamp?.toJSON(),
            disabled: this._disabled,
            guilds,
            playersOffHiScores: Array.from(this._playersOffHiScores),
            levels: this._levels,
            bosses: this._bosses,
            botCounters: this._botCounters,
            weeklyTotalXpSnapshots: this._weeklyTotalXpSnapshots
        };
    }
}

export default new State();
