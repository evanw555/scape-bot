import CapacityLog from "./capacity-log.js";

import { loadJson } from './load-json.js';
const config = loadJson('config/config.json');

export default new CapacityLog(config.logCapacity, config.logMaxEntryLength);
