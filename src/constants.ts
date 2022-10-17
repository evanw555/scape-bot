import { loadJson } from "evanw555.js";
import { Boss, CLUES, SKILLS } from "osrs-json-hiscores";
import { IndividualClueType, IndividualSkillName, ScapeBotAuth, ScapeBotConfig, ScapeBotConstants } from "./types";

export const SKILLS_NO_OVERALL: IndividualSkillName[] = SKILLS.filter(skill => skill !== 'overall') as IndividualSkillName[];
export const CLUES_NO_ALL: IndividualClueType[] = CLUES.filter(clue => clue !== 'all') as IndividualClueType[];

export const DEFAULT_SKILL_LEVEL: number = 1;
export const DEFAULT_BOSS_SCORE: number = 0;
export const DEFAULT_CLUE_SCORE: number = 0;

export const SKILL_EMBED_COLOR: number = 6316287; // Lavender/blue-ish
export const BOSS_EMBED_COLOR: number = 10363483; // Magenta-ish
export const CLUE_EMBED_COLOR: number = 16551994; // Orange
export const RED_EMBED_COLOR: number = 12919812;
export const YELLOW_EMBED_COLOR: number = 16569404;
export const GRAY_EMBED_COLOR: number = 7303023;

export const CONSTANTS: ScapeBotConstants = loadJson('static/constants.json');
export const AUTH: ScapeBotAuth = loadJson('config/auth.json');
export const CONFIG: ScapeBotConfig = loadJson('config/config.json');

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
