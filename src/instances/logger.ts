import { MultiLogger, MultiLoggerLevel } from 'evanw555.js';

import debugLog from './debug-log';
import infoLog from './debug-log';

// Export global logger instance
const logger: MultiLogger = new MultiLogger({ defaultLogLevel: MultiLoggerLevel.Info });

// One logger just for logging to terminal
logger.addOutput(async (text: string) => {
    console.log(text);
}, MultiLoggerLevel.Info);

// Two separate accessible in-memory capacity-limited logs
logger.addOutput(async (text: string) => {
    debugLog.push(text.replace(/\n/g, ' '));
}, MultiLoggerLevel.Debug);

logger.addOutput(async (text: string) => {
    infoLog.push(text.replace(/\n/g, ' '));
}, MultiLoggerLevel.Info);

export default logger;
