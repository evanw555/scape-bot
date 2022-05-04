import fs from 'fs';
import { AnyObject } from './types';

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

    readSync(id: string): string {
        return fs.readFileSync(this._basePath + id, this._ENCODING);
    }

    async readJson(id: string): Promise<AnyObject> {
        return JSON.parse(await this.read(id));
    }

    readJsonSync(id: string): AnyObject {
        return JSON.parse(this.readSync(id));
    }

    async write(id: string, value: AnyObject | string | number): Promise<void> {
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

export default FileStorage;
