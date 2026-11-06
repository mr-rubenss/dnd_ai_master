// Типы данных для создания персонажа: классы, предыстории, виды, черты, наборы снаряжения.
// Файлы — src/data/rules/*.json, валидация — src/game/rulesData.ts.
import type { Ability } from '../engine/abilities'
import type { SkillId } from '../engine/skills'
import type { ArmorType, ItemCatalog, ToolKind } from './items'
import type { ClassSpellcasting, InitiateList, InnateSpellGrant, SpellCatalog, SpellSlotTables } from './spells'

export interface NamedText {
  name: string
  description: string
}

/**
 * Строка снаряжения: предмет из справочника, набор (pack), который раскрывается в предметы,
 * или инструмент, выбранный игроком для класса или предыстории.
 */
export type EquipmentLine =
  | { itemId: string; quantity?: number; packId?: undefined; chosenTool?: undefined }
  | { packId: string; itemId?: undefined; chosenTool?: undefined }
  | { chosenTool: 'class' | 'background'; itemId?: undefined; packId?: undefined }

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
  /** Владение доспехами (Armor Training). */
  armorTraining: ArmorType[]
  /** Владение воинским оружием (простым владеют все классы SRD 5.2). */
  martialWeapons: MartialWeaponTraining
  /** Инструменты: заданные и на выбор. */
  tools?: { fixed?: string[]; choose?: { count: number; kinds: ToolKind[] } }
  /** Выбирает черту боевого стиля на 1-м уровне (Воин). */
  fightingStyle?: boolean
  features: NamedText[]
  equipment: EquipmentOption[]
  /** Использование заклинаний (нет — класс без магии на 1-м уровне). */
  spellcasting?: ClassSpellcasting
}

/** Воинское оружие: всё, никакое, только лёгкое (Монах), фехтовальное или лёгкое (Плут). */
export type MartialWeaponTraining = 'all' | 'none' | 'light' | 'finesse-or-light'

/** Инструмент предыстории: конкретный или на выбор указанного вида. */
export type ToolGrant = { itemId: string; choose?: undefined } | { choose: ToolKind; itemId?: undefined }

export interface BackgroundDefinition {
  id: string
  name: string
  description: string
  /** Три характеристики, к которым можно применить прибавки +2/+1 или +1/+1/+1. */
  abilities: [Ability, Ability, Ability]
  feat: string
  /** Уточнение к черте, например «список жреца». */
  featNote?: string
  /** Список заклинаний для черты «Посвящённый в магию» (Послушник — жрец, Мудрец — волшебник); нет — на выбор игрока. */
  featSpellList?: InitiateList
  skills: SkillId[]
  tool: ToolGrant
  equipment: EquipmentOption[]
}

export interface SpeciesOption {
  id: string
  name: string
  description: string
  speed?: number
  darkvision?: number
  /** Врождённые заклинания ветви (заговоры наследия, «Разговор с животными» лесного гнома). */
  innateSpells?: InnateSpellGrant[]
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
  /** Врождённые заклинания вида для всех ветвей (Тифлинг — «Чудотворство»). */
  innateSpells?: InnateSpellGrant[]
}

export const FEAT_CATEGORIES = ['origin', 'fighting-style'] as const
export type FeatCategory = (typeof FEAT_CATEGORIES)[number]

export interface FeatDefinition {
  id: string
  name: string
  /** Черта происхождения или черта боевого стиля. */
  category: FeatCategory
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
  /** Справочник заклинаний и таблицы ячеек (src/data/spells.json, rules/spell-slots.json). */
  spells: SpellCatalog
  spellSlots: SpellSlotTables
  /** Справочник предметов, на который ссылаются данные. */
  catalog: ItemCatalog
}
