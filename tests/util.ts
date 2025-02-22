import { expect } from 'chai';
import { diffPassesMilestone } from '../src/util';

describe('Util Tests', () => {
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
});