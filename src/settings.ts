import { ButtonStyle, ChannelType, ComponentType, InteractionUpdateOptions, MessageComponentInteraction, Snowflake } from 'discord.js';
import { ALL_GUILD_SETTINGS, FORMATTED_GUILD_SETTINGS, GUILD_SETTING_OPTIONS } from './constants';
import { GuildSetting } from './types';

import state from './instances/state';
import { naturalJoin } from 'evanw555.js';

class SettingsInteractionHandler {
    async onMessageComponentInteraction(interaction: MessageComponentInteraction) {
        // Only process if this is an actual settings interaction
        const customId = interaction.customId;
        if (!customId.startsWith('settings:')) {
            return;
        }
        const guildId = interaction.guildId;
        // TODO: Validate this in a better way
        if (!guildId) {
            return;
        }
        // TODO: Temp logic to ensure this is only being used by maintainers
        if (!state.isMaintainer(interaction.user.id)) {
            await interaction.reply({
                content: 'You can\'t do that',
                ephemeral: true
            });
            return;
        }
        if (customId === 'settings:root') {
            // Collect all current setting values
            const currentSettingsString = ALL_GUILD_SETTINGS.map(setting => `**${FORMATTED_GUILD_SETTINGS[setting]}:** ${(GUILD_SETTING_OPTIONS[setting] ?? {})[state.getGuildSettingWithDefault(guildId, setting)]}`)
                .join('\n');
            // Show the root settings menu
            await interaction.update({
                embeds: [{
                    title: 'ScapeBot Settings',
                    description: 'ScapeBot is configured in your guild with the following settings:\n' + currentSettingsString
                }],
                components: [{
                    type: ComponentType.ActionRow,
                    components: [{
                        type: ComponentType.ChannelSelect,
                        custom_id: 'settings:selectTrackingChannel',
                        min_values: 1,
                        max_values: 1,
                        placeholder: state.hasTrackingChannel(guildId) ? state.getTrackingChannel(guildId).name : 'Click to set tracking channel',
                        channel_types: [ChannelType.GuildText]
                    }]
                }, {
                    type: ComponentType.ActionRow,
                    components: [{
                        type: ComponentType.RoleSelect,
                        custom_id: 'settings:selectPrivilegedRole',
                        min_values: 0,
                        max_values: 1,
                        placeholder: state.hasPrivilegedRole(guildId) ? state.getPrivilegedRole(guildId).name : 'Click to set privileged role'
                    }]
                }, {
                    type: ComponentType.ActionRow,
                    components: [{
                        type: ComponentType.Button,
                        style: ButtonStyle.Secondary,
                        label: 'Skill Settings',
                        custom_id: 'settings:skills'
                    }, {
                        type: ComponentType.Button,
                        style: ButtonStyle.Secondary,
                        label: 'Other Settings',
                        custom_id: 'settings:other'
                    }]
                }]
            });
        } else if (customId === 'settings:skills') {
            await interaction.update(this.getSkillSettingsPayload(guildId));
        } else if (customId === 'settings:selectSkillAllThreshold') {
            if (!interaction.isStringSelectMenu()) {
                await interaction.reply({ ephemeral: true, content: 'Failed: is NOT string select menu' });
                return;
            }
            const value = parseInt(interaction.values[0]);
            if (isNaN(value)) {
                await interaction.reply({ ephemeral: true, content: `Failed: selected value \`${interaction.values[0]}\` is NaN` });
                return;
            }
            // TODO: Update in PG too
            state.setGuildSetting(guildId, GuildSetting.SkillBroadcastAllThreshold, value);
            if (value === 0) {
                state.setGuildSetting(guildId, GuildSetting.SkillBroadcastFiveThreshold, 0);
            } else if (state.getGuildSettingWithDefault(guildId, GuildSetting.SkillBroadcastFiveThreshold) === 0) {
                state.setGuildSetting(guildId, GuildSetting.SkillBroadcastFiveThreshold, 1);
            }
            await interaction.update(this.getSkillSettingsPayload(guildId));
        } else if (customId === 'settings:selectSkillFiveThreshold') {
            if (!interaction.isStringSelectMenu()) {
                await interaction.reply({ ephemeral: true, content: 'Failed: is NOT string select menu' });
                return;
            }
            const value = parseInt(interaction.values[0]);
            if (isNaN(value)) {
                await interaction.reply({ ephemeral: true, content: `Failed: selected value \`${interaction.values[0]}\` is NaN` });
                return;
            }
            // TODO: Update in PG too
            state.setGuildSetting(guildId, GuildSetting.SkillBroadcastFiveThreshold, value);
            if (value === 0) {
                state.setGuildSetting(guildId, GuildSetting.SkillBroadcastAllThreshold, 0);
            } else if (state.getGuildSettingWithDefault(guildId, GuildSetting.SkillBroadcastAllThreshold) === 0) {
                state.setGuildSetting(guildId, GuildSetting.SkillBroadcastAllThreshold, 1);
            }
            await interaction.update(this.getSkillSettingsPayload(guildId));
            // TODO: temp logging
            if (!interaction.replied) {
                await interaction.reply({ ephemeral: true, content: 'Interaction didn\'t reply for some reason' });
            }
        } else if (customId === 'settings:selectSetting') {
            if (interaction.isStringSelectMenu()) {
                const value = interaction.values[0];
                const setting = parseInt(value) as GuildSetting;
                if (setting in FORMATTED_GUILD_SETTINGS) {
                    await interaction.update({
                        content: `You are editing the **${FORMATTED_GUILD_SETTINGS[setting]}** setting`,
                        components: [{
                            type: ComponentType.ActionRow,
                            components: [{
                                type: ComponentType.Button,
                                style: ButtonStyle.Secondary,
                                label: 'Back',
                                custom_id: 'settings:root'
                            }]
                        }, {
                            type: ComponentType.ActionRow,
                            components: [{
                                type: ComponentType.StringSelect,
                                custom_id: `settings:set:${setting}`,
                                min_values: 1,
                                max_values: 1,
                                placeholder: 'Select setting value...',
                                options: Object.entries(GUILD_SETTING_OPTIONS[setting]).map(([settingValue, description]) => ({ label: description, value: settingValue }))
                            }]
                        }]
                    });
                }
            }
        } else if (customId.startsWith('settings:set:')) {
            if (interaction.isStringSelectMenu()) {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const [ _settings, _set, settingString ] = customId.split(':');
                const value = interaction.values[0];
                const setting = parseInt(settingString) as GuildSetting;
                if (setting in FORMATTED_GUILD_SETTINGS) {
                    // TODO: Actually update the setting in state/PG
                    await interaction.update({
                        content: `You set the **${FORMATTED_GUILD_SETTINGS[setting]}** setting to **${value}**`,
                        components: [{
                            type: ComponentType.ActionRow,
                            components: [{
                                type: ComponentType.Button,
                                style: ButtonStyle.Secondary,
                                label: 'Back',
                                custom_id: 'settings:root'
                            }]
                        }, {
                            type: ComponentType.ActionRow,
                            components: [{
                                type: ComponentType.StringSelect,
                                custom_id: `settings:set:${setting}`,
                                min_values: 1,
                                max_values: 1,
                                placeholder: 'Select setting value...',
                                options: Object.entries(GUILD_SETTING_OPTIONS[setting]).map(([settingValue, description]) => ({ label: description, value: settingValue }))
                            }]
                        }]
                    });
                }
            }
        }
    }

    private getSkillSettingsPayload(guildId: Snowflake): InteractionUpdateOptions {
        const oneThreshold = state.getGuildSettingWithDefault(guildId, GuildSetting.SkillBroadcastAllThreshold);
        const fiveThreshold = state.getGuildSettingWithDefault(guildId, GuildSetting.SkillBroadcastFiveThreshold);
        const disabled = oneThreshold === 0 || fiveThreshold === 0;
        const intervalStrings: string[] = [oneThreshold === 99 ? 'level **99**' : `every **1** level through levels **${oneThreshold}-99**`];
        if (oneThreshold > 1) {
            intervalStrings.unshift(`every **5** levels through levels **${fiveThreshold}-${oneThreshold - 1}**`);
        }
        if (fiveThreshold > 1) {
            intervalStrings.unshift(`every **10** levels through levels **1-${fiveThreshold - 1}**`);
        }
        return {
            embeds: [{
                title: 'Settings > Skill Settings',
                description: disabled ? 'Skill updates are disabled' : `Skill updates are enabled and configured to show ${naturalJoin(intervalStrings)}`
            }],
            components: [{
                type: ComponentType.ActionRow,
                components: [{
                    type: ComponentType.StringSelect,
                    custom_id: 'settings:selectSkillAllThreshold',
                    min_values: 1,
                    max_values: 1,
                    placeholder: 'Click to set 1-level threshold',
                    options: Object.entries(GUILD_SETTING_OPTIONS[GuildSetting.SkillBroadcastAllThreshold]).map(([value, text]) => ({ value: value, label: text, default: oneThreshold.toString() === value}))
                }]
            }, {
                type: ComponentType.ActionRow,
                components: [{
                    type: ComponentType.StringSelect,
                    custom_id: 'settings:selectSkillFiveThreshold',
                    min_values: 1,
                    max_values: 1,
                    placeholder: 'Click to set 5-level threshold',
                    options: Object.entries(GUILD_SETTING_OPTIONS[GuildSetting.SkillBroadcastFiveThreshold]).map(([value, text]) => ({ value: value, label: text, default: oneThreshold.toString() === value}))
                }]
            }, {
                type: ComponentType.ActionRow,
                components: [{
                    type: ComponentType.Button,
                    style: ButtonStyle.Secondary,
                    label: 'Back',
                    custom_id: 'settings:root'
                }]
            }]
        };
    }
}

export default SettingsInteractionHandler;
