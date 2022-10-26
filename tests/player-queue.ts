import { expect } from 'chai';
import PlayerQueue from '../src/player-queue';

describe('PlayerQueue Tests', () => {
    it('can return players circularly after adding and removing', () => {
        const queue = new PlayerQueue();

        expect(queue.next()).is.undefined;

        queue.add('a');

        // Should only see "a"
        expect(queue.next()).equals('a');
        expect(queue.next()).equals('a');
        expect(queue.next()).equals('a');
        expect(queue.toSortedArray().join('')).equals('a');

        queue.add('b');

        // Should see "a" and "b" alternating, starting with "a"
        expect(queue.next()).equals('a');
        expect(queue.next()).equals('b');
        expect(queue.next()).equals('a');
        expect(queue.next()).equals('b');
        expect(queue.next()).equals('a');
        expect(queue.toSortedArray().join('')).equals('ab');

        queue.add('c');

        // Should start on "b" since we last saw "a"
        expect(queue.next()).equals('b');
        // Should see "c" since "a" is still at the beginning
        expect(queue.next()).equals('c');
        expect(queue.next()).equals('a');
        expect(queue.next()).equals('b');
        expect(queue.next()).equals('c');
        expect(queue.next()).equals('a');
        expect(queue.toSortedArray().join('')).equals('abc');

        queue.remove('b');

        // We last saw "a" but we removed "b", so we should be on "c"
        expect(queue.next()).equals('c');
        expect(queue.next()).equals('a');
        expect(queue.next()).equals('c');
        expect(queue.toSortedArray().join('')).equals('ac');

        queue.add('b');

        // "b" is added to the end, so the order should be different now
        expect(queue.next()).equals('a');
        expect(queue.next()).equals('c');
        expect(queue.next()).equals('b');
        expect(queue.next()).equals('a');
        expect(queue.toSortedArray().join('')).equals('abc');
    });

    it('can alternate between the active and inactive queue', () => {
        const queue = new PlayerQueue();

        expect(queue.next()).is.undefined;

        queue.add('a');
        queue.add('b');
        queue.add('c');
        queue.add('d');
        queue.add('e');

        expect(queue.next()).equals('a');
        expect(queue.next()).equals('b');
        expect(queue.next()).equals('c');
        expect(queue.next()).equals('d');
        expect(queue.next()).equals('e');

        queue.markAsActive('a');

        // Counter was left at 0 (IQ), so next counter value should be 1 (AQ)
        expect(queue.next()).equals('a');
        expect(queue.next()).equals('b');
        expect(queue.next()).equals('a');
        expect(queue.next()).equals('c');
        expect(queue.next()).equals('a');
        expect(queue.next()).equals('d');
        expect(queue.next()).equals('a');
        expect(queue.next()).equals('e');
        expect(queue.next()).equals('a');

        queue.markAsActive('b');

        // Counter was left at 1 (AQ), so next value is 2 (AQ) (active queue was still pointing at "a" when "b" was added)
        expect(queue.next()).equals('a');
        // Counter is back to 0 (IQ)
        expect(queue.next()).equals('c');
        // Repeat as "b", "a", then pick from inactive queue
        expect(queue.next()).equals('b');
        expect(queue.next()).equals('a');
        expect(queue.next()).equals('d');
        expect(queue.next()).equals('b');
        expect(queue.next()).equals('a');
        expect(queue.next()).equals('e');
        expect(queue.next()).equals('b');
        expect(queue.next()).equals('a');
        expect(queue.next()).equals('c');

        queue.add('f');
        queue.markAsActive('f');

        // Counter was left at 0 (IQ), so next value is 1 (AQ) (active queue last looked at "a")
        expect(queue.next()).equals('b');
        // Counter is now at 2 (AQ), but "f" is after "b" in the active queue
        expect(queue.next()).equals('f');
        // Counter is now at 3 (AQ)
        expect(queue.next()).equals('a');
        // Counter is back to 0 (IQ)
        expect(queue.next()).equals('d');
        expect(queue.next()).equals('b');
        expect(queue.next()).equals('f');
        expect(queue.next()).equals('a');
        expect(queue.next()).equals('e');
        expect(queue.next()).equals('b');
        expect(queue.next()).equals('f');
        expect(queue.next()).equals('a');
        expect(queue.next()).equals('c');
        expect(queue.next()).equals('b');
    });
});
