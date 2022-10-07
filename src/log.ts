import CapacityLog from './capacity-log';

import { loadJson } from 'evanw555.js';
const config = loadJson('config/config.json');

export default new CapacityLog(config.logCapacity, config.logMaxEntryLength);
