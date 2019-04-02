const config = require('./config/config.json');

class CapacityLog {
    constructor(capacity) {
        this._capacity = capacity;
        this._list = []
    }

    push(value) {
        console.log(value);
        if (this._list.length >= this._capacity) {
            this._list.shift();
        }
        this._list.push({ date: new Date(), value });
    }

    toLogArray() {
        return this._list.map(entry => `[${entry.date.toLocaleString("en-US", {timeZone: config.timeZone})}] ${entry.value}`);
    }
};

module.exports = CapacityLog;
