import { PermissionFlagsBits } from 'discord.js';
import { loadJson } from 'evanw555.js';
import { Boss, CLUES, SKILLS, BOSSES, FORMATTED_SKILL_NAMES, FORMATTED_BOSS_NAMES, FORMATTED_LEAGUE_POINTS, FORMATTED_LMS, FORMATTED_PVP_ARENA, FORMATTED_SOUL_WARS, FORMATTED_RIFTS_CLOSED, FORMATTED_COLOSSEUM_GLORY, FORMATTED_COLLECTIONS_LOGGED } from 'osrs-json-hiscores';
import { IndividualClueType, IndividualSkillName, ScapeBotAuth, ScapeBotConfig, ScapeBotConstants, CommandOptionChoice, GuildSetting } from './types';

export const SKILLS_NO_OVERALL: IndividualSkillName[] = SKILLS.filter(skill => skill !== 'overall') as IndividualSkillName[];
export const CLUES_NO_ALL: IndividualClueType[] = CLUES.filter(clue => clue !== 'all') as IndividualClueType[];

// Miscellaneous activities, e.g. rifts, LMS, league points - because the definition of a 'miscellaneous' activity is
// less predictable, it is better to be narrow with its typing and add additional activities as it becomes necessary.
export const OTHER_ACTIVITIES_MAP = {
    'leaguePoints': FORMATTED_LEAGUE_POINTS,
    'lastManStanding': FORMATTED_LMS,
    'pvpArena': FORMATTED_PVP_ARENA,
    'soulWarsZeal': FORMATTED_SOUL_WARS,
    'riftsClosed': FORMATTED_RIFTS_CLOSED,
    'colosseumGlory': FORMATTED_COLOSSEUM_GLORY,
    'collectionsLogged': FORMATTED_COLLECTIONS_LOGGED
} as const;

export const OTHER_ACTIVITIES = Object.keys(OTHER_ACTIVITIES_MAP) as (keyof typeof OTHER_ACTIVITIES_MAP)[];

export const BOSS_CHOICES: CommandOptionChoice[] = BOSSES.map(boss => ({ name: FORMATTED_BOSS_NAMES[boss], value: boss }));
export const SKILL_CHOICES: CommandOptionChoice[] = SKILLS.map(skill => ({ name: FORMATTED_SKILL_NAMES[skill], value: skill }));

export const DEFAULT_SKILL_LEVEL = 1;
export const DEFAULT_BOSS_SCORE = 0;
export const DEFAULT_CLUE_SCORE = 0;
export const DEFAULT_ACTIVITY_SCORE = 0;

export const SKILL_EMBED_COLOR = 6316287; // Lavender/blue-ish
export const BOSS_EMBED_COLOR = 10363483; // Magenta-ish
export const CLUE_EMBED_COLOR = 16551994; // Orange
export const ACTIVITY_EMBED_COLOR = 16569404; // Yellow for now
export const RED_EMBED_COLOR = 12919812; // Red (used for overall hiscore removals, warning embeds, and inactivity purges)
export const YELLOW_EMBED_COLOR = 16569404; // Yellow (used for overall hiscore additions)
export const GRAY_EMBED_COLOR = 7303023; // Gray (used for API incompatibilities, rollbacks, and system messages)

// 3 days in millis
export const ACTIVE_THRESHOLD_MILLIS = 1000 * 60 * 60 * 24 * 3;
// 4 weeks in millis
export const INACTIVE_THRESHOLD_MILLIES = 1000 * 60 * 60 * 24 * 7 * 4;

// This is how timeout data for the TimeoutManager is stored as a misc property in PG
export const TIMEOUTS_PROPERTY = 'timeouts';

export const CONSTANTS: ScapeBotConstants = loadJson('static/constants.json');
export const AUTH: ScapeBotAuth = loadJson('config/auth.json');
export const CONFIG: ScapeBotConfig = loadJson('config/config.json');

// The bot requires all of these permissions in the guild's tracking channel for it to function
export const REQUIRED_PERMISSION_NAMES: (keyof typeof PermissionFlagsBits)[] = [
    'AddReactions',
    'ViewChannel',
    'SendMessages',
    'EmbedLinks'
];
export const REQUIRED_PERMISSIONS: bigint[] = REQUIRED_PERMISSION_NAMES.map(n => PermissionFlagsBits[n]);

export const DOPE_KILL_VERBS: string[] = [
    'has killed',
    'killed',
    'has slain',
    'slew',
    'slaughtered',
    'butchered'
];
export const DOPE_COMPLETE_VERBS: string[] = [
    'has completed'
];

export const COMPLETE_VERB_BOSSES: Set<Boss> = new Set<Boss>([
    'barrows',
    'chambersOfXeric',
    'chambersOfXericChallengeMode',
    'gauntlet',
    'corruptedGauntlet',
    'theatreOfBlood',
    'theatreOfBloodHardMode',
    'tombsOfAmascut',
    'tombsOfAmascutExpertMode',
    'lunarChests'
]);

export const INVALID_TEXT_CHANNEL = 'err/invalid-text-channel';
export const UNAUTHORIZED_USER = 'err/unauthorized-user';
export const STATE_DISABLED = 'err/state-disabled';
export const UNAUTHORIZED_ROLE = 'err/unauthorized-role';

export const DEFAULT_AXIOS_CONFIG: { timeout: number } = {
    timeout: 30000
};

export const FORMATTED_GUILD_SETTINGS: Record<GuildSetting, string> = {
    [GuildSetting.SkillBroadcastOneThreshold]: 'Report every skill update above this level',
    [GuildSetting.SkillBroadcastFiveThreshold]: 'Report every 5 levels above this level',
    [GuildSetting.BossBroadcastInterval]: 'Boss kills broadcast interval',
    [GuildSetting.ClueBroadcastInterval]: 'Clue completions broadcast interval',
    [GuildSetting.MinigameBroadcastInterval]: 'Minigame completions broadcast interval',
    [GuildSetting.WeeklyRankingMaxCount]: 'Number of players in the weekly XP ranking',
    [GuildSetting.WeeklyRankingIconSet]: 'Weekly XP ranking icon set',
    [GuildSetting.ReactOnSkill99]: 'React GZ on reaching level 99',
    [GuildSetting.TagEveryoneOnSkill99]: 'Tag everyone on reaching level 99',
    [GuildSetting.ShowVirtualSkillUpdates]: 'Show "virtual" levels beyond 99',
    [GuildSetting.ShowOverallHiscoreUpdates]: 'Show when players become on/off the hiscores'
} as const;

export const GUILD_SETTING_SHORT_NAMES: Record<GuildSetting, string> = {
    [GuildSetting.SkillBroadcastOneThreshold]: 'Skill 1-threshold',
    [GuildSetting.SkillBroadcastFiveThreshold]: 'Skill 5-threshold',
    [GuildSetting.BossBroadcastInterval]: 'Boss KC interval',
    [GuildSetting.ClueBroadcastInterval]: 'Clue interval',
    [GuildSetting.MinigameBroadcastInterval]: 'Minigame interval',
    [GuildSetting.WeeklyRankingMaxCount]: 'Weekly XP ranking count',
    [GuildSetting.WeeklyRankingIconSet]: 'Weekly XP ranking icons',
    [GuildSetting.ReactOnSkill99]: 'React GZ on 99',
    [GuildSetting.TagEveryoneOnSkill99]: 'Tag everyone on 99',
    [GuildSetting.ShowVirtualSkillUpdates]: 'Show "virtual" levels',
    [GuildSetting.ShowOverallHiscoreUpdates]: 'Show overall hiscore updates'
} as const;

export const DEFAULT_GUILD_SETTINGS: Record<GuildSetting, number> = {
    [GuildSetting.SkillBroadcastOneThreshold]: 1,
    [GuildSetting.SkillBroadcastFiveThreshold]: 1,
    [GuildSetting.BossBroadcastInterval]: 1,
    [GuildSetting.ClueBroadcastInterval]: 1,
    [GuildSetting.MinigameBroadcastInterval]: 1,
    [GuildSetting.WeeklyRankingMaxCount]: 3,
    [GuildSetting.WeeklyRankingIconSet]: 0,
    [GuildSetting.ReactOnSkill99]: 1,
    [GuildSetting.TagEveryoneOnSkill99]: 0,
    [GuildSetting.ShowVirtualSkillUpdates]: 0,
    [GuildSetting.ShowOverallHiscoreUpdates]: 1
} as const;

// TODO: Add a new "index" property so we can sort these options regardless of their numeric ID
export const RANKING_ICON_SETS: Record<number, { id: string, name: string, cap: number }> = {
    0: {
        id: 'default',
        name: 'Gold/Silver/Bronze Bars',
        cap: 3
    },
    1: {
        id: 'pickaxes',
        name: 'Pickaxes',
        cap: 8
    },
    2: {
        id: 'scimitars',
        name: 'Scimitars',
        cap: 8
    },
    3: {
        id: 'defenders',
        name: 'Defenders',
        cap: 8
    },
    4: {
        id: 'ancients',
        name: 'Ancient Magicks',
        cap: 10
    },
    5: {
        id: 'surges',
        name: 'Surge Spells',
        cap: 4
    },
    6: {
        id: 'coins10',
        name: 'Coins (10)',
        cap: 10
    },
    7: {
        id: 'coins5',
        name: 'Coins (5)',
        cap: 5
    }
};
