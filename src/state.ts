import { Snowflake, TextBasedChannel } from 'discord.js';
import { SerializedState } from './types';
import CircularQueue from './circular-queue';
import { filterValueFromMap } from './util';

class State {
    private _isValid: boolean;
    private _timestamp?: Date;
    private _disabled?: boolean;
    private readonly _players: CircularQueue<string>;
    private readonly _playersOffHiScores: Set<string>;
    private readonly _levels: Record<string, Record<string, number>>;
    private readonly _bosses: Record<string, Record<string, number>>;
    private readonly _botCounters: Record<Snowflake, number>;
    readonly _lastUpdate: Record<string, Date>;
    readonly _ownerIds: Set<string>;

    _trackingChannel?: TextBasedChannel;

    constructor() {
        this._isValid = false;
        this._players = new CircularQueue<string>();
        this._playersOffHiScores = new Set<string>();
        this._levels = {};
        this._bosses = {};
        this._botCounters = {};
        this._lastUpdate = {};
        this._ownerIds = new Set<string>();
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

    isTrackingPlayer(player: string): boolean {
        return this._players.contains(player);
    }

    isTrackingAnyPlayers(): boolean {
        return !this._players.isEmpty();
    }

    addTrackedPlayer(player: string): void {
        this._players.add(player);
    }

    removeTrackedPlayer(player: string): void {
        this._players.remove(player);
        delete this._levels[player];
        delete this._bosses[player];
        delete this._lastUpdate[player];
    }

    getAllTrackedPlayers(): string[] {
        return this._players.toSortedArray();
    }

    getTrackedPlayers(): CircularQueue<string> {
        return this._players;
    }

    clearAllTrackedPlayers(): void {
        this.getAllTrackedPlayers().forEach((player: string) => {
            this.removeTrackedPlayer(player);
        });
    }

    addPlayerToHiScores(player: string): void {
        this._playersOffHiScores.delete(player);
    }

    removePlayerFromHiScores(player: string): void {
        this._playersOffHiScores.add(player);
    }

    isPlayerOnHiScores(player: string): boolean {
        return !this._playersOffHiScores.has(player);
    }

    getTrackingChannel(): TextBasedChannel {
        if (!this._trackingChannel) {
            throw new Error('Tracking channel does not exist');
        }
        return this._trackingChannel;
    }

    setTrackingChannel(channel: TextBasedChannel): void {
        this._trackingChannel = channel;
    }

    hasTrackingChannel(): boolean {
        return this._trackingChannel !== undefined;
    }

    addOwnerId(ownerId: string): void {
        this._ownerIds.add(ownerId);
    }

    isOwner(ownerId: string): boolean {
        return this._ownerIds.has(ownerId);
    }

    setAllLevels(levels: Record<string, Record<string, number>>): void {
        Object.entries(levels).forEach(([player, value]) => {
            this.setLevels(player, value);
        });
    }

    setAllBosses(bosses: Record<string, Record<string, number>>): void {
        Object.entries(bosses).forEach(([player, value]) => {
            this.setBosses(player, value);
        });
    }

    hasLevels(player: string): boolean {
        return this._levels[player] !== undefined;
    }

    getLevels(player: string): Record<string, number> {
        return this._levels[player];
    }

    setLevels(player: string, levels: Record<string, number>): void {
        this._levels[player] = levels;
    }

    hasBosses(player: string): boolean {
        return this._bosses[player] !== undefined;
    }

    getBosses(player: string): Record<string, number> {
        return this._bosses[player];
    }

    setBosses(player: string, bosses: Record<string, number>): void {
        // Remove entries with zero kills to avoid bloating the state file
        this._bosses[player] = filterValueFromMap(bosses, 0);
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

    serialize(): SerializedState {
        return {
            timestamp: this._timestamp?.toJSON(),
            disabled: this._disabled,
            players: this._players.toSortedArray(),
            playersOffHiScores: Array.from(this._playersOffHiScores),
            trackingChannelId: this._trackingChannel?.id,
            levels: this._levels,
            bosses: this._bosses,
            botCounters: this._botCounters
        };
    }
}

export default new State();
