import CapacityLog from './capacity-log';
import { ScapeBotConfig } from './types';
import { loadJson } from 'evanw555.js';

const config: ScapeBotConfig = loadJson('config/config.json');

export default new CapacityLog(config.logCapacity, config.logMaxEntryLength);
