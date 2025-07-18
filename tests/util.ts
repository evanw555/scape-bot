import { expect } from 'chai';
import { computeDiff, computeLevelForXp, diffPassesMilestone } from '../src/util';
import { NegativeDiffError } from '../src/types';

describe('Util Tests', () => {
    it('computes diffs correctly', () => {
        // Standard cases
        expect(JSON.stringify(computeDiff({ a: 1, b: 1 }, { a: 2, b: 3 }, 1))).equals('{"a":1,"b":2}')
        expect(JSON.stringify(computeDiff({ a: 5, b: 6, c: 10, d: 15 }, { a: 5, b: 7, c: 30, d: 15 }, 1))).equals('{"b":1,"c":20}')

        // Cases where the "before" value might be missing
        expect(JSON.stringify(computeDiff({ }, { a: 2, b: 3 }, 1))).equals('{"a":1,"b":2}')
        expect(JSON.stringify(computeDiff({ a: 5 }, { a: 5, b: 7 }, 1))).equals('{"b":6}')

        // Cases with a negative diff
        expect(() => computeDiff({ a: 10, b: 10 }, { a: 12, b: 9 }, 1)).throws(NegativeDiffError, 'Negative **b** diff: `9 - 10 = -1`');
        expect(() => computeDiff({ a: 10, b: 10, c: 10 }, { a: 12, b: 9, c: 8 }, 1)).throws(NegativeDiffError, 'Negative **b** diff: `9 - 10 = -1`');

        // Cases with a negative diff because the "after" is missing
        expect(() => computeDiff({ a: 20, b: 20, c: 20 }, { a: 22, b: 20 }, 0)).throws(NegativeDiffError, 'Negative **c** diff: `0 - 20 = -20`');
        expect(() => computeDiff({ a: 126, b: 101 }, { c: 130 }, 99)).throws(NegativeDiffError, 'Negative **a** diff: `99 - 126 = -27`');

        // Cases with invalid values
        expect(() => computeDiff({ a: 1 }, { a: NaN }, 1)).throws(Error, 'Invalid **a** diff, `NaN` minus `1` is `NaN`');

        // Cases that fail silently because negative diffs to 1 indicate that the user has fallen off the hiscores
        // TODO: Should this be patched out? It's weird
        expect(() => computeDiff({ a: 10 }, { a: 1 }, 1)).throws(Error, '');
        expect(() => computeDiff({ a: 10 }, { }, 1)).throws(Error, '');
    });

    it('determines if an update diff passes an interval milestone', () => {
        // 1-interval
        expect(diffPassesMilestone(1, 2, 1), 'Update 1-to-2 passes 1-interval milestone').is.true;
        expect(diffPassesMilestone(3, 4, 1), 'Update 3-to-4 passes 1-interval milestone').is.true;
        expect(diffPassesMilestone(9, 11, 1), 'Update 9-to-11 passes 1-interval milestone').is.true;
        expect(diffPassesMilestone(33, 99, 1), 'Update 33-to-99 passes 1-interval milestone').is.true;
        expect(diffPassesMilestone(1, 1, 1), 'Update 1-to-1 does NOT pass 1-interval milestone').is.false;
        expect(diffPassesMilestone(11, 10, 1), 'Update 11-to-10 does NOT pass 1-interval milestone').is.false;

        // 2-interval
        expect(diffPassesMilestone(1, 2, 2), 'Update 1-to-2 passes 2-interval milestone').is.true;
        expect(diffPassesMilestone(1, 3, 2), 'Update 1-to-3 passes 2-interval milestone').is.true;
        expect(diffPassesMilestone(2, 3, 2), 'Update 1-to-2 does NOT pass 2-interval milestone').is.false;
        expect(diffPassesMilestone(1, 4, 2), 'Update 1-to-4 passes 2-interval milestone').is.true;
        expect(diffPassesMilestone(2, 4, 2), 'Update 2-to-4 passes 2-interval milestone').is.true;
        expect(diffPassesMilestone(3, 4, 2), 'Update 3-to-4 passes 2-interval milestone').is.true;
        expect(diffPassesMilestone(4, 5, 2), 'Update 4-to-5 does NOT pass 2-interval milestone').is.false;
        expect(diffPassesMilestone(33, 99, 2), 'Update 33-to-99 passes 2-interval milestone').is.true;
        expect(diffPassesMilestone(10, 10, 2), 'Update 10-to-10 does NOT pass 2-interval milestone').is.false;
        expect(diffPassesMilestone(10, 9, 2), 'Update 10-to-9 does NOT pass 2-interval milestone').is.false;
        expect(diffPassesMilestone(10, 8, 2), 'Update 10-to-8 does NOT pass 2-interval milestone').is.false;

        // 3-interval
        expect(diffPassesMilestone(1, 2, 3), 'Update 1-to-2 does NOT pass 3-interval milestone').is.false;
        expect(diffPassesMilestone(1, 3, 3), 'Update 1-to-3 passes 3-interval milestone').is.true;
        expect(diffPassesMilestone(1, 4, 3), 'Update 1-to-4 passes 3-interval milestone').is.true;
        expect(diffPassesMilestone(2, 3, 3), 'Update 2-to-3 passes 3-interval milestone').is.true;
        expect(diffPassesMilestone(3, 4, 3), 'Update 3-to-4 does NOT pass 3-interval milestone').is.false;
        expect(diffPassesMilestone(3, 5, 3), 'Update 3-to-5 does NOT pass 3-interval milestone').is.false;
        expect(diffPassesMilestone(3, 6, 3), 'Update 3-to-5 passes 3-interval milestone').is.true;
        expect(diffPassesMilestone(33, 99, 3), 'Update 33-to-99 passes 3-interval milestone').is.true;
        expect(diffPassesMilestone(10, 10, 3), 'Update 10-to-10 does NOT pass 3-interval milestone').is.false;
        expect(diffPassesMilestone(10, 9, 3), 'Update 10-to-9 does NOT pass 3-interval milestone').is.false;
        expect(diffPassesMilestone(10, 8, 3), 'Update 10-to-8 does NOT pass 3-interval milestone').is.false;
        expect(diffPassesMilestone(10, 7, 3), 'Update 10-to-8 does NOT pass 3-interval milestone').is.false;

        // 5-interval
        expect(diffPassesMilestone(1, 2, 5), 'Update 1-to-2 does NOT pass 5-interval milestone').is.false;
        expect(diffPassesMilestone(1, 3, 5), 'Update 1-to-3 does NOT pass 5-interval milestone').is.false;
        expect(diffPassesMilestone(1, 4, 5), 'Update 1-to-4 does NOT pass 5-interval milestone').is.false;
        expect(diffPassesMilestone(1, 5, 5), 'Update 1-to-5 passes 5-interval milestone').is.true;
        expect(diffPassesMilestone(1, 6, 5), 'Update 1-to-6 passes 5-interval milestone').is.true;
        expect(diffPassesMilestone(3, 9, 5), 'Update 3-to-9 passes 5-interval milestone').is.true;
        expect(diffPassesMilestone(5, 6, 5), 'Update 5-to-6 does NOT pass 5-interval milestone').is.false;
        expect(diffPassesMilestone(5, 9, 5), 'Update 5-to-9 does NOT pass 5-interval milestone').is.false;
        expect(diffPassesMilestone(5, 10, 5), 'Update 5-to-10 passes 5-interval milestone').is.true;
        expect(diffPassesMilestone(5, 21, 5), 'Update 5-to-21 passes 5-interval milestone').is.true;
        expect(diffPassesMilestone(33, 99, 5), 'Update 33-to-99 passes 5-interval milestone').is.true;
        expect(diffPassesMilestone(10, 10, 5), 'Update 10-to-10 does NOT pass 5-interval milestone').is.false;
        expect(diffPassesMilestone(10, 9, 5), 'Update 10-to-9 does NOT pass 5-interval milestone').is.false;
        expect(diffPassesMilestone(10, 5, 5), 'Update 10-to-5 does NOT pass 5-interval milestone').is.false;
        expect(diffPassesMilestone(10, 1, 5), 'Update 10-to-1 does NOT pass 5-interval milestone').is.false;

        // 10-interval
        expect(diffPassesMilestone(1, 9, 10), 'Update 1-to-9 does NOT pass 10-interval milestone').is.false;
        expect(diffPassesMilestone(10, 19, 10), 'Update 10-to-19 does NOT pass 10-interval milestone').is.false;
        expect(diffPassesMilestone(11, 20, 10), 'Update 11-to-20 passes 10-interval milestone').is.true;
        expect(diffPassesMilestone(11, 29, 10), 'Update 11-to-29 passes 10-interval milestone').is.true;
        expect(diffPassesMilestone(13, 51, 10), 'Update 13-to-51 passes 10-interval milestone').is.true;
        expect(diffPassesMilestone(51, 55, 10), 'Update 51-to-55 does NOT pass 10-interval milestone').is.false;
        expect(diffPassesMilestone(33, 99, 10), 'Update 33-to-99 passes 10-interval milestone').is.true;
        expect(diffPassesMilestone(20, 20, 10), 'Update 20-to-20 does NOT pass 10-interval milestone').is.false;
        expect(diffPassesMilestone(20, 19, 10), 'Update 20-to-19 does NOT pass 10-interval milestone').is.false;
        expect(diffPassesMilestone(20, 15, 10), 'Update 20-to-15 does NOT pass 10-interval milestone').is.false;
        expect(diffPassesMilestone(20, 10, 10), 'Update 20-to-10 does NOT pass 10-interval milestone').is.false;
        expect(diffPassesMilestone(20, 1, 10), 'Update 20-to-1 does NOT pass 10-interval milestone').is.false;

        // 13-interval
        expect(diffPassesMilestone(1, 12, 13), 'Update 1-to-12 does NOT pass 13-interval milestone').is.false;
        expect(diffPassesMilestone(13, 25, 13), 'Update 13-to-25 does NOT pass 13-interval milestone').is.false;
        expect(diffPassesMilestone(26, 38, 13), 'Update 13-to-25 does NOT pass 13-interval milestone').is.false;
        expect(diffPassesMilestone(37, 39, 13), 'Update 37-to-39 passes 13-interval milestone').is.true;
        expect(diffPassesMilestone(33, 99, 13), 'Update 33-to-99 passes 13-interval milestone').is.true;
        expect(diffPassesMilestone(50, 50, 13), 'Update 50-to-50 does NOT pass 13-interval milestone').is.false;
        expect(diffPassesMilestone(50, 49, 13), 'Update 50-to-49 does NOT pass 13-interval milestone').is.false;
        expect(diffPassesMilestone(50, 1, 13), 'Update 50-to-1 does NOT pass 13-interval milestone').is.false;
    });

    it ('computes virtual levels correctly', () => {
        expect(computeLevelForXp(0)).equals(1);
        expect(computeLevelForXp(82)).equals(1);
        expect(computeLevelForXp(83)).equals(2);
        expect(computeLevelForXp(84)).equals(2);
        expect(computeLevelForXp(1000)).equals(9);
        expect(computeLevelForXp(4470)).equals(20);
        expect(computeLevelForXp(10_000)).equals(27);
        expect(computeLevelForXp(100_000)).equals(49);
        expect(computeLevelForXp(1_000_000)).equals(73);
        expect(computeLevelForXp(10_000_000)).equals(96);
        expect(computeLevelForXp(13_034_430)).equals(98);
        expect(computeLevelForXp(13_034_431)).equals(99);
        expect(computeLevelForXp(15_000_000)).equals(100);
        expect(computeLevelForXp(100_000_000)).equals(119);
        expect(computeLevelForXp(150_000_000)).equals(123);
        expect(computeLevelForXp(200_000_000)).equals(126);
        expect(computeLevelForXp(2_000_000_000)).equals(126);
    });
});