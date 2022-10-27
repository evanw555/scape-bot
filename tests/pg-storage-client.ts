import { fail } from 'assert';
import { expect } from 'chai';
import PGStorageClient from '../src/pg-storage-client';

describe('PGStorageClient Tests', () => {
    const pgStorageClient: PGStorageClient = new PGStorageClient({
        host: 'localhost',
        port: 5432,
        database: 'test'
    });

    it('can connect to PG', async () => {
        try {
            await pgStorageClient.connect();
        } catch (err) {
            fail(err + ' (Have you set up a local PG server with database "test"?)');
        }
        expect(pgStorageClient.toString()).equals('PGStorageClient@localhost:5432');
    });
});
