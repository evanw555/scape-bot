import { expect } from 'chai';
import State from '../src/state';

describe('State Tests', () => {
    it('does what it\'s supposed to', () => {
        const state: State = new State();
        // TODO: Fill this in!
        expect(state.isValid()).false;
    });
});
