import { expect } from 'chai';
import { randInt } from 'evanw555.js';
import PGStorageClient from '../src/pg-storage-client';
import { MiscPropertyName } from '../src/types';

describe('PGStorageClient Tests', () => {
    /*
        # Required setup for these tests:

        sudo -u postgres psql
        CREATE DATABASE scape_bot_test;
        CREATE USER tester;
    */
    const pgStorageClient: PGStorageClient = new PGStorageClient({
        host: 'localhost',
        port: 5432,
        database: 'scape_bot_test',
        user: 'tester'
    });

    before(async () => {
        try {
            await pgStorageClient.connect();
        } catch (err) {
            throw new Error(err + ' (Have you set up a local PG server with database "scape_bot_test" and user "tester"?)');
        }

        expect(pgStorageClient.toString()).equals('PGStorageClient@localhost:5432');

        await pgStorageClient.initializeTables();
    });

    it('can read and write weekly XP snapshots', async () => {
        const value1 = randInt(0, 1000);
        const value2 = randInt(0, 1000);

        await pgStorageClient.writeWeeklyXpSnapshots({ player1: value1, player2: value2 });

        const results2 = await pgStorageClient.fetchWeeklyXpSnapshots();
        expect(results2.player1).equals(value1);
        expect(results2.player2).equals(value2);
    });

    it('can read and write player skills', async () => {
        const cookingLevel = randInt(1, 99);
        await pgStorageClient.writePlayerLevels('player1', { cooking: cookingLevel });

        const results = await pgStorageClient.fetchAllPlayerLevels();

        expect('player1' in results).true;
        expect(results.player1.cooking).equals(cookingLevel);
    });

    it('can read and write player bosses', async () => {
        const hesporiScore = randInt(1, 99);
        await pgStorageClient.writePlayerBosses('player1', { hespori: hesporiScore });

        const results = await pgStorageClient.fetchAllPlayerBosses();

        expect('player1' in results).true;
        expect(results.player1.hespori).equals(hesporiScore);
    });

    it('can read and write player clues', async () => {
        const masterScore = randInt(1, 99);
        await pgStorageClient.writePlayerClues('player1', { master: masterScore });

        const results = await pgStorageClient.fetchAllPlayerClues();

        expect('player1' in results).true;
        expect(results.player1.master).equals(masterScore);
    });

    it('can add and remove tracked players', async () => {
        await pgStorageClient.deleteTrackedPlayer('12345', 'player1');
        await pgStorageClient.deleteTrackedPlayer('12345', 'player2');

        const results = await pgStorageClient.fetchAllTrackedPlayers();
        expect(Object.keys(results).length).equals(0);

        await pgStorageClient.insertTrackedPlayer('12345', 'player1');
        await pgStorageClient.insertTrackedPlayer('12345', 'player2');

        const results2 = await pgStorageClient.fetchAllTrackedPlayers();
        expect(Object.keys(results2).length).equals(1);
        expect('12345' in results2).true;
        expect(results2['12345'].length).equals(2);

        await pgStorageClient.deleteTrackedPlayer('12345', 'player2');
        const results3 = await pgStorageClient.fetchAllTrackedPlayers();
        expect(Object.keys(results3).length).equals(1);
        expect('12345' in results3).true;
        expect(results3['12345'].length).equals(1);
    });

    it('can update tracking channels', async () => {
        const trackingChannelId = randInt(1000, 5000).toString();
        await pgStorageClient.updateTrackingChannel('12345', trackingChannelId);

        const results = await pgStorageClient.fetchAllTrackingChannels();
        expect('12345' in results).true;
        expect(results['12345']).equals(trackingChannelId);
    });

    it('can read and write player hi-score statuses', async () => {
        await pgStorageClient.writePlayerHiScoreStatus('player1', true);
        await pgStorageClient.writePlayerHiScoreStatus('player2', false);
        await pgStorageClient.writePlayerHiScoreStatus('player3', false);

        const onHiScores = await pgStorageClient.fetchAllPlayersWithHiScoreStatus(true);
        const offHiScores = await pgStorageClient.fetchAllPlayersWithHiScoreStatus(false);

        expect(onHiScores.sort().join(',')).equals('player1');
        expect(offHiScores.sort().join(',')).equals('player2,player3');

        await pgStorageClient.writePlayerHiScoreStatus('player1', false);
        await pgStorageClient.writePlayerHiScoreStatus('player3', true);

        const onHiScores2 = await pgStorageClient.fetchAllPlayersWithHiScoreStatus(true);
        const offHiScores2 = await pgStorageClient.fetchAllPlayersWithHiScoreStatus(false);

        expect(onHiScores2.sort().join(',')).equals('player3');
        expect(offHiScores2.sort().join(',')).equals('player1,player2');
    });

    it('can read and write bot counters', async () => {
        const counterValue = randInt(1, 100);
        await pgStorageClient.writeBotCounter('55555', counterValue);

        const result = await pgStorageClient.fetchBotCounters();
        expect('55555' in result).true;
        expect(result['55555']).equals(counterValue);
    });

    it('can read and write misc properties', async () => {
        await pgStorageClient.writeMiscProperty('disabled', 'true');
        expect(await pgStorageClient.fetchMiscProperty('disabled')).equals('true');
        await pgStorageClient.writeMiscProperty('disabled', 'false');
        expect(await pgStorageClient.fetchMiscProperty('disabled')).equals('false');

        // Missing properties should simply be returned as an explicit null
        expect(await pgStorageClient.fetchMiscProperty('invalid_property_name' as MiscPropertyName)).is.null;
    });
});