/* eslint-disable @typescript-eslint/no-var-requires */
const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const AUTH = require('../config/auth.json');

const commands = [
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Replies with pong!'),
    new SlashCommandBuilder()
        .setName('track')
        .setDescription('Tracks a player and gives updates when they level up')
        .addStringOption(option =>
            option
                .setName('username')
                .setDescription('Username')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('remove')
        .setDescription('Stops tracking a player')
        .addStringOption(option =>
            option
                .setName('username')
                .setDescription('Username')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Stops tracking all players')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName('list')
        .setDescription('Lists all the players currently being tracked'),
    new SlashCommandBuilder()
        .setName('check')
        .setDescription('Shows the current levels for some player')
        .addStringOption(option =>
            option
                .setName('username')
                .setDescription('Username')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('channel')
        .setDescription('All the player updates will be sent to the channel where this command is issued')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
];

const rest = new REST({ version: '10' }).setToken(AUTH.token);

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
