import { APIActionRowComponent, APIMessageActionRowComponent, ButtonStyle, ChannelType, ComponentType, InteractionUpdateOptions, MessageComponentInteraction, Snowflake } from 'discord.js';
import { FORMATTED_GUILD_SETTINGS, GUILD_SETTING_OPTIONS } from './constants';
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
            // Show the root settings menu
            await interaction.update({
                embeds: [{
                    title: 'ScapeBot Settings',
                    description: 'TODO: Fill me out'
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
            // If disabling the 1-threshold, disable the 5-threshold as well
            if (value === 0) {
                state.setGuildSetting(guildId, GuildSetting.SkillBroadcastFiveThreshold, 0);
            }
            // If enabling the 1-threshold while the 5-threshold is disabled, enable it at 1
            else if (state.getGuildSettingWithDefault(guildId, GuildSetting.SkillBroadcastFiveThreshold) === 0) {
                state.setGuildSetting(guildId, GuildSetting.SkillBroadcastFiveThreshold, 1);
            }
            // If trying to set the 1-threshold below the 5-threshold, set the 5-threshold to just match it
            else if (value < state.getGuildSettingWithDefault(guildId, GuildSetting.SkillBroadcastFiveThreshold)) {
                state.setGuildSetting(guildId, GuildSetting.SkillBroadcastFiveThreshold, value);
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
            // If (SOMEHOW) enabling the 5-threshold while the 1-threshold is disabled it, enable it at the same value
            if (value > 0 &&  state.getGuildSettingWithDefault(guildId, GuildSetting.SkillBroadcastAllThreshold) === 0) {
                state.setGuildSetting(guildId, GuildSetting.SkillBroadcastAllThreshold, value);
            }
            await interaction.update(this.getSkillSettingsPayload(guildId));
            // TODO: temp logging
            if (!interaction.replied) {
                await interaction.reply({ ephemeral: true, content: 'Interaction didn\'t reply for some reason' });
            }
        } else if (customId === 'settings:selectSkillMiscFlags') {
            if (!interaction.isStringSelectMenu()) {
                await interaction.reply({ ephemeral: true, content: 'Failed: is NOT string select menu' });
                return;
            }
            const values = interaction.values.map(v => parseInt(v));
            if (values.some(v => isNaN(v))) {
                await interaction.reply({ ephemeral: true, content: `Failed: selected values \`${interaction.values}\` contain NaN` });
                return;
            }
            // TODO: Temp logic
            await interaction.reply({ ephemeral: true, content: `You enabled settings ${JSON.stringify(values)}`});
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

        // Construct the overall description in the embed
        const intervalStrings: string[] = [oneThreshold === 99 ? 'level **99**' : `every **1** level through levels **${oneThreshold}-99**`];
        if (oneThreshold > 1) {
            if (fiveThreshold === 0) {
                intervalStrings.unshift(`nothing through levels **1-${oneThreshold - 1}**`);
            } else {
                if (oneThreshold !== fiveThreshold) {
                    intervalStrings.unshift(`every **5** levels through levels **${fiveThreshold}-${oneThreshold - 1}**`);
                }
                if (fiveThreshold > 1) {
                    intervalStrings.unshift(`every **10** levels through levels **1-${fiveThreshold - 1}**`);
                }
            }
        }

        const menus: APIActionRowComponent<APIMessageActionRowComponent>[] = [];

        // The first threshold menu is always shown
        const options: Record<number, string> = {
            0: 'Disabled (no skill updates)',
            1: 'Always report every level',
            10: 'Every level after 10',
            20: 'Every level after 20',
            30: 'Every level after 30',
            40: 'Every level after 40',
            50: 'Every level after 50',
            60: 'Every level after 60',
            70: 'Every level after 70',
            80: 'Every level after 80',
            90: 'Every level after 90',
            99: 'Only on reaching 99'
        };
        menus.push({
            type: ComponentType.ActionRow,
            components: [{
                type: ComponentType.StringSelect,
                custom_id: 'settings:selectSkillAllThreshold',
                min_values: 1,
                max_values: 1,
                placeholder: 'Click to set 1-level threshold',
                options: Object.entries(options).map(([value, text]) => ({ value: value, label: text, default: oneThreshold.toString() === value }))
            }]
        });
        // If the first setting is not disabled/everything, show specific second menu
        if (oneThreshold > 1) {
            const options5: Record<number, string> = {
                0: `Report nothing below level ${oneThreshold}`,
                1: `Every 5 levels until ${oneThreshold}`
            };
            // Dynamically add tiered options
            for (let i = 10; i < oneThreshold; i += 10) {
                options5[i] = `Every 10 levels until ${i}, every 5 until ${oneThreshold}`;
            }
            options5[oneThreshold] = `Every 10 levels until ${oneThreshold}`;
            menus.push({
                type: ComponentType.ActionRow,
                components: [{
                    type: ComponentType.StringSelect,
                    custom_id: 'settings:selectSkillFiveThreshold',
                    min_values: 1,
                    max_values: 1,
                    placeholder: 'Click to set 5-level threshold',
                    options: Object.entries(options5).map(([value, text]) => ({ value: value, label: text, default: fiveThreshold.toString() === value }))
                }]
            });
        }

        // Unless everything is disabled, show the misc menu
        if (oneThreshold !== 0) {
            menus.push({
                type: ComponentType.ActionRow,
                components: [{
                    type: ComponentType.StringSelect,
                    custom_id: 'settings:selectSkillMiscFlags',
                    min_values: 0,
                    max_values: 3,
                    placeholder: 'Click to toggle additional settings',
                    options: [{
                        label: 'Tag @everyone on 99',
                        value: '123'
                    }, {
                        label: 'React with GZ on 99',
                        value: '456'
                    }, {
                        label: 'Report "virtual" levels after 99',
                        value: '789'
                    }]
                }]
            });
        }

        return {
            content: '',
            embeds: [{
                title: 'Settings > Skill Settings',
                description: (oneThreshold === 0) ? 'Skill updates are disabled' : `Skill updates are enabled and configured to show ${naturalJoin(intervalStrings)}`
            }],
            components: [
                ...menus,
                {
                    type: ComponentType.ActionRow,
                    components: [{
                        type: ComponentType.Button,
                        style: ButtonStyle.Secondary,
                        label: 'Back',
                        custom_id: 'settings:root'
                    }]
                }
            ]
        };
    }
}

export default SettingsInteractionHandler;
