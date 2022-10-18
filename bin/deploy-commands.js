/* eslint-disable @typescript-eslint/no-var-requires */
const { ApplicationCommandOptionType } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const AUTH = require('../config/auth.json');

const commands = [
    {
        name: 'ping',
        description: 'Replies with pong!'
    },
    {
        name: 'track',
        description: 'Tracks a player and gives updates when they level up',
        options: [{
            name: 'username',
            description: 'Username',
            type: ApplicationCommandOptionType.String,
            required: true
        }]
    },
    {
        name: 'remove',
        description: 'Stops tracking a player',
        options: [{
            name: 'username',
            description: 'Username',
            type: ApplicationCommandOptionType.String,
            required: true
        }]
    },
    {
        name: 'clear',
        description: 'Stops tracking all players'
    },
    {
        name: 'list',
        description: 'Lists all the players currently being tracked'
    },
    {
        name: 'check',
        description: 'Show the current levels for some player',
        options: [{
            name: 'username',
            description: 'Username',
            type: ApplicationCommandOptionType.String,
            required: true
        }]
    },
    {
        name: 'channel',
        description: 'All player updates will be sent to the channel where this command is issued'
    }
];

const rest = new REST({ version: '9' }).setToken(AUTH.token);

const GUILD_ID = AUTH.guildId;
const CLIENT_ID = AUTH.clientId;

(async function() {
    try {
        if (!CLIENT_ID) {
            throw new Error('Client ID is required to deploy commands, aborting');
        }
        const SET_COMMANDS_ROUTE = GUILD_ID
            ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
            : Routes.applicationCommands(CLIENT_ID);
        await console.log(`Refreshing application (/) commands${GUILD_ID ? ` for guild ${GUILD_ID}` : ''}`);
        await rest.put(SET_COMMANDS_ROUTE, { body: commands });
        process.exit();
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
})();