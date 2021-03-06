const config = require('./config/config.json');

class CapacityLog {
    constructor(capacity, maxEntryLength) {
        this._capacity = capacity;
        this._maxEntryLength = maxEntryLength;
        this._list = []
    }

    push(value) {
        console.log(value);
        if (this._list.length >= this._capacity) {
            this._list.shift();
        }
        const text = value.toString() || '';
        this._list.push({
            date: new Date(),
            value: text.length < this._maxEntryLength - 3 ? text : `${text.slice(0, this._maxEntryLength)}...` });
    }

    toLogArray(maxChars) {
        return this._list.map(entry => `[${entry.date.toLocaleString("en-US", {timeZone: config.timeZone})}] ${entry.value}`);
    }
};

module.exports = CapacityLog;
