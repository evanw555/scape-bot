import { Snowflake, TextChannel } from 'discord.js';

export default {
    // TODO: Remove once this feature is fully rolled out
    /** Channels that should receive player updates using the temporary pending player update logic, by guild ID. */
    pendingUpdateTestingChannels: {} as Record<Snowflake, TextChannel>
};