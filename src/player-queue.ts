import { CircularQueue, getPreciseDurationString, MultiLoggerLevel, naturalJoin } from 'evanw555.js';

import logger from './instances/logger';
import timer from './instances/timer';

interface QueueConfig {
    label: string,
    threshold: number,
    thresholdLabel: string
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
                    threshold: queueConfig.threshold,
                    thresholdLabel: queueConfig.thresholdLabel
                }
            });
        }
        this.lastActive = {};
        this.counterMax = config.counterMax;
    }

    /**
     * Adds the given player to the composite player queue.
     * By default, the player is added at the end of the lowest queue.
     * @param rsn RSN of the player to add
     * @returns True if the player was added (false implies the player was already in the queue)
     */
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

    /**
     * Get the size of a particular queue.
     */
    getQueueSize(index: number): number {
        return this.queues[index].queue.size();
    }

    /**
     * Get the number of queues that the composite player queue uses.
     */
    getNumQueues(): number {
        return this.queues.length;
    }

    /**
     * Determines if the provided queue index represents the lowest queue.
     * @param index Index of the queue we're checking for
     * @returns True if the index represents the lowest queue
     */
    private isLowestQueue(index: number): boolean {
        return index === this.getNumQueues() - 1;
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
            }
            // void logger.log(`[Q${i}] ${queue.counter}/${this.getQueueCounterMax(i)} -> ${rsn}`, MultiLoggerLevel.Trace);
            return rsn;
        }
        // Emergency fallback logging
        const queuesMetadata = this.queues.map(q => {
            return {
                label: q.config.label,
                size: q.queue.size(),
                counter: q.counter
            };
        });
        void logger.log(`Went through all queues without returning anything: \`${JSON.stringify(queuesMetadata)}\``, MultiLoggerLevel.Error);
    }

    /**
     * Updates the player's activity timestamp, which may result in them being shifted to a higher queue.
     * When shifted to a new queue, the player is added to the end of that queue.
     * Note that this method will _never_ shift a player to a lower queue (this only happens in the `#next()` method).
     * @param rsn Player whose activity timestamp is being updated
     * @param timestamp The player's new activity timestamp (or right now if none is provided)
     */
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
    }

    private getLastActive(rsn: string): number {
        return this.lastActive[rsn] ?? 0;
    }

    hasActivityTimestamp(rsn: string): boolean {
        return rsn in this.lastActive;
    }

    getTimeSinceLastActive(rsn: string): number {
        return new Date().getTime() - this.getLastActive(rsn);
    }

    /**
     * For a given player, return the label of the queue they're currently on (or "N/A" if on none).
     */
    getContainingQueueLabel(rsn: string): string {
        for (const queue of this.queues) {
            if (queue.queue.contains(rsn)) {
                return queue.config.label;
            }
        }
        return 'N/A';
    }

    /**
     * @returns Number of players in each queue
     */
    getNumPlayersByQueue(): number[] {
        return this.queues.map(queue => queue.queue.size());
    }

    /**
     * For a given queue, determine how many times we'll need to poll from the composite queue before this particular queue is fully traversed.
     * @param index Index of the queue we're checking for
     * @returns Number of iterations of the composite player queue
     */
    getNumIterationsForQueue(index: number): number {
        const queueSize = this.queues[index].queue.size();
        // For the current queue, we will need to go through the entire thing to reach a particular player
        let numIterations = queueSize;
        // If this isn't the lowest queue, we'll also have to dedicate ocassional visits to lower queues
        if (!this.isLowestQueue(index)) {
            numIterations += Math.floor(queueSize / this.getQueueCounterMax(index));
        }
        // For each higher queue, we will need to loop up to the counter max before we can return to this queue
        for (let i = 0; i < index; i++) {
            numIterations *= this.getQueueCounterMax(i) + 1;
        }
        return numIterations;
    }

    /**
     * For a given queue, determine how long it'll take to fully traverse it once.
     * @param index Index of the queue we're checking for
     * @returns Duration (in milliseconds) to fully traverse the queue
     */
    getQueueDuration(index: number): number {
        // Given the total number of iterations to fully traverse this queue once, multiply by the refresh interval to compute total time
        return this.getNumIterationsForQueue(index) * timer.getEffectiveRefreshInterval();
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
            return `**${queue.queue.size()}** ${queue.config.label}`;
        }));
    }

    getLabeledDurationStrings(): { label: string, thresholdLabel: string, duration: string }[] {
        return this.queues.map((queue, index) => {
            return {
                label: queue.config.label,
                thresholdLabel: queue.config.thresholdLabel,
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