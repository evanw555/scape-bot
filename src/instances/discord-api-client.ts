import DiscordApiClient from '../discord-api-client';

import { AUTH } from '../constants';

// Export global Discord API client singleton
const discordApiClient: DiscordApiClient = new DiscordApiClient(AUTH.clientId, AUTH.clientSecret);
discordApiClient.setScope('applications.commands.permissions.update');
export default discordApiClient;
