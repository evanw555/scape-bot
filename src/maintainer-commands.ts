import { exec } from 'child_process';
import { Message, Snowflake, APIEmbed } from 'discord.js';
import { randInt, randChoice, forEachMessage, MultiLoggerLevel, getPreciseDurationString, toFixed, getUnambiguousQuantitiesWithUnits } from 'evanw555.js';
import { FORMATTED_BOSS_NAMES, BOSSES, Boss, INVALID_FORMAT_ERROR } from 'osrs-json-hiscores';
import { OTHER_ACTIVITIES, SKILLS_NO_OVERALL, CLUES_NO_ALL, GRAY_EMBED_COLOR, CONSTANTS } from './constants';
import { fetchHiScores, isPlayerNotFoundError } from './hiscores';
import { HiddenCommandsType, DailyAnalyticsLabel, PlayerHiScores, IndividualSkillName, IndividualClueType, IndividualActivityName } from './types';
import { sendUpdateMessage, isValidBoss, updatePlayer, sanitizeRSN, purgeUntrackedPlayers, fetchDisplayName, createWarningEmbed, getHelpText, getAnalyticsTrendsEmbeds, resolveHiScoresUrlTemplate } from './util';

import state from './instances/state';
import timer from './instances/timer';
import debugLog from './instances/debug-log';
import infoLog from './instances/info-log';
import logger from './instances/logger';
import loggerIndices from './instances/logger-indices';
import pgStorageClient from './instances/pg-storage-client';

const validSkills = new Set<string>(CONSTANTS.skills);

// Storing rollback-related data as volatile in-memory variables because it doesn't need to be persistent
let rollbackStaging: { rsn: string, category: 'skill' | 'boss' | 'clue' | 'activity', name: string, score: number }[] = [];
let rollbackLock = false;

const hiScoresUrlTemplate = resolveHiScoresUrlTemplate();

/**
 * These commands are accessible only to the user matching the adminUserId
 * specified in the config, and are invoked using the old command reader.
 */
export const hiddenCommands: HiddenCommandsType = {
    thumbnail: {
        fn: (msg, rawArgs, name) => {
            if (validSkills.has(name)) {
                void sendUpdateMessage([msg.channel], 'Here is the thumbnail', name, {
                    title: name
                });
            } else if (isValidBoss(name)) {
                void sendUpdateMessage([msg.channel], 'Here is the thumbnail', name, {
                    title: name
                });
            } else {
                void msg.channel.send(`**${name || '[none]'}** does not have a thumbnail`);
            }
        },
        text: 'Displays a skill or boss\' thumbnail'
    },
    thumbnail99: {
        fn: (msg, rawArgs, skill) => {
            if (validSkills.has(skill)) {
                void sendUpdateMessage([msg.channel], 'Here is the level 99 thumbnail', skill, {
                    title: skill,
                    is99: true
                });
            } else {
                void msg.channel.send(`**${skill || '[none]'}** is not a valid skill`);
            }
        },
        text: 'Displays a skill\'s level 99 thumbnail'
    },
    help: {
        fn: (msg) => {
            void msg.channel.send(getHelpText(hiddenCommands, true));
        },
        text: 'Shows help for hidden commands'
    },
    log: {
        fn: (msg) => {
            // Truncate both logs to the Discord max of 2000 characters
            void msg.channel.send(`Info Log:\n\`\`\`${infoLog.toLogArray().join('\n').replace(/`/g, '').slice(0, 1950) || 'log empty'}\`\`\``);
            void msg.channel.send(`Debug Log:\`\`\`${debugLog.toLogArray().join('\n').replace(/`/g, '').slice(0, 1950) || 'log empty'}\`\`\``);
        },
        text: 'Prints the bot\'s log'
    },
    spoofverbose: {
        fn: (msg, rawArgs) => {
            let spoofedDiff, player;
            try {
                const inputData = JSON.parse(rawArgs);
                spoofedDiff = inputData.diff;
                player = inputData.player || 'zezima';
            } catch (err) {
                if (err instanceof Error) {
                    void msg.channel.send(`\`${err.toString()}\``);
                }
                return;
            }
            void updatePlayer(player, { spoofedDiff });
        },
        text: 'Spoof an update notification using a raw JSON object {player, diff: {skills|bosses}}',
        failIfDisabled: true
    },
    spoof: {
        fn: (msg, rawArgs, player) => {
            if (player) {
                const possibleKeys = Object.keys(FORMATTED_BOSS_NAMES)
                    .concat(OTHER_ACTIVITIES)
                    .concat(SKILLS_NO_OVERALL)
                    .concat(SKILLS_NO_OVERALL); // Add it again to make it more likely (there are too many bosses)
                const numUpdates: number = randInt(1, 6);
                const spoofedDiff: Record<string, number> = {};
                for (let i = 0; i < numUpdates; i++) {
                    const randomKey: string = randChoice(...possibleKeys);
                    spoofedDiff[randomKey] = randInt(1, 4);
                }
                void updatePlayer(player, { spoofedDiff });
            } else {
                void msg.channel.send('Usage: spoof PLAYER');
            }
        },
        text: 'Spoof an update notification for some player with random skill/boss updates',
        failIfDisabled: true
    },
    admin: {
        fn: async (msg, rawArgs, subcommand) => {
            // TODO: Temp logic for subcommands can live here
            if (subcommand === 'populate_daily_analytics') {
                const messageBase = 'Populating daily analytics using log messages from this channel...';
                const replyMessage = await msg.reply(messageBase);
                const p = /now in \*?\*?(\d+)\*?\*? guilds/;
                const result: Record<string, number> = {};
                let lastReplyEdit = new Date().getTime();
                await forEachMessage(msg.channel, async (message) => {
                    if (message.author.bot) {
                        const m = message.content.match(p);
                        if (m && m[1]) {
                            const n = parseInt(m[1]);
                            const dateString = message.createdAt.toDateString();
                            result[dateString] = Math.max(result[dateString] ?? 0, n);
                            const currentTime = new Date().getTime();
                            if (currentTime - lastReplyEdit > 5000) {
                                lastReplyEdit = currentTime;
                                await replyMessage.edit(messageBase + ` (extracted from **${Object.keys(result).length}** dates, latest **${dateString}**)`);
                            }
                        }
                    }
                });
                await replyMessage.edit(`Done. Extracted **${Object.keys(result).length}** data points. Writing values to PG...`);
                // Now, write all the values
                for (const [dateString, value] of Object.entries(result)) {
                    await pgStorageClient.writeDailyAnalyticsRow(new Date(dateString), DailyAnalyticsLabel.NumGuilds, value);
                }
                await replyMessage.edit('Done. Operation complete!');
                return;
            } else if (subcommand === 'weekly_xp') {
                const guildId = msg.guildId;
                if (!guildId) {
                    await msg.reply('Send this from a valid guild!');
                    return;
                }
                const players = state.getAllTrackedPlayers(guildId);
                const previousTotalXp = await pgStorageClient.fetchWeeklyXpSnapshots();
                const diffs: Record<string, number> = {};
                for (const rsn of players) {
                    diffs[rsn] = state.getTotalXp(rsn) - (previousTotalXp[rsn] ?? 0);
                }
                players.sort((x, y) => diffs[y] - diffs[x]);
                // Format all the XP quantities first to ensure they're mutually unambiguous
                const formattedValues = getUnambiguousQuantitiesWithUnits(players.map(rsn => diffs[rsn] ?? 0));
                await msg.reply('__Current weekly XP standings__:\n' + players.filter(rsn => diffs[rsn]).map((rsn, i) => `${i + 1}. **${state.getDisplayName(rsn)}** _${formattedValues[i]}_`).join('\n'));
                return;
            }
            // Get host uptime info
            const uptimeString = await new Promise<string>((resolve) => {
                exec('uptime --pretty', (error, stdout, stderr) => {
                    if (error) {
                        resolve(error.message);
                    } else if (stderr) {
                        resolve(stderr);
                    } else {
                        resolve(stdout);
                    }
                });
            });
            // Send admin info back to user
            const numGuilds = msg.client.guilds.cache.size;
            const numCommunityGuilds = msg.client.guilds.cache.filter(g => g.features?.includes('COMMUNITY')).size;
            const numNonEnUsGuilds = msg.client.guilds.cache.filter(g => g.preferredLocale !== 'en-US').size;
            const playerQueue = state.getPlayerQueue();
            await msg.channel.send({
                content: 'Admin Information:',
                embeds: [{
                    title: 'Host Uptime',
                    description: `\`${uptimeString.trim()}\``
                }, {
                    title: 'Timer Info',
                    description: `\`${timer.getIntervalMeasurementDebugString()}\``
                        + `\n\`${timer.getPlayerUpdateFrequencyString()}\``
                        + `\n\`${timer.getIntervalsBetweenUpdatesString()}\``
                }, {
                    title: 'Queue Info',
                    description: playerQueue.getLabeledDurationStrings()
                        .map((x, i) => `**${i + 1}.** _${x.label}_: `
                            + `**${playerQueue.getQueueSize(i)}** players (${Math.floor(100 * playerQueue.getQueueSize(i) / playerQueue.size())}%), `
                            + `**${playerQueue.getNumIterationsForQueue(i)}** iterations, `
                            + `_${getPreciseDurationString(playerQueue.getQueueDuration(i))}_ est. duration`).join('\n')
                }, {
                    title: 'Largest Guilds',
                    description: state.getGuildsByPlayerCount()
                        .slice(0, 10)
                        .map((id, i) => `**${i + 1}.** _${msg.client.guilds.cache.get(id)?.name ?? '???'}_: **${state.getNumTrackedPlayers(id)}**`)
                        .join('\n')
                }, {
                    title: 'Most Tracked Players',
                    description: state.getPlayersByGuildCount()
                        .slice(0, 10)
                        .map((rsn, i) => `**${i + 1}.** _${state.getDisplayName(rsn)}_: **${state.getNumGuildsTrackingPlayer(rsn)}**`)
                        .join('\n')
                }, {
                    title: 'Misc. Information',
                    description: `- **Total XP** populated for **${state.getNumPlayerTotalXp()}** of **${state.getNumGloballyTrackedPlayers()}** players`
                        + `\n- **${state.getNumPlayersOffHiScores()}** players are off the hiscores (**${Math.floor(100 * state.getNumPlayersOffHiScores() / state.getNumGloballyTrackedPlayers())}%**)`
                        + `\n- **${numCommunityGuilds}** guilds (**${toFixed(100 * numCommunityGuilds / numGuilds)}%**) are community`
                        + `\n- **${numNonEnUsGuilds}** guilds aren't \`en-US\` (**${toFixed(100 * numNonEnUsGuilds / numGuilds)}%**)`
                },
                // TODO: This maybe can be removed since we send these out weekly
                ...await getAnalyticsTrendsEmbeds()]
            });
        },
        text: 'Show various debug data for admins'
    },
    kill: {
        fn: (msg) => {
            const phrases = [
                'Killing self',
                'Dying',
                'Dead',
                'I will die',
                'As you wish'
            ];
            const phrase: string = randChoice(...phrases);
            void msg.channel.send(`${phrase}... 💀`).then(() => {
                process.exit(1);
            });
        },
        text: 'Kills the bot'
    },
    // TODO: We need to re-enable this somehow, perhaps we can just create a view into the state object?
    // state: {
    //     fn: (msg: Message, rawArgs: string) => {
    //         // TODO: We should be a bit stricter with our type guards for state
    //         let selectedState: AnyObject = state.serialize();
    //         // We have to use rawArgs because the args are made lower-case...
    //         const selector: string = rawArgs.trim();
    //         if (selector) {
    //             // If a selector was specified, select a specific part of the state
    //             const selectors: string[] = selector.split('.');
    //             for (const s of selectors) {
    //                 if (Object.prototype.hasOwnProperty.call(selectedState, s)) {
    //                     selectedState = selectedState[s];
    //                 } else {
    //                     msg.reply(`\`${selector}\` is not a valid state selector! (failed at \`${s}\`)`);
    //                     return;
    //                 }
    //             }
    //         } else {
    //             // In case we're looking at the root state, truncate the large objects
    //             // TODO: we could make this more general
    //             selectedState.levels = `Map with ${Object.keys(selectedState.levels).length} entries, truncated to save space.`;
    //             selectedState.bosses = `Map with ${Object.keys(selectedState.bosses).length} entries, truncated to save space.`;
    //         }
    //         // Reply to the user with the state (or with an error message)
    //         msg.reply(`\`\`\`${JSON.stringify(selectedState, null, 2)}\`\`\``)
    //             .catch((reason) => {
    //                 msg.reply(`Could not serialize state:\n\`\`\`${reason.toString()}\`\`\``);
    //             });
    //     },
    //     text: 'Prints the bot\'s state',
    //     privileged: true
    // },
    enable: {
        fn: async (msg: Message) => {
            await msg.reply('Enabling the bot... If the API format is still not supported, the bot will disable itself.');
            await pgStorageClient.writeMiscProperty('disabled', 'false');
            state.setDisabled(false);
            // Reset the interval measurement data
            timer.resetMeasurements();
        },
        text: 'Enables the bot, this should be used after the bot has been disabled due to an incompatible API change'
    },
    rollback: {
        fn: async (msg: Message, rawArgs, rsnArg: string | undefined) => {
            // Optionally, support rollbacks for just one specific player
            const sanitizedRsnArg = rsnArg && sanitizeRSN(rsnArg);
            // If an arg was provided, validate that this player is tracked by some guild
            if (sanitizedRsnArg && !state.isPlayerTrackedInAnyGuilds(sanitizedRsnArg)) {
                await msg.reply(`Cannot rollback for **${sanitizedRsnArg}**, player isn't tracked by any guilds!`);
                return;
            }

            if (rollbackLock) {
                await msg.reply('Rollback in progress, try again later!');
                return;
            }
            rollbackLock = true;

            if (rollbackStaging.length === 0) {
                const playersToCheck: string[] = sanitizedRsnArg ? [sanitizedRsnArg] : state.getAllGloballyTrackedPlayers();
                let numPlayersProcessed = 0;
                const getStatusText = () => {
                    return `Checking for rollback-impacted data... **(${numPlayersProcessed}/${playersToCheck.length})**`;
                };
                const replyMessage = await msg.reply(getStatusText());
                for (const rsn of playersToCheck) {
                    numPlayersProcessed++;
                    let data: PlayerHiScores;
                    try {
                        data = await fetchHiScores(rsn);
                    } catch (err) {
                        // Ignore 404 errors
                        if (!isPlayerNotFoundError(err)) {
                            await msg.channel.send(`(Rollback) Failed to fetch hiscores for player **${rsn}**: \`${err}\``);
                        }
                        continue;
                    }
                    const logs: string[] = [];
                    for (const skill of SKILLS_NO_OVERALL) {
                        if (state.hasLevel(rsn, skill)) {
                            const before = state.getLevel(rsn, skill);
                            const after = data.levelsWithDefaults[skill];
                            if (after - before < 0) {
                                logs.push(`**${skill}** dropped from \`${before}\` to \`${after}\``);
                                rollbackStaging.push({
                                    rsn,
                                    category: 'skill',
                                    name: skill,
                                    score: after
                                });
                            }
                        }
                    }
                    for (const boss of BOSSES) {
                        if (state.hasBoss(rsn, boss)) {
                            const before = state.getBoss(rsn, boss);
                            const after = data.bossesWithDefaults[boss];
                            if (after - before < 0) {
                                logs.push(`**${boss}** dropped from \`${before}\` to \`${after}\``);
                                rollbackStaging.push({
                                    rsn,
                                    category: 'boss',
                                    name: boss,
                                    score: after
                                });
                            }
                        }
                    }
                    for (const clue of CLUES_NO_ALL) {
                        if (state.hasClue(rsn, clue)) {
                            const before = state.getClue(rsn, clue);
                            const after = data.cluesWithDefaults[clue];
                            if (after - before < 0) {
                                logs.push(`**${clue}** dropped from \`${before}\` to \`${after}\``);
                                rollbackStaging.push({
                                    rsn,
                                    category: 'clue',
                                    name: clue,
                                    score: after
                                });
                            }
                        }
                    }
                    for (const activity of OTHER_ACTIVITIES) {
                        if (state.hasActivity(rsn, activity)) {
                            const before = state.getActivity(rsn, activity);
                            const after = data.activitiesWithDefaults[activity];
                            if (after - before < 0) {
                                logs.push(`**${activity}** dropped from \`${before}\` to \`${after}\``);
                                rollbackStaging.push({
                                    rsn,
                                    category: 'activity',
                                    name: activity,
                                    score: after
                                });
                            }
                        }
                    }
                    if (logs.length > 0) {
                        await msg.channel.send(`(Rollback) Detected negatives for **${rsn}**:\n` + logs.join('\n'));
                    }
                    // Update original message
                    if (numPlayersProcessed % 5 === 0 || numPlayersProcessed === playersToCheck.length) {
                        await replyMessage.edit(getStatusText());
                    }
                }
                await msg.channel.send(`Done, use this command again to commit the **${rollbackStaging.length}** change(s) to state/PG.`);
            } else {
                await msg.channel.send(`Committing **${rollbackStaging.length}** rollback change(s) to state/PG...`);
                for (const { rsn, category, name, score } of rollbackStaging) {
                    switch (category) {
                    case 'skill':
                        state.setLevel(rsn, name as IndividualSkillName, score);
                        await pgStorageClient.writePlayerLevels(rsn, { [name]: score });
                        break;
                    case 'boss':
                        state.setBoss(rsn, name as Boss, score);
                        await pgStorageClient.writePlayerBosses(rsn, { [name]: score });
                        break;
                    case 'clue':
                        state.setClue(rsn, name as IndividualClueType, score);
                        await pgStorageClient.writePlayerClues(rsn, { [name]: score });
                        break;
                    case 'activity':
                        state.setActivity(rsn, name as IndividualActivityName, score);
                        await pgStorageClient.writePlayerActivities(rsn, { [name]: score });
                        break;
                    }
                }
                await msg.channel.send('Rollback commit complete!');
                rollbackStaging = [];
            }

            rollbackLock = false;
        },
        text: 'Fetches hiscores for each player and saves any negative diffs (only needed in the case of a rollback)'
    },
    removeglobal: {
        fn: async (msg: Message, rawArgs, rawRsn) => {
            if (!rawRsn || !rawRsn.trim()) {
                await msg.reply('Invalid username');
                return;
            }
            const rsn = sanitizeRSN(rawRsn);
            const guildIds: Snowflake[] = state.getGuildsTrackingPlayer(rsn);
            if (guildIds.length === 0) {
                await msg.reply(`**${rsn}** is not tracked by any guilds`);
                return;
            }
            // Remove player from all guilds
            await pgStorageClient.deleteTrackedPlayerGlobally(rsn);
            state.removeTrackedPlayerGlobally(rsn);
            await msg.reply(`Removed **${rsn}** from **${guildIds.length}** guild(s)`);
            // If no longer globally tracked (should be true), purge PG
            await purgeUntrackedPlayers([rsn], 'removeglobal');
        },
        text: 'Removes a player from all guilds'
    },
    logger: {
        fn: async (msg: Message, rawArgs: string) => {
            try {
                // First, determine the ID of this channel logger
                let id: Snowflake;
                if (msg.channelId in loggerIndices) {
                    id = msg.channelId;
                } else if (msg.channel.isDMBased() && msg.author.id in loggerIndices) {
                    id = msg.author.id;
                } else {
                    await msg.reply('This channel doesn\'t have a corresponding channel logger!');
                    return;
                }
                // Now that the ID is confirmed to be in the logger map, reconfigure its level
                if (rawArgs in MultiLoggerLevel) {
                    const level = parseInt(rawArgs);
                    logger.setOutputLevel(loggerIndices[id], level);
                    await msg.reply(`This logger is now at level **${MultiLoggerLevel[level]}**`);
                } else {
                    await msg.reply(`\`${rawArgs}\` is not a valid level, options are \`${JSON.stringify(Object.keys(MultiLoggerLevel))}\``);
                }
            } catch (err) {
                await msg.reply(`Oops! \`${err}\``);
            }
        },
        text: 'Sets the logging level of this channel\'s logger'
    },
    player: {
        fn: async (msg: Message, rawArgs, rawRsn) => {
            if (!rawRsn || !rawRsn.trim()) {
                await msg.reply('Invalid username');
                return;
            }
            const rsn = sanitizeRSN(rawRsn);

            const embeds: APIEmbed[] = [];

            // First, try to fetch display name
            try {
                const displayName = await fetchDisplayName(rsn);
                embeds.push({
                    description: `Fetched display name of **${rsn}** as **${displayName}**`
                });
            } catch (err) {
                embeds.push(createWarningEmbed(`Unable to fetch display name for **${rsn}**: \`${err}\``));
            }

            // Show guild info about this player
            const guilds = state.getGuildsTrackingPlayer(rsn);
            if (guilds.length === 0) {
                embeds.push(createWarningEmbed('No guilds tracking this player'));
            } else {
                const noun = guilds.length === 1 ? 'guild' : 'guilds';
                embeds.push({
                    description: `**${state.getDisplayName(rsn)}** is tracked in **${guilds.length}** ${noun}: `
                        + guilds.map(id => `\`${id}\` (_${msg.client.guilds.cache.get(id) ?? '???'}_)`).join(', ')
                });
            }

            // Show time-related info about this player
            const lastRefresh = state.getLastRefresh(rsn);
            if (lastRefresh) {
                const timeSinceLastRefresh: number = new Date().getTime() - lastRefresh.getTime();
                const timeSinceLastActive: number = state.getTimeSincePlayerLastActive(rsn);
                embeds.push({
                    description: 'Timing Information',
                    fields: [{
                        name: 'Last Refresh',
                        value: getPreciseDurationString(timeSinceLastRefresh),
                        inline: true
                    }, {
                        name: 'Last Active',
                        value: getPreciseDurationString(timeSinceLastActive),
                        inline: true
                    }, {
                        name: 'Containing Queue',
                        value: state.getContainingQueueLabel(rsn),
                        inline: true
                    }]
                });
            }

            // Test the API by fetching this player
            try {
                await fetchHiScores(rsn);
                embeds.push({
                    description: `API seems to be fine, fetched and parsed response for player **${rsn}**`
                });
            } catch (err) {
                let errorText = `API query failed with error: \`${err}\``;
                if ((err instanceof Error) && err.message === INVALID_FORMAT_ERROR) {
                    errorText += ' (the API has changed or just generally cannot be parsed)';
                }
                embeds.push(createWarningEmbed(errorText));
            }

            await msg.reply({
                embeds
            });
        },
        text: 'Shows information about a given player'
    },
    refresh: {
        fn: async (msg: Message, rawArgs, rawRsn) => {
            if (!rawRsn || !rawRsn.trim()) {
                await msg.reply('Invalid username');
                return;
            }
            const rsn = sanitizeRSN(rawRsn);

            try {
                await updatePlayer(rsn);
                await msg.reply(`Refreshed **${state.getDisplayName(rsn)}**!`);
            } catch (err) {
                await msg.reply(`Error while updating **${state.getDisplayName(rsn)}**: \`${err}\``);
            }
        },
        text: 'Refreshes a player instantly'
    },
    guildnotify: {
        fn: async (msg: Message, rawArgs: string, guildId: Snowflake, text: string) => {
            // Validate the input
            if (!guildId || !text) {
                await msg.reply('usage: guildnotify GUILD_ID TEXT');
                return;
            }
            if (!state.hasTrackingChannel(guildId)) {
                await msg.reply(`Guild with ID \`${guildId}\` either has no tracking channel or doesn't exist`);
                return;
            }
            // Send the message
            try {
                await sendUpdateMessage([state.getTrackingChannel(guildId)],
                    text,
                    'wrench',
                    { color: GRAY_EMBED_COLOR, title: 'Message from ScapeBot\'s maintainers' });
                await msg.reply(`**Sent message to guild _${msg.client.guilds.cache.get(guildId) ?? '???'}_:** ${text}`);
            } catch (err) {
                await msg.reply(`Failed to send message: \`${err}\``);
            }
        },
        text: 'Sends an arbitrary message to some guild by ID'
    },
    hiscoresurl: {
        fn: async (msg: Message) => {
            try {
                await msg.reply(`Hiscores URL template: ${hiScoresUrlTemplate}`);
            } catch (err) {
                await msg.reply(`Error while fetching hiscores URL: \`${err}\``);
            }
        },
        text: 'Shows the HiScores URL based on the game mode'
    }
};
