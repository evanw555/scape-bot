import { Snowflake } from 'discord.js';

// Keep mapping from channel logger IDs to their index in the multi-logger
const loggerIndices: Record<Snowflake, number> = {};

export default loggerIndices;