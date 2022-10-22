import { CapacityLog } from '../capacity-log';

import { CONFIG } from '../constants';

// This log specifically will hold only debug-and-above log statements
export default new CapacityLog(CONFIG.debugLog.logCapacity, CONFIG.debugLog.logMaxEntryLength, {
    timeZone: CONFIG.timeZone,
    timeStyle: 'medium'
});
