import { CircularQueue, getPreciseDurationString, MultiLoggerLevel, naturalJoin } from 'evanw555.js';

import { CONFIG } from './constants';

import logger from './instances/logger';

interface QueueConfig {
    label: string,
    threshold: number
}

interface QueueData {
    queue: CircularQueue<string>,
    counter: number,
    config: QueueConfig
}

export default class PlayerQueue {
    private readonly queues: QueueData[];
    private readonly lastActive: Record<string, number>;
    private readonly counterMax: number;

    constructor(config: { queues: QueueConfig[], counterMax: number }) {
        this.queues = [];
        for (const queueConfig of config.queues) {
            this.queues.push({
                queue: new CircularQueue(),
                counter: 0,
                config: {
                    label: queueConfig.label,
                    threshold: queueConfig.threshold
                }
            });
        }
        this.lastActive = {};
        this.counterMax = config.counterMax;
    }

    add(rsn: string): boolean {
        // If this player exists in no queue, add to the last queue
        if (this.queues.every(queue => !queue.queue.contains(rsn))) {
            return this.queues[this.queues.length - 1].queue.add(rsn);
        }
        return false;
    }

    remove(rsn: string): boolean {
        let result = false;
        for (const queue of this.queues) {
            if (queue.queue.remove(rsn)) {
                result = true;
            }
        }
        return result;
    }

    /**
     * For a particular queue, this tells us how many times we can pick from it before deferring to a lower queue.
     */
    private getQueueCounterMax(index: number): number {
        return Math.min(this.counterMax, this.queues[index].queue.size());
    }

    next(): string | undefined {
        for (let i = 0; i < this.queues.length; i++) {
            const queue = this.queues[i];
            const isLastQueue = (i === this.queues.length - 1);
            // If not on the last queue and the counter has reached the max, pass it off to the next queue
            if (queue.queue.isEmpty() || queue.counter >= this.getQueueCounterMax(i)) {
                queue.counter = 0;
                if (!isLastQueue) {
                    continue;
                }
            }
            // Get the RSN to be returned
            const rsn = queue.queue.next();
            if (!rsn) {
                continue;
            }
            // Increment the counter for this queue
            queue.counter++;
            // If not on the last queue and this player isn't active enough to be on this queue, shift them down a queue
            if (!isLastQueue && this.getTimeSinceLastActive(rsn) >= queue.config.threshold) {
                // Remove from this queue
                queue.queue.remove(rsn);
                // Add to next queue
                const nextQueue = this.queues[i + 1];
                nextQueue.queue.add(rsn);
                void logger.log(`Down-queue **${rsn}** from _${queue.config.label}_ to _${nextQueue.config.label}_ (${this.getDebugString()})`, MultiLoggerLevel.Info);
            }
            void logger.log(`[Q${i}] ${queue.counter}/${this.getQueueCounterMax(i)} -> ${rsn}`, MultiLoggerLevel.Trace);
            return rsn;
        }
    }

    markAsActive(rsn: string, timestamp?: Date): void {
        const newTimestamp = (timestamp ?? new Date()).getTime();
        const prevTimestamp = this.lastActive[rsn];
        // Set their "last active" timestamp to right now (or the specified date)
        this.lastActive[rsn] = newTimestamp;
        // If the new timestamp is older than their previous timestamp, don't alter the queues now
        if (newTimestamp < prevTimestamp) {
            return;
        }
        // Otherwise, shift the player up the proper number of queues
        let removeFromRest = false;
        let fromLabel = '';
        let toLabel = '';
        for (let i = 0; i < this.queues.length; i++) {
            const queue = this.queues[i];
            if (removeFromRest) {
                if (queue.queue.contains(rsn)) {
                    queue.queue.remove(rsn);
                    fromLabel = queue.config.label;
                }
            } else if (this.getTimeSinceLastActive(rsn) < queue.config.threshold) {
                // If this player is already in the appropriate queue, take no action and abort...
                if (queue.queue.contains(rsn)) {
                    return;
                }
                // Otherwise, add them to this queue and remove them from the remaining queues
                queue.queue.add(rsn);
                removeFromRest = true;
                toLabel = queue.config.label;
            }
        }
        // Log if this isn't on reboot
        if (!timestamp) {
            void logger.log(`Up-queue **${rsn}** from _${fromLabel}_ to _${toLabel}_ (${this.getDebugString()})`, MultiLoggerLevel.Info);
        }
    }

    private getLastActive(rsn: string): number {
        return this.lastActive[rsn] ?? 0;
    }

    getTimeSinceLastActive(rsn: string): number {
        return new Date().getTime() - this.getLastActive(rsn);
    }

    getNumPlayersByQueue(): number[] {
        return this.queues.map(queue => queue.queue.size());
    }

    getQueueDuration(index: number): number {
        // For the current queue, we will need to go through the entire thing to reach a particular player
        let result = this.queues[index].queue.size();
        // For each higher queue, we will only need to loop up to the counter max to come back
        for (let i = 0; i < index; i++) {
            result *= this.getQueueCounterMax(i);
        }
        // Add 1 to account for the fact that there might be a lower queue we'll have to visit once per loop
        return (result + 1) * CONFIG.refreshInterval;
    }

    getDurationString(): string {
        return this.queues.map((queue, index) => {
            return `_${getPreciseDurationString(this.getQueueDuration(index))}_ (${queue.config.label})`;
        }).join(', ');
    }

    toSortedArray(): string[] {
        const result: string[] = [];
        for (const queue of this.queues) {
            result.push(...queue.queue.toSortedArray());
        }
        return result.sort();
    }

    toDelimitedString(): string {
        return this.queues.map(queue => queue.queue.toSortedArray().join(',')).join(';');
    }

    getDebugString(): string {
        return naturalJoin(this.queues.map(queue => {
            return `**${queue.queue.size()}** ${queue.config.label}`
        }));
    }

    getLabeledDurationStrings(): { label: string, duration: string }[] {
        return this.queues.map((queue, index) => {
            return {
                label: queue.config.label,
                duration: getPreciseDurationString(this.getQueueDuration(index))
            };
        });
    }

    getIndexesString(): string {
        return JSON.stringify(this.queues.map(queue => queue.counter));
    }

    size(): number {
        let result = 0;
        for (const queue of this.queues) {
            result += queue.queue.size();
        }
        return result;
    }
}