import * as fs from 'fs';

class FileStorage {
    readonly _basePath: string;
    readonly _ENCODING = 'utf8';

    constructor(basePath: string) {
        this._basePath = basePath;
    }

    async read(id: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            fs.readFile(this._basePath + id, this._ENCODING, (err, data) => {
                if (err) {
                    return reject(err);
                }
                resolve(data);
            });
        });
    }

    async readJson(id: string): Promise<any> {
        return JSON.parse(await this.read(id));
    }

    async write(id: string, value: any): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            fs.writeFile(this._basePath + id, value.toString(), (err) => {
                if (err) {
                    return reject(err);
                }
                resolve();
            });
        });
    }
}

module.exports = FileStorage;
