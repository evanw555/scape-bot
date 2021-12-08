import { TextBasedChannels } from "../node_modules/discord.js/typings/index";
import { SerializedState } from "./types";
import CircularQueue from './circular-queue.js';

class State {
    private _isValid: boolean;
    private readonly _players: CircularQueue<string>;
    readonly _levels: Record<string, Record<string, number>>;
    readonly _bosses: Record<string, Record<string, number>>;
    readonly _lastUpdate: Record<string, Date>;
    readonly _ownerIds: Set<string>;

    _trackingChannel?: TextBasedChannels;

    constructor() {
        this._isValid = false;
        this._players = new CircularQueue<string>();
        this._levels = {};
        this._bosses = {};
        this._lastUpdate = {};
        this._ownerIds = new Set<string>();
    }

    isValid(): boolean {
        return this._isValid;
    }

    setValid(isValid: boolean): void {
        this._isValid = isValid;
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

    getTrackingChannel(): TextBasedChannels {
        return this._trackingChannel;
    }

    setTrackingChannel(channel: TextBasedChannels): void {
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

    setLevels(levels: Record<string, Record<string, number>>): void {
        Object.entries(levels).forEach(([player, value]) => {
            this._levels[player] = value;
        });
    }

    setBosses(bosses: Record<string, Record<string, number>>): void {
        Object.entries(bosses).forEach(([player, value]) => {
            this._bosses[player] = value;
        });
    }

    serialize(): SerializedState {
        return {
            players: this._players.toSortedArray(),
            trackingChannelId: this._trackingChannel.id,
            levels: this._levels,
            bosses: this._bosses
        };
    }
}

export default new State();
