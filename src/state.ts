import { TextBasedChannels } from "../node_modules/discord.js/typings/index";
import log from "./log.js";

import Storage from './file-storage.js';
import CircularQueue from './circular-queue.js';
import { SerializedState } from "./types";

class State {

    private _isValid: boolean;

    readonly _players: CircularQueue<string>;
    readonly _levels: Record<string, Record<string, number>>;
    readonly _bosses: Record<string, Record<string, number>>;
    readonly _lastUpdate: Record<string, Date>;
    readonly _ownerIds: Set<string>;

    readonly _storage: Storage = new Storage('./data/');

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
        this._savePlayers();
    }

    removeTrackedPlayer(player: string): void {
        this._players.remove(player);
        delete this._levels[player];
        delete this._bosses[player];
        delete this._lastUpdate[player];
        this._savePlayers();
    }

    getAllTrackedPlayers(): string[] {
        return this._players.toSortedArray();
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
        this._saveChannel();
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

    _savePlayers(): void {
        this._storage.write('players', this._players.toString()).catch((err) => {
            log.push(`Unable to save players '${this._players.toString()}': ${err.toString()}`);
        });
    }

    _saveChannel(): void {
        this._storage.write('channel', this._trackingChannel.id).catch((err) => {
            log.push(`Unable to save tracking channel: ${err.toString()}`);
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
