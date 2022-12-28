import { CircularQueue, MultiLoggerLevel } from 'evanw555.js';

import { CONFIG } from './constants';

import logger from './instances/logger';

export default class PlayerQueue {
    private readonly activeQueue: CircularQueue<string>;
    private readonly inactiveQueue: CircularQueue<string>;
    private readonly lastActive: Record<string, number>;

    private counter: number;

    constructor() {
        this.activeQueue = new CircularQueue();
        this.inactiveQueue = new CircularQueue();
        this.lastActive = {};
        this.counter = 0;
    }

    add(rsn: string): boolean {
        // If this player exists in neither queue, add to the inactive queue
        if (!this.activeQueue.contains(rsn) && !this.inactiveQueue.contains(rsn)) {
            return this.inactiveQueue.add(rsn);
        }
        return false;
    }

    remove(rsn: string): boolean {
        const a = this.activeQueue.remove(rsn);
        const i = this.inactiveQueue.remove(rsn);
        return a || i;
    }

    /**
     * @returns The counter interval N (queue returns 1 inactive player per N-1 active players)
     */
    private getCounterInterval(): number {
        // Don't loop over the active queue more than once before drawing from the inactive queue.
        // N is guaranteed to be at most 10, possibly less on a fresh reboot (active queue empty -> N = 1 -> always draw from the inactive queue)
        return Math.min(10, 1 + this.activeQueue.size());
    }

    next(): string | undefined {
        const counterInterval = this.getCounterInterval();
        this.counter = (this.counter + 1) % counterInterval;
        // Every N calls we process from the inactive queue, for the remaining N - 1 we process from the active queue
        if (this.counter === 0) {
            const inactivePlayer = this.inactiveQueue.next();
            // If this inactive player is now active, move them to the active queue
            if (inactivePlayer && this.isActive(inactivePlayer)) {
                this.moveToActiveQueue(inactivePlayer);
                logger.log(`Moved **${inactivePlayer}** to the _active_ queue (**${this.getDebugString()}**)`, MultiLoggerLevel.Warn);
            }
            logger.log(`[IQ] ${this.counter}/${counterInterval} -> ${inactivePlayer}`, MultiLoggerLevel.Debug);
            return inactivePlayer;
        } else {
            const activePlayer = this.activeQueue.next();
            // If this active player is now inactive, move them to the inactive queue
            if (activePlayer && !this.isActive(activePlayer)) {
                this.moveToInactiveQueue(activePlayer);
                logger.log(`Moved **${activePlayer}** to the _inactive_ queue (**${this.getDebugString()}**)`, MultiLoggerLevel.Warn);
            }
            logger.log(`[AQ] ${this.counter}/${counterInterval} -> ${activePlayer}`, MultiLoggerLevel.Debug);
            return activePlayer;
        }
    }

    private moveToActiveQueue(rsn: string): void {
        this.activeQueue.add(rsn);
        this.inactiveQueue.remove(rsn);
    }

    private moveToInactiveQueue(rsn: string): void {
        this.inactiveQueue.add(rsn);
        this.activeQueue.remove(rsn);
    }

    markAsActive(rsn: string, timestamp?: Date): void {
        // Set their "last active" timestamp to right now (or the specified date)
        this.lastActive[rsn] = (timestamp ?? new Date()).getTime();
        // If they're now active and weren't already on the active queue, move them there now
        if (this.isActive(rsn) && this.inactiveQueue.contains(rsn) && !this.activeQueue.contains(rsn)) {
            this.moveToActiveQueue(rsn);
            // Log if this isn't on reboot
            if (!timestamp) {
                logger.log(`Moved **${rsn}** to the _active_ queue (**${this.getDebugString()}**)`, MultiLoggerLevel.Warn);
            }
        }
    }

    private isActive(rsn: string): boolean {
        // If user had an update in the last week
        return new Date().getTime() - this.getLastActive(rsn) < 1000 * 60 * 60 * 24 * 7;
    }

    private getLastActive(rsn: string): number {
        return this.lastActive[rsn] ?? 0;
    }

    getNumActivePlayers(): number {
        return this.activeQueue.size();
    }

    getNumInactivePlayers(): number {
        return this.inactiveQueue.size();
    }

    /**
     * @returns Milliseconds between a refresh for one active player
     */
    getActiveRefreshDuration(): number {
        return this.getNumActivePlayers() * Math.floor(CONFIG.refreshInterval * this.getCounterInterval() / (this.getCounterInterval() - 1));
    }

    /**
     * @returns Milliseconds between a refresh for one inactive player
     */
    getInactiveRefreshDuration(): number {
        return CONFIG.refreshInterval * this.getCounterInterval() * this.getNumInactivePlayers();
    }

    toSortedArray(): string[] {
        return this.activeQueue.toSortedArray().concat(this.inactiveQueue.toSortedArray()).sort();
    }

    private getDebugString(): string {
        return `${this.getNumActivePlayers()}A:${this.getNumInactivePlayers()}I`;
    }

    size(): number {
        return this.activeQueue.size() + this.inactiveQueue.size();
    }
}