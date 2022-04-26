import CapacityLog from './capacity-log';

import { loadJson } from './load-json';
const config = loadJson('config/config.json');

export default new CapacityLog(config.logCapacity, config.logMaxEntryLength);
