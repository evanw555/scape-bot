import { PermissionFlagsBits } from 'discord.js';
import { loadJson } from 'evanw555.js';
import { Boss, CLUES, SKILLS, BOSSES, FORMATTED_SKILL_NAMES, FORMATTED_BOSS_NAMES, FORMATTED_LEAGUE_POINTS, FORMATTED_LMS, FORMATTED_PVP_ARENA, FORMATTED_SOUL_WARS, FORMATTED_RIFTS_CLOSED } from 'osrs-json-hiscores';
import { IndividualClueType, IndividualSkillName, ScapeBotAuth, ScapeBotConfig, ScapeBotConstants, CommandOptionChoice, IndividualActivityName } from './types';

export const SKILLS_NO_OVERALL: IndividualSkillName[] = SKILLS.filter(skill => skill !== 'overall') as IndividualSkillName[];
export const CLUES_NO_ALL: IndividualClueType[] = CLUES.filter(clue => clue !== 'all') as IndividualClueType[];

// Miscellaneous activities, e.g. rifts, LMS, league points - because the definition of a 'miscellaneous' activity is
// less predictable, it is better to be narrow with its typing and add additional activities as it becomes necessary.
export const OTHER_ACTIVITIES_MAP = {
    'leaguePoints': FORMATTED_LEAGUE_POINTS,
    'lastManStanding': FORMATTED_LMS,
    'pvpArena': FORMATTED_PVP_ARENA,
    'soulWarsZeal': FORMATTED_SOUL_WARS,
    'riftsClosed': FORMATTED_RIFTS_CLOSED
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
export const RED_EMBED_COLOR = 12919812;
export const YELLOW_EMBED_COLOR = 16569404;
export const GRAY_EMBED_COLOR = 7303023;

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
    'tombsOfAmascutExpertMode'
]);

export const INVALID_TEXT_CHANNEL = 'err/invalid-text-channel';
export const UNAUTHORIZED_USER = 'err/unauthorized-user';
export const STATE_DISABLED = 'err/state-disabled';
export const UNAUTHORIZED_ROLE = 'err/unauthorized-role';

export const PLAYER_404_ERROR = 'Request failed with status code 404';

export const DEFAULT_AXIOS_CONFIG: { timeout: number } = {
    timeout: 30000
};