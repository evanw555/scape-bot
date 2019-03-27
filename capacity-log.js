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
        return this._list.map(entry => `[${entry.date.toLocaleTimeString()}] ${entry.value}`);
    }
};

module.exports = CapacityLog;
