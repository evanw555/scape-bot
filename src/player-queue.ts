import { CircularQueue, MultiLoggerLevel } from 'evanw555.js';

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

    next(): string | undefined {
        // Don't loop over the active queue more than once before drawing from the inactive queue.
        // N is guaranteed to be at most 10, possibly less on a fresh reboot (active queue empty -> N = 1 -> always draw from the inactive queue)
        const counterInterval = Math.min(10, 1 + this.activeQueue.size());
        this.counter = (this.counter + 1) % counterInterval;
        // Every N calls we process from the inactive queue, for the remaining N - 1 we process from the active queue
        if (this.counter === 0) {
            const inactivePlayer = this.inactiveQueue.next();
            // If this inactive player is now active, move them to the active queue
            if (inactivePlayer && this.isActive(inactivePlayer)) {
                this.moveToActiveQueue(inactivePlayer);
            }
            logger.log(`[IQ] ${this.counter}/${counterInterval} -> ${inactivePlayer}`, MultiLoggerLevel.Debug);
            return inactivePlayer;
        } else {
            const activePlayer = this.activeQueue.next();
            // If this active player is now inactive, move them to the inactive queue
            if (activePlayer && !this.isActive(activePlayer)) {
                this.moveToInactiveQueue(activePlayer);
            }
            logger.log(`[AQ] ${this.counter}/${counterInterval} -> ${activePlayer}`, MultiLoggerLevel.Debug);
            return activePlayer;
        }
    }

    private moveToActiveQueue(rsn: string): void {
        this.activeQueue.add(rsn);
        this.inactiveQueue.remove(rsn);
        logger.log(`Moved **${rsn}** to the _active_ queue`, MultiLoggerLevel.Warn);
    }

    private moveToInactiveQueue(rsn: string): void {
        this.inactiveQueue.add(rsn);
        this.activeQueue.remove(rsn);
        logger.log(`Moved **${rsn}** to the _inactive_ queue`, MultiLoggerLevel.Warn);
    }

    markAsActive(rsn: string): void {
        // If this player was considered inactive before this, move them to the active queue now
        if (!this.isActive(rsn)) {
            this.moveToActiveQueue(rsn);
        }
        // Set their "last active" timestamp to right now
        this.lastActive[rsn] = new Date().getTime();
    }

    toSortedArray(): string[] {
        return this.activeQueue.toSortedArray().concat(this.inactiveQueue.toSortedArray()).sort();
    }

    private isActive(rsn: string): boolean {
        // If user had an update in the last week
        return new Date().getTime() - this.getLastActive(rsn) < 1000 * 60 * 60 * 24 * 7;
    }

    private getLastActive(rsn: string): number {
        return this.lastActive[rsn] ?? 0;
    }
}