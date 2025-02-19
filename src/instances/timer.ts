import { toFixedString } from "evanw555.js";

class Timer {
    private readonly boot: Date;

    // Interval measurement time
    private intervalStartTime: number;
    private intervalCounter: number;
    private playerUpdateCounter: number;

    constructor() {
        this.boot = new Date();
        this.intervalStartTime = new Date().getTime();
        this.intervalCounter = 1;
        this.playerUpdateCounter = 0;
    }

    getTimeSinceBoot(): number {
        return new Date().getTime() - this.boot.getTime();
    }

    resetMeasurements() {
        this.intervalStartTime = new Date().getTime();
        this.intervalCounter = 1;
        this.playerUpdateCounter = 0;
    }

    incrementIntervals() {
        this.intervalCounter++;
    }

    incrementPlayerUpdates() {
        this.playerUpdateCounter++;
    }

    getEffectiveRefreshInterval(): number {
        const totalDuration = new Date().getTime() - this.intervalStartTime;
        return Math.round(totalDuration / this.intervalCounter);
    }

    getIntervalMeasurementDebugString(): string {
        return `${this.intervalCounter} intervals since ${new Date(this.intervalStartTime).toLocaleString()} = ${this.getEffectiveRefreshInterval()}ms/interval`;
    }

    getPlayerUpdateFrequencyString(): string {
        const totalDuration = new Date().getTime() - this.intervalStartTime;
        const totalDurationMinutes = totalDuration / (1000 * 60);
        return `${this.playerUpdateCounter} player updates = ${toFixedString(this.playerUpdateCounter / totalDurationMinutes, 1)}} updates/minute`;
    }

    getIntervalsBetweenUpdatesString(): string {
        if (this.playerUpdateCounter === 0) {
            return 'N/A intervals between updates';
        }
        return `~${Math.round(this.intervalCounter / this.playerUpdateCounter)} intervals between updates`;
    }
}

const timer = new Timer();

export default timer;