import { loadJson } from "evanw555.js";
import { CLUES, SKILLS } from "osrs-json-hiscores";
import { IndividualClueType, IndividualSkillName, ScapeBotAuth, ScapeBotConfig, ScapeBotConstants } from "./types";

export const SKILLS_NO_OVERALL: IndividualSkillName[] = SKILLS.filter(skill => skill !== 'overall') as IndividualSkillName[];
export const CLUES_NO_ALL: IndividualClueType[] = CLUES.filter(clue => clue !== 'all') as IndividualClueType[];

export const DEFAULT_SKILL_LEVEL: number = 1;
export const DEFAULT_BOSS_SCORE: number = 0;
export const DEFAULT_CLUE_SCORE: number = 0;

export const CONSTANTS: ScapeBotConstants = loadJson('static/constants.json');
export const AUTH: ScapeBotAuth = loadJson('config/auth.json');
export const CONFIG: ScapeBotConfig = loadJson('config/config.json');
