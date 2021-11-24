const config = require('../config/config.json');

interface LogEntry {
    date: Date;
    value: string;
}

class CapacityLog {
    readonly _capacity: number;
    readonly _maxEntryLength: number;
    readonly _list: LogEntry[];

    constructor(capacity: number, maxEntryLength: number) {
        this._capacity = capacity;
        this._maxEntryLength = maxEntryLength;
        this._list = []
    }

    /**
     * Pushes a new message onto the log.
     * @param value new message
     */
    push(value: string): void {
        console.log(value);
        if (this._list.length >= this._capacity) {
            this._list.shift();
        }
        const text = value.toString() || '';
        this._list.push({
            date: new Date(),
            value: text.length < this._maxEntryLength - 3 ? text : `${text.slice(0, this._maxEntryLength)}...` });
    }

    /**
     * Returns the current log represented as a list of serialized log entries.
     * @param maxChars max characters to serialize per log entry
     * @returns serialized log entries
     */
    toLogArray(maxChars: number): string[] {
        return this._list.map(entry => `[${entry.date.toLocaleString("en-US", {timeZone: config.timeZone})}] ${entry.value}`);
    }
};

module.exports = CapacityLog;