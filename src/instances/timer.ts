class Timer {
    private readonly boot: Date;

    // Interval measurement time
    private intervalStartTime: number;
    private intervalCounter: number;

    constructor() {
        this.boot = new Date();
        this.intervalStartTime = new Date().getTime();
        this.intervalCounter = 1;
    }

    getTimeSinceBoot(): number {
        return new Date().getTime() - this.boot.getTime();
    }

    resetIntervalMeasurement() {
        this.intervalStartTime = new Date().getTime();
        this.intervalCounter = 1;
    }

    incrementIntervals() {
        this.intervalCounter++;
    }

    getEffectiveRefreshInterval(): number {
        const totalDuration = new Date().getTime() - this.intervalStartTime;
        return Math.round(totalDuration / this.intervalCounter);
    }

    getIntervalMeasurementDebugString(): string {
        return `${this.intervalCounter} intervals since ${new Date(this.intervalStartTime).toLocaleString()} = ${this.getEffectiveRefreshInterval()}ms/interval`;
    }
}

const timer = new Timer();

export default timer;