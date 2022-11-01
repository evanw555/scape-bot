import axios, { AxiosError } from 'axios';
import { DiscordAPIError } from 'discord.js';
import { MultiLoggerLevel } from 'evanw555.js';

import logger from './instances/logger';

// eslint-disable-next-line @typescript-eslint/no-explicit-any 
interface fnCallback { (...args: any[]): Promise<any> }

/**
 * Fetches and caches a bearer token for requests to Discord's API, and handles
 * refreshing that token when it expires. Currently just has a method to wrap API
 * calls to handle 401 codes.
 */
export default class DiscordApiClient {
    static DISCORD_TOKEN_ENDPOINT = 'https://discord.com/api/v10/oauth2/token';

    clientId: string;
    clientSecret: string;
    grantType = 'client_credentials';
    scope = 'identify';
    token?: string;

    constructor(clientId: string, clientSecret: string) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
    }

    setGrantType(type: string) {
        this.grantType = type;
    }

    setScope(scope: string) {
        this.scope = scope;
    }

    async fetchToken(): Promise<string> {
        try {
            const response = await axios.post(
                DiscordApiClient.DISCORD_TOKEN_ENDPOINT,
                {
                    grant_type: this.grantType,
                    scope: this.scope
                },
                {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    auth: { username: this.clientId, password: this.clientSecret }
                }
            );
            if (!response.data && typeof response.data.access_token !== 'string') {
                throw new Error(`None or invalid response data: ${response.data}`);
            }
            // Cache the token
            this.token = response.data.access_token as string;
            return this.token;
        } catch (err) {
            if (err instanceof AxiosError) {
                logger.log(`Failed with status ${err.status}: ${err.message}`, MultiLoggerLevel.Debug);
            }
            logger.log(`There was an error refreshing the bearerToken: ${err}`, MultiLoggerLevel.Error);
            throw err;
        }
    }

    refreshToken = () => this.fetchToken();

    async getToken(): Promise<string> {
        if (this.token) {
            return this.token; 
        }
        return this.fetchToken();
    }
    
    /**
     * Wraps a callback function, handling any 401 DiscordAPIError with a token
     * refresh. All other errors bubble up. If the request fails a second time,
     * the error bubbles up.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any 
    async wrapRequest(fn: fnCallback, ...args: any[]): Promise<void> {
        try {
            await fn(...args);
        } catch (err) {
            if (err instanceof DiscordAPIError && err.status == 401) {
                logger.log(`Refreshing bearer token with ${this.grantType}:${this.scope}`, MultiLoggerLevel.Warn);
                await this.refreshToken();
                // If this second attempt fails, error bubbles up
                await fn(...args);
            } else {
                throw err;
            }
        }
    }
}
