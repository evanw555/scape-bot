const fs = require('fs');

const ENCODING = 'utf8';

class Storage {
    constructor(basePath) {
        this._basePath = basePath;
    }

    async read(id) {
        return new Promise((resolve, reject) => {
            fs.readFile(this._basePath + id, ENCODING, (err, data) => {
                if (err) {
                    return reject(err);
                }
                resolve(data);
            });
        });
    }

    async readJson(id) {
        return JSON.parse(await this.read(id));
    }

    async write(id, value) {
        return new Promise((resolve, reject) => {
            fs.writeFile(this._basePath + id, value.toString(), (err) => {
                if (err) {
                    return reject(err);
                }
                resolve();
            });
        });
    }
}

module.exports = Storage;
