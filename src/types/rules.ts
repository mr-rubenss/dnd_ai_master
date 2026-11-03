// Типы данных для создания персонажа: классы, предыстории, виды, черты, наборы снаряжения.
// Файлы — src/data/rules/*.json, валидация — src/game/rulesData.ts.
import type { Ability } from '../engine/abilities'
import type { SkillId } from '../engine/skills'

export interface NamedText {
  name: string
  description: string
}

/** Строка снаряжения: предмет из справочника или набор (pack), который раскрывается в предметы. */
export type EquipmentLine = { itemId: string; quantity?: number; packId?: undefined } | { packId: string; itemId?: undefined }

export interface EquipmentOption {
  /** «A», «B», «C» — как в книге. */
  id: string
  items: EquipmentLine[]
  gold: number
}

export interface SkillChoice {
  count: number
  /** Список навыков или "any" — любой навык. */
  from: SkillId[] | 'any'
  /** Откуда выбор (для подписи): «Острые чувства», «Умелость». */
  source?: string
}

export interface ClassDefinition {
  id: string
  name: string
  description: string
  hitDie: number
  /** Основные характеристики класса. */
  primary: Ability[]
  savingThrows: Ability[]
  skillChoices: SkillChoice
  /** Сколько навыков получают компетентность на 1-м уровне (Плут — 2). */
  expertise?: number
  armorTraining: string
  features: NamedText[]
  equipment: EquipmentOption[]
}

export interface BackgroundDefinition {
  id: string
  name: string
  description: string
  /** Три характеристики, к которым можно применить прибавки +2/+1 или +1/+1/+1. */
  abilities: [Ability, Ability, Ability]
  feat: string
  /** Уточнение к черте, например «список жреца». */
  featNote?: string
  skills: SkillId[]
  tool: string
  equipment: EquipmentOption[]
}

export interface SpeciesOption {
  id: string
  name: string
  description: string
  speed?: number
  darkvision?: number
}

export interface SpeciesDefinition {
  id: string
  name: string
  description: string
  size: string
  speed: number
  darkvision: number
  /** Дополнительные хиты за уровень (Дварф). */
  hpPerLevel?: number
  traits: NamedText[]
  /** Выбор ветви или предка (Эльф, Драконорождённый…). */
  choice?: { label: string; options: SpeciesOption[] }
  skillChoice?: SkillChoice
  /** Даёт черту происхождения на выбор (Человек). */
  originFeat?: boolean
}

export interface FeatDefinition {
  id: string
  name: string
  description: string
  /** Сколько навыков даёт черта на выбор (Одарённый — 3). */
  skillChoices?: number
}

export interface PackDefinition {
  id: string
  name: string
  contents: { itemId: string; quantity: number }[]
}

export interface RulesData {
  classes: Record<string, ClassDefinition>
  backgrounds: Record<string, BackgroundDefinition>
  species: Record<string, SpeciesDefinition>
  feats: Record<string, FeatDefinition>
  packs: Record<string, PackDefinition>
}
