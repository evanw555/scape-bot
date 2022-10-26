import { expect } from 'chai';
import State from '../src/state';

describe('State Tests', () => {
    it('can be marked valid', () => {
        const state: State = new State();

        expect(state.isValid()).false;
        state.setValid(true);
        expect(state.isValid()).true;
    });

    it('can handle adding new players', () => {
        const state: State = new State();

        expect(state.nextTrackedPlayer()).is.undefined;
        expect(state.isTrackingPlayer('guildA', 'playerA')).false;
        expect(state.isTrackingAnyPlayers('guildA')).false;
        expect(state.isPlayerTrackedInAnyGuilds('playerA')).false;

        state.addTrackedPlayer('guildA', 'playerA');

        expect(state.isTrackingAnyPlayers('guildA')).true;
        expect(state.isTrackingAnyPlayers('guildB')).false;
        expect(state.isPlayerTrackedInAnyGuilds('playerA')).true;
        expect(state.isPlayerTrackedInAnyGuilds('playerB')).false;

        state.addTrackedPlayer('guildB', 'playerA');
        state.addTrackedPlayer('guildB', 'playerB');

        expect(state.nextTrackedPlayer()).equals('playerA');
        expect(state.nextTrackedPlayer()).equals('playerB');
        expect(state.nextTrackedPlayer()).equals('playerA');
        expect(state.isTrackingPlayer('guildA', 'playerA')).true;
        expect(state.isTrackingPlayer('guildB', 'playerA')).true;
        expect(state.isTrackingPlayer('guildA', 'playerB')).false;
        expect(state.isTrackingPlayer('guildB', 'playerB')).true;
        expect(state.isTrackingAnyPlayers('guildA')).true;
        expect(state.isTrackingAnyPlayers('guildB')).true;
        expect(state.isPlayerTrackedInAnyGuilds('playerA')).true;
        expect(state.isPlayerTrackedInAnyGuilds('playerB')).true;
        expect(state.getGuildsTrackingPlayer('playerA').join(',')).equals('guildA,guildB');
        expect(state.getGuildsTrackingPlayer('playerB').join(',')).equals('guildB');
        expect(state.getAllTrackedPlayers('guildA').join(',')).equals('playerA');
        expect(state.getAllTrackedPlayers('guildB').join(',')).equals('playerA,playerB');
    });
});
