class CircularQueue<T> {
    readonly _set: Set<T>;
    _list: T[];
    _index: number; 

    constructor() {
        this._set = new Set<T>();
        this._list = [];
        this._index = 0;
    }

    add(value: T): boolean {
        if (!this._set.has(value)) {
            this._set.add(value);
            this._list.push(value);
            return true;
        }
        return false;
    }

    addAll(values: T[]): void {
        values.forEach(this.add.bind(this));
    }

    remove(value: T): boolean {
        if (!this._set.has(value)) {
            return false;
        }

        const index = this._list.indexOf(value);
        
        if (this._index > index) {
            this._index--;
        }

        this._set.delete(value);
        this._list.splice(index, 1);

        if (this._list.length === 0) {
            this._index = 0;
        } else {
            this._index %= this._list.length;
        }

        return true;
    }

    clear(): void {
        this._set.clear();
        this._list = [];
        this._index = 0;
    }

    getNext(): T {
        if (this._list.length === 0) {
            return undefined;
        }

        const value = this._list[this._index];
        this._index = (this._index + 1) % this._list.length;
        return value;
    }

    contains(value: T): boolean {
        return this._set.has(value);
    }

    isEmpty(): boolean {
        return this._list.length === 0;
    }

    toSortedArray(): T[] {
        const array = Array.from(this._set);
        array.sort();
        return array;
    }

    toString(): string {
        return JSON.stringify(this.toSortedArray());
    }
}

export default CircularQueue;
