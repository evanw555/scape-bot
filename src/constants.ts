import { SKILLS } from "osrs-json-hiscores";
import { IndividualSkillName } from "./types";

export const SKILLS_NO_OVERALL: IndividualSkillName[] = SKILLS.filter(skill => skill !== 'overall') as IndividualSkillName[];

export const DEFAULT_SKILL_LEVEL: number = 1;
export const DEFAULT_BOSS_SCORE: number = 0;
