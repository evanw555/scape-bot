import { CapacityLog } from '../capacity-log';

import { CONFIG } from '../constants';

// This log specifically will hold only info-and-above log statements
export default new CapacityLog(CONFIG.infoLog.logCapacity, CONFIG.infoLog.logMaxEntryLength);
