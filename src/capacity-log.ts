interface LogEntry {
    date: Date;
    value: string;
}

export class CapacityLog {
    private readonly _capacity: number;
    private readonly _maxEntryLength: number;
    private readonly _dateFormatOptions: Intl.DateTimeFormatOptions;
    private readonly _list: LogEntry[];

    constructor(capacity: number, maxEntryLength: number, dateFormatOptions: Intl.DateTimeFormatOptions) {
        this._capacity = capacity;
        this._maxEntryLength = maxEntryLength;
        this._dateFormatOptions = dateFormatOptions;
        this._list = [];
    }

    /**
     * Pushes a new message onto the log.
     * @param value new message
     */
    push(value: string): void {
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
     * @returns serialized log entries
     */
    toLogArray(): string[] {
        return this._list.map(entry => `[${entry.date.toLocaleString('en-US', this._dateFormatOptions)}] ${entry.value}`);
    }
}
