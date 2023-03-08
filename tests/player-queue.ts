import { expect } from 'chai';
import PlayerQueue from '../src/player-queue';

describe('PlayerQueue Tests', () => {
    const config = {
        queues: [{
            label: 'active',
            threshold: 9999
        }, {
            label: 'inactive',
            threshold: 99999
        }, {
            label: 'archive',
            threshold: Number.POSITIVE_INFINITY
        }],
        counterMax: 5
    };
    const inactiveDate: Date = new Date(new Date().getTime() - 50000);

    it('can return players circularly after adding and removing', () => {
        const queue = new PlayerQueue(config);

        expect(queue.next()).is.undefined;

        queue.add('a');

        // Should only see "a"
        for (let i = 0; i < 20; i++) {
            expect(queue.next()).equals('a');
        }
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

    it('can alternate between 2 queues', () => {
        const queue = new PlayerQueue(config);

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

        // Active counter is still at 0, so begin with active queue
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

        // Active queue was still pointing at "a" when "b" was added, so "a" is next
        expect(queue.next()).equals('a');
        // Active queue counter has reached its max, so now pull from the RQ queue
        expect(queue.next()).equals('c');
        // Repeat as "b", "a", then pick from RQ queue
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

        // Active queue last looked at "a", so next is "b"
        expect(queue.next()).equals('b');
        // "f" is after "b" in the active queue
        expect(queue.next()).equals('f');
        // AQ counter will now reach its max of 3
        expect(queue.next()).equals('a');
        // Go back to the inactive queue
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

        // Bring the AQ up to size 6
        queue.markAsActive('c');
        queue.markAsActive('d');
        queue.markAsActive('e');

        // Prove that although the AQ size is 6, the counter is still capped at 5
        expect(queue.next()).equals('f');
        expect(queue.next()).equals('c');
        expect(queue.next()).equals('d');
        expect(queue.next()).equals('e');
        expect(queue.next()).equals(undefined);
        expect(queue.next()).equals('a');
        expect(queue.next()).equals('b');
        expect(queue.next()).equals('f');
        expect(queue.next()).equals('c');
        expect(queue.next()).equals('d');
        expect(queue.next()).equals(undefined);
        expect(queue.next()).equals('e');
    });

    it('can alternate between 3 queues', () => {
        const queue = new PlayerQueue(config);

        expect(queue.next()).is.undefined;

        // Load up AQ
        queue.add('a');
        queue.add('b');
        queue.add('c');
        queue.markAsActive('a');
        queue.markAsActive('b');
        queue.markAsActive('c');
        // Load up IQ
        queue.add('x');
        queue.add('y');
        queue.add('z');
        queue.markAsActive('x', inactiveDate);
        queue.markAsActive('y', inactiveDate);
        queue.markAsActive('z', inactiveDate);
        // Load up RQ
        queue.add('1');
        queue.add('2');
        queue.add('3');

        expect(queue.toSortedArray().join('')).equals('123abcxyz');

        // One loop through the entire IQ
        expect(queue.next()).equals('a');
        expect(queue.next()).equals('b');
        expect(queue.next()).equals('c');
        expect(queue.next()).equals('x');
        expect(queue.next()).equals('a');
        expect(queue.next()).equals('b');
        expect(queue.next()).equals('c');
        expect(queue.next()).equals('y');
        expect(queue.next()).equals('a');
        expect(queue.next()).equals('b');
        expect(queue.next()).equals('c');
        expect(queue.next()).equals('z');

        // Now, we should reach the RQ
        expect(queue.next()).equals('a');
        expect(queue.next()).equals('b');
        expect(queue.next()).equals('c');
        expect(queue.next()).equals('1');

        // Now, back to the IQ...
        expect(queue.next()).equals('a');
        expect(queue.next()).equals('b');
        expect(queue.next()).equals('c');
        expect(queue.next()).equals('x');
        expect(queue.next()).equals('a');
        expect(queue.next()).equals('b');
        expect(queue.next()).equals('c');
        expect(queue.next()).equals('y');

        expect(queue.getDurationString()).equals('');
    });

    it('can shift players down multiple levels', () => {
        const queue = new PlayerQueue(config);

        expect(queue.next()).is.undefined;

        queue.add('a');
        queue.add('b');
        queue.add('c');
        queue.add('x');
        queue.add('y');
        queue.add('z');
        queue.add('1');
        queue.add('2');
        queue.add('3');

        // Everything is in the RQ
        expect(queue.toDelimitedString()).equals(';;1,2,3,a,b,c,x,y,z');

        queue.markAsActive('a');
        queue.markAsActive('b');
        queue.markAsActive('c');
        queue.markAsActive('x', inactiveDate);
        queue.markAsActive('y', inactiveDate);
        queue.markAsActive('z', inactiveDate);

        // Spread among AQ, IQ, and RQ
        expect(queue.toDelimitedString()).equals('a,b,c;x,y,z;1,2,3');

        // Now, mark an active player as archived
        queue.markAsActive('a', new Date(0));

        // The queues shouldn't be affected just yet...
        expect(queue.toDelimitedString()).equals('a,b,c;x,y,z;1,2,3');

        // Getting "a" from the AQ should shift it down one queue
        expect(queue.next()).equals('a');
        expect(queue.toDelimitedString()).equals('b,c;a,x,y,z;1,2,3');

        // We have to poll quite a few times to get to the end of the IQ and visit "a" again
        expect(queue.next()).equals('b');
        expect(queue.next()).equals('x');
        expect(queue.next()).equals('c');
        expect(queue.next()).equals('b');
        expect(queue.next()).equals('y');
        expect(queue.next()).equals('c');
        expect(queue.next()).equals('b');
        expect(queue.next()).equals('z');
        expect(queue.next()).equals('c');
        expect(queue.next()).equals('b');

        // It should now be shifted down once again to the RQ
        expect(queue.next()).equals('a');
        expect(queue.toDelimitedString()).equals('b,c;x,y,z;1,2,3,a');

        // Try shifting down from the AQ to just the IQ
        queue.markAsActive('b', inactiveDate);
        expect(queue.toDelimitedString()).equals('b,c;x,y,z;1,2,3,a');
        expect(queue.next()).equals('c');
        expect(queue.next()).equals('b');
        expect(queue.toDelimitedString()).equals('c;b,x,y,z;1,2,3,a');
        expect(queue.next()).equals('1');
        expect(queue.next()).equals('c');
        expect(queue.next()).equals('x');
        expect(queue.next()).equals('c');
        expect(queue.next()).equals('y');
        expect(queue.next()).equals('c');
        expect(queue.next()).equals('z');
        expect(queue.next()).equals('c');

        // Despite the fact that we've visited "b", it doesn't move because it's in the appropriate queue
        expect(queue.next()).equals('b');
        expect(queue.toDelimitedString()).equals('c;b,x,y,z;1,2,3,a');

        // Mark some stuff as active to find that the queues are all immediately affected
        queue.markAsActive('a');
        queue.markAsActive('b');
        queue.markAsActive('z');
        queue.markAsActive('3');
        expect(queue.toDelimitedString()).equals('3,a,b,c,z;x,y;1,2');
    });
});
