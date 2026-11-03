// Навыки и владение ими (SRD 5.2).
import type { Ability } from './abilities'

export const SKILLS = [
  'acrobatics',
  'animal-handling',
  'arcana',
  'athletics',
  'deception',
  'history',
  'insight',
  'intimidation',
  'investigation',
  'medicine',
  'nature',
  'perception',
  'performance',
  'persuasion',
  'religion',
  'sleight-of-hand',
  'stealth',
  'survival',
] as const
export type SkillId = (typeof SKILLS)[number]

export interface SkillDefinition {
  id: SkillId
  name: string
  ability: Ability
}

export const SKILL_DEFINITIONS: Record<SkillId, SkillDefinition> = {
  acrobatics: { id: 'acrobatics', name: 'Акробатика', ability: 'dex' },
  'animal-handling': { id: 'animal-handling', name: 'Уход за животными', ability: 'wis' },
  arcana: { id: 'arcana', name: 'Магия', ability: 'int' },
  athletics: { id: 'athletics', name: 'Атлетика', ability: 'str' },
  deception: { id: 'deception', name: 'Обман', ability: 'cha' },
  history: { id: 'history', name: 'История', ability: 'int' },
  insight: { id: 'insight', name: 'Проницательность', ability: 'wis' },
  intimidation: { id: 'intimidation', name: 'Запугивание', ability: 'cha' },
  investigation: { id: 'investigation', name: 'Анализ', ability: 'int' },
  medicine: { id: 'medicine', name: 'Медицина', ability: 'wis' },
  nature: { id: 'nature', name: 'Природа', ability: 'int' },
  perception: { id: 'perception', name: 'Внимательность', ability: 'wis' },
  performance: { id: 'performance', name: 'Выступление', ability: 'cha' },
  persuasion: { id: 'persuasion', name: 'Убеждение', ability: 'cha' },
  religion: { id: 'religion', name: 'Религия', ability: 'int' },
  'sleight-of-hand': { id: 'sleight-of-hand', name: 'Ловкость рук', ability: 'dex' },
  stealth: { id: 'stealth', name: 'Скрытность', ability: 'dex' },
  survival: { id: 'survival', name: 'Выживание', ability: 'wis' },
}

/** Уровень владения навыком: нет, владение (+БМ) или компетентность (+2×БМ). */
export const PROFICIENCY_LEVELS = ['none', 'proficient', 'expertise'] as const
export type ProficiencyLevel = (typeof PROFICIENCY_LEVELS)[number]

export const PROFICIENCY_MULTIPLIER: Record<ProficiencyLevel, number> = {
  none: 0,
  proficient: 1,
  expertise: 2,
}
