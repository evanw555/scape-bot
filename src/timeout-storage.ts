/* eslint-disable @typescript-eslint/no-explicit-any */
import { AsyncStorageInterface } from 'evanw555.js';
import { TIMEOUTS_PROPERTY } from './constants';

import pgStorageClient from './instances/pg-storage-client';

export default class TimeoutStorage implements AsyncStorageInterface {
    async read(id: string): Promise<string> {
        if (id !== TIMEOUTS_PROPERTY) {
            throw new Error(`TimeoutStorage trying to read property "${id}", expected only "${TIMEOUTS_PROPERTY}"`);
        }
        const timeouts = await pgStorageClient.fetchMiscProperty(id);
        if (timeouts) {
            return timeouts;
        }
        throw new Error('TimeoutStorage was unable to read timeouts');
    }

    async readJson(id: string): Promise<any> {
        return JSON.parse(await this.read(id));
    }

    async write(id: string, value: any): Promise<void> {
        if (id !== TIMEOUTS_PROPERTY) {
            throw new Error(`TimeoutStorage trying to write property "${id}", expected only "${TIMEOUTS_PROPERTY}"`);
        }
        if (typeof value !== 'string') {
            throw new Error('TimeoutStorage trying to write timeouts using a non-string value');
        }
        // The timeout manager will attempt to write a pretty-printed JSON string, so compact it
        const compactedSerializedJson = JSON.stringify(JSON.parse(value));
        await pgStorageClient.writeMiscProperty(id, compactedSerializedJson);
    }

}