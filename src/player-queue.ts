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
        // If the active queue is empty (this will happen on a fresh reboot), always draw from the inactive queue
        if (this.activeQueue.isEmpty()) {
            const rsn = this.inactiveQueue.next();
            logger.log(`[Inactive] (No Actives) -> ${rsn}`, MultiLoggerLevel.Debug);
        }
        // TODO: Use the size of the active queue rather than this hard-coded limit
        this.counter = (this.counter + 1) % 10;
        // Every 10th call processes from the inactive queue, the remaining 9 process from the active queue
        if (this.counter === 0) {
            const inactivePlayer = this.inactiveQueue.next();
            // If this inactive player is now active, move them to the active queue
            if (inactivePlayer && this.isActive(inactivePlayer)) {
                this.activeQueue.add(inactivePlayer);
                this.inactiveQueue.remove(inactivePlayer);
                logger.log(`Moved **${inactivePlayer}** to the _active_ queue`, MultiLoggerLevel.Warn);
            }
            logger.log(`[Inactive] ${this.counter} -> ${inactivePlayer}`, MultiLoggerLevel.Debug);
            return inactivePlayer;
        } else {
            const activePlayer = this.activeQueue.next();
            // If this active player is now inactive, move them to the inactive queue
            if (activePlayer && !this.isActive(activePlayer)) {
                this.inactiveQueue.add(activePlayer);
                this.activeQueue.remove(activePlayer);
                logger.log(`Moved **${activePlayer}** to the _inactive_ queue`, MultiLoggerLevel.Warn);
            }
            logger.log(`[Active] ${this.counter} -> ${activePlayer}`, MultiLoggerLevel.Debug);
            return activePlayer;
        }
    }

    markAsActive(rsn: string): void {
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