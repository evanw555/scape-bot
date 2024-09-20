import { PermissionFlagsBits } from 'discord.js';
import { loadJson } from 'evanw555.js';
import { Boss, CLUES, SKILLS, BOSSES, FORMATTED_SKILL_NAMES, FORMATTED_BOSS_NAMES, FORMATTED_LEAGUE_POINTS, FORMATTED_LMS, FORMATTED_PVP_ARENA, FORMATTED_SOUL_WARS, FORMATTED_RIFTS_CLOSED, FORMATTED_COLOSSEUM_GLORY } from 'osrs-json-hiscores';
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
    'colosseumGlory': FORMATTED_COLOSSEUM_GLORY
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

export const GUILD_SETTINGS_MAP = {
    SKILLS_BROADCAST_EVERY_10: 'skills_broadcast_every_10',
    SKILLS_BROADCAST_EVERY_5: 'skills_broadcast_every_5',
    SKILLS_BROADCAST_EVERY_1: 'skills_broadcast_every_1',
    BOSSES_BROADCAST_INTERVAL: 'bosses_broadcast_interval',
    CLUES_BROADCAST_INTERVAL: 'clues_broadcast_interval',
    MINIGAMES_BROADCAST_INTERVAL: 'minigames_broadcast_interval',
    WEEKLY_RANKING_MAX_COUNT: 'weekly_ranking_max_count'
} as const;

export const GUILD_SETTINGS: Set<GuildSetting> = new Set(Object.values(GUILD_SETTINGS_MAP) as GuildSetting[]);

export const FORMATTED_GUILD_SETTINGS = {
    [GUILD_SETTINGS_MAP.SKILLS_BROADCAST_EVERY_10]: 'Every 10th level-up starting level',
    [GUILD_SETTINGS_MAP.SKILLS_BROADCAST_EVERY_5]: 'Every 5th level-up starting level',
    [GUILD_SETTINGS_MAP.SKILLS_BROADCAST_EVERY_1]: 'Every level-up starting level',
    [GUILD_SETTINGS_MAP.BOSSES_BROADCAST_INTERVAL]: 'Boss kills broadcast interval',
    [GUILD_SETTINGS_MAP.CLUES_BROADCAST_INTERVAL]: 'Clue completions broadcast interval',
    [GUILD_SETTINGS_MAP.MINIGAMES_BROADCAST_INTERVAL]: 'Minigame completions broadcast interval',
    [GUILD_SETTINGS_MAP.WEEKLY_RANKING_MAX_COUNT]: 'Number of players in the weekly ranking'
} as const;

export const DEFAULT_GUILD_SETTINGS = {
    [GUILD_SETTINGS_MAP.SKILLS_BROADCAST_EVERY_10]: 0,
    [GUILD_SETTINGS_MAP.SKILLS_BROADCAST_EVERY_5]: 0,
    [GUILD_SETTINGS_MAP.SKILLS_BROADCAST_EVERY_1]: 1,
    [GUILD_SETTINGS_MAP.BOSSES_BROADCAST_INTERVAL]: 1,
    [GUILD_SETTINGS_MAP.CLUES_BROADCAST_INTERVAL]: 1,
    [GUILD_SETTINGS_MAP.MINIGAMES_BROADCAST_INTERVAL]: 1,
    [GUILD_SETTINGS_MAP.WEEKLY_RANKING_MAX_COUNT]: 3
} as const;
