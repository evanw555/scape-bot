import { expect } from 'chai';
import { randInt } from 'evanw555.js';
import PGStorageClient from '../src/pg-storage-client';
import { GuildSetting, MiscPropertyName } from '../src/types';

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
        user: 'tester',
        password: 'tester'
    });

    before(async () => {
        // Before the entire test suite, connect the PG storage client
        try {
            await pgStorageClient.connect();
        } catch (err) {
            throw new Error(err + ' (Have you set up a local PG server with database "scape_bot_test" and user "tester"?)');
        }

        expect(pgStorageClient.toString()).equals('PGStorageClient@localhost:5432');

        // Initialize all tables and assert that they exist
        await pgStorageClient.initializeTables();
        console.log('ALL');
    });

    beforeEach(async () => {
        // Clear rows from all tables before each test method
        for (const table of pgStorageClient.getTableNames()) {
            await pgStorageClient.clearTable(table);
        }
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

    it('can read and write player activities', async () => {
        const riftsClosedScore = randInt(1, 99);
        await pgStorageClient.writePlayerActivities('player1', { riftsClosed: riftsClosedScore });

        const results = await pgStorageClient.fetchAllPlayerActivities();

        expect('player1' in results).true;
        expect(results.player1.riftsClosed).equals(riftsClosedScore);

        const colosseumGloryScore = randInt(1, 99);
        await pgStorageClient.writePlayerActivities('player1', { colosseumGlory: colosseumGloryScore });

        const results1 = await pgStorageClient.fetchAllPlayerActivities();
        expect('player1' in results1).true;
        expect(results1.player1.colosseumGlory).equals(colosseumGloryScore);
    });

    it('can read and write pending player updates', async () => {
        const results = await pgStorageClient.fetchPendingPlayerUpdates('player1');
        expect(results.length).equals(0);

        // Write some basic entries for 2 guilds
        await pgStorageClient.writePendingPlayerUpdates([
            { guildId: '123', rsn: 'player1', type: 0, key: 'fishing', baseValue: 10, newValue: 11 },
            { guildId: '456', rsn: 'player1', type: 0, key: 'fishing', baseValue: 10, newValue: 11 },
            { guildId: '456', rsn: 'player2', type: 2, key: 'elite', baseValue: 1, newValue: 2 },
            { guildId: '789', rsn: 'player3', type: 1, key: 'kalphiteQueen', baseValue: 50, newValue: 64 }
        ]);

        // Fetch them
        const results2 = await pgStorageClient.fetchPendingPlayerUpdates('player1');
        expect(results2.length).equals(2);

        // Append to these pending updates
        await pgStorageClient.writePendingPlayerUpdates([
            { guildId: '123', rsn: 'player1', type: 0, key: 'fishing', baseValue: 11, newValue: 13 },
            { guildId: '456', rsn: 'player1', type: 0, key: 'fishing', baseValue: 11, newValue: 13 }
        ]);

        // Assert that they coalesced
        const results3 = await pgStorageClient.fetchPendingPlayerUpdates('player1');
        expect(results3.length).equals(2);
        expect(results3.every(r => r.baseValue === 10)).true;
        expect(results3.every(r => r.newValue === 13)).true;

        // Simulate one update passing that guild's ruleset and being cleared
        await pgStorageClient.deletePendingPlayerUpdate({ guildId: '123', rsn: 'player1', type: 0, key: 'fishing', baseValue: 10, newValue: 13 });
        const results4 = await pgStorageClient.fetchPendingPlayerUpdates('player1');
        expect(results4.length).equals(1);
        expect(results4[0].guildId === '456');

        // Write a new update for both guilds, only one of which coalesces
        await pgStorageClient.writePendingPlayerUpdates([
            { guildId: '123', rsn: 'player1', type: 0, key: 'fishing', baseValue: 13, newValue: 17 },
            { guildId: '456', rsn: 'player1', type: 0, key: 'fishing', baseValue: 13, newValue: 17 }
        ]);

        // Assert that these are now different per guild
        const results5 = await pgStorageClient.fetchPendingPlayerUpdates('player1');
        expect(results5.length).equals(2);
        // The first guild's update uses the new base value
        const guild123Updates = results5.filter(r => r.guildId === '123');
        expect(guild123Updates.length).equals(1);
        expect(guild123Updates[0].baseValue).equals(13);
        expect(guild123Updates[0].newValue).equals(17);
        // The second guild's update coalesced with the existing one and thus uses the original base value
        const guild456Updates = results5.filter(r => r.guildId === '456');
        expect(guild456Updates.length).equals(1);
        expect(guild456Updates[0].baseValue).equals(10);
        expect(guild456Updates[0].newValue).equals(17);

        // Now, assume a rollback occurred and write a new update that doesn't cleanly coalesce
        await pgStorageClient.writePendingPlayerUpdates([
            { guildId: '123', rsn: 'player1', type: 0, key: 'fishing', baseValue: 12, newValue: 15 },
            { guildId: '456', rsn: 'player1', type: 0, key: 'fishing', baseValue: 12, newValue: 15 }
        ]);

        // Assert that the rollback affects different cases correctly
        const results6 = await pgStorageClient.fetchPendingPlayerUpdates('player1');
        expect(results6.length).equals(2);
        // The first guild's update was rolled back beyond its original base value, so the base value should be rolled back as well
        const guild123Updates2 = results6.filter(r => r.guildId === '123');
        expect(guild123Updates2.length).equals(1);
        expect(guild123Updates2[0].baseValue).equals(12);
        expect(guild123Updates2[0].newValue).equals(15);
        // The second guild's update was only partially rolled back, so use the original base value to ensure the update is partially coalesced
        const guild456Updates2 = results6.filter(r => r.guildId === '456');
        expect(guild456Updates2.length).equals(1);
        expect(guild456Updates2[0].baseValue).equals(10);
        expect(guild456Updates2[0].newValue).equals(15);

        // After all this, ensure the other updates remain in the table
        const results7 = await pgStorageClient.fetchAllPendingPlayerUpdates();
        expect(results7.length).equals(4);
    });

    it('can add and remove tracked players', async () => {
        await pgStorageClient.deleteTrackedPlayer('12345', 'player1');
        await pgStorageClient.deleteTrackedPlayer('12345', 'player2');

        const results = await pgStorageClient.fetchAllTrackedPlayersByGuild();
        expect(Object.keys(results).length).equals(0);

        await pgStorageClient.insertTrackedPlayer('12345', 'player1');
        await pgStorageClient.insertTrackedPlayer('12345', 'player2');

        const results2 = await pgStorageClient.fetchAllTrackedPlayersByGuild();
        expect(Object.keys(results2).length).equals(1);
        expect('12345' in results2).true;
        expect(results2['12345'].length).equals(2);

        await pgStorageClient.deleteTrackedPlayer('12345', 'player2');
        const results3 = await pgStorageClient.fetchAllTrackedPlayersByGuild();
        expect(Object.keys(results3).length).equals(1);
        expect('12345' in results3).true;
        expect(results3['12345'].length).equals(1);
    });

    it('can update tracking channels', async () => {
        // Expect that nothing is present on a fresh start
        const results = await pgStorageClient.fetchAllTrackingChannels();
        expect('12345' in results).false;

        // Insert new row
        const trackingChannelId = randInt(1000, 5000).toString();
        await pgStorageClient.updateTrackingChannel('12345', trackingChannelId);

        const results2 = await pgStorageClient.fetchAllTrackingChannels();
        expect('12345' in results2).true;
        expect(results2['12345']).equals(trackingChannelId);

        // Update the existing row
        const trackingChannelId2 = randInt(5000, 7000).toString();
        await pgStorageClient.updateTrackingChannel('12345', trackingChannelId2);

        const results3 = await pgStorageClient.fetchAllTrackingChannels();
        expect('12345' in results3).true;
        expect(results3['12345']).equals(trackingChannelId2);
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

    it('can read and write player total xp', async () => {
        // TODO: Add tests for this
    });

    it('can read and write player activity timestamps', async () => {
        // TODO: Add tests for this
    });

    it('can read and write bot counters', async () => {
        const counterValue = randInt(1, 100);
        await pgStorageClient.writeBotCounter('55555', counterValue);

        const result = await pgStorageClient.fetchBotCounters();
        expect('55555' in result).true;
        expect(result['55555']).equals(counterValue);
    });

    it('can read and write privileged roles', async () => {
        // Expect that nothing is present on a fresh start
        const results = await pgStorageClient.fetchAllPrivilegedRoles();
        expect('12345' in results).false;

        // Insert new row
        const roleId = randInt(1000, 5000).toString();
        await pgStorageClient.writePrivilegedRole('12345', roleId);

        const results2 = await pgStorageClient.fetchAllPrivilegedRoles();
        expect('12345' in results2).true;
        expect(results2['12345']).equals(roleId);

        // Update the existing row
        const roleId2 = randInt(5000, 7000).toString();
        await pgStorageClient.writePrivilegedRole('12345', roleId2);

        const results3 = await pgStorageClient.fetchAllPrivilegedRoles();
        expect('12345' in results3).true;
        expect(results3['12345']).equals(roleId2);
    });

    it('can read and write misc properties', async () => {
        await pgStorageClient.writeMiscProperty('disabled', 'true');
        expect(await pgStorageClient.fetchMiscProperty('disabled')).equals('true');
        await pgStorageClient.writeMiscProperty('disabled', 'false');
        expect(await pgStorageClient.fetchMiscProperty('disabled')).equals('false');

        // Missing properties should simply be returned as an explicit null
        expect(await pgStorageClient.fetchMiscProperty('invalid_property_name' as MiscPropertyName)).is.null;
    });

    it('can read and write guild settings', async () => {
        const setting = GuildSetting.BossBroadcastInterval;
        const settingValue = 1;
        await pgStorageClient.writeGuildSetting('12345', GuildSetting.BossBroadcastInterval, settingValue);
        const results = await pgStorageClient.fetchAllGuildSettings();
        expect('12345' in results).true;
        expect(setting in results['12345']).true;
        expect(results['12345'][GuildSetting.BossBroadcastInterval]).equals(settingValue);
    });

    it('can purge untracked players from other tables', async () => {
        // Insert some purgeable rows
        await pgStorageClient.writePlayerLevels('purgeMe1', { cooking: 10, crafting: 20 });
        await pgStorageClient.writePlayerClues('purgeMe1', { master: 3 });
        await pgStorageClient.writePlayerLevels('purgeMe2', { attack: 10, strength: 20, hitpoints: 30, magic: 40 });
        await pgStorageClient.writePlayerHiScoreStatus('purgeMe2', true);
        // Insert a non-purgeable row
        await pgStorageClient.insertTrackedPlayer('12345', 'keepMe1');
        await pgStorageClient.insertTrackedPlayer('12345', 'keepMe2');
        await pgStorageClient.writePlayerLevels('keepMe1', { fletching: 50, agility: 50, runecraft: 55 });
        await pgStorageClient.writePlayerBosses('keepMe1', { hespori: 5 });
        await pgStorageClient.writeWeeklyXpSnapshots({
            'purgeMe1': 100,
            'purgeMe2': 300,
            'purgeMe3': 500,
            'keepMe1': 600,
            'keepMe2': 700
        });

        // Expect that only rows for the purgeable players were deleted
        const result2 = await pgStorageClient.purgeUntrackedPlayerData();
        expect(result2['player_levels']).equals(6);
        expect('player_bosses' in result2).false;
        expect(result2['player_clues']).equals(1);
        expect(result2['player_hiscore_status']).equals(1);
        expect(result2['weekly_xp_snapshots']).equals(3);

        // A subsequent invocation should result in no deletions
        const result = await pgStorageClient.purgeUntrackedPlayerData();
        expect(Object.keys(result).length).equals(0);
    });

    it('can purge guild data', async () => {
        // Insert some rows to purge
        await pgStorageClient.updateTrackingChannel('12345', '111');
        await pgStorageClient.writePrivilegedRole('12345', '222');
        await pgStorageClient.insertTrackedPlayer('12345', 'player1');
        await pgStorageClient.insertTrackedPlayer('12345', 'player2');
        // Insert some rows to keep
        await pgStorageClient.updateTrackingChannel('7890', '111');
        await pgStorageClient.insertTrackedPlayer('7890', 'player1');
        await pgStorageClient.insertTrackedPlayer('7890', 'player2');
        await pgStorageClient.insertTrackedPlayer('7890', 'player3');

        // Expect that only rows the purged guild were deleted
        const result = await pgStorageClient.purgeGuildData('12345');
        expect(result['tracking_channels']).equals(1);
        expect(result['privileged_roles']).equals(1);
        expect(result['tracked_players']).equals(2);

        const result2 = await pgStorageClient.purgeGuildData('7890');
        expect(result2['tracking_channels']).equals(1);
        expect('privileged_roles' in result2).false;
        expect(result2['tracked_players']).equals(3);
    });
});
