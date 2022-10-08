import { MultiLogger } from 'evanw555.js';

import capacityLog from './capacity-log';

const logger: MultiLogger = new MultiLogger();
logger.addOutput(async (text: string ) => {
    capacityLog.push(text);
});

export default logger;
