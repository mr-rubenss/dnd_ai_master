// Типы данных для создания персонажа: классы, предыстории, виды, черты, наборы снаряжения.
// Файлы — src/data/rules/*.json, валидация — src/game/rulesData.ts.
import type { Ability } from '../engine/abilities'
import type { SkillId } from '../engine/skills'
import type { ArmorType, ItemCatalog, ToolKind } from './items'
import type { ClassSpellcasting, InitiateList, InnateSpellGrant, SpellCatalog, SpellSlotTables } from './spells'

export interface NamedText {
  name: string
  /** Английское название из SRD 5.2.1 (русское — наш перевод). */
  nameEn?: string
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
  nameEn: string
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
  /** Выбор роли на 1-м уровне: «Божественный порядок» жреца, «Изначальный порядок» друида. */
  order?: { feature: string; options: ClassOrderOption[] }
  /** Заклинания от умений класса: всегда подготовлены (не входят в лимит), иногда — бесплатные сотворения по уровням. */
  featureSpells?: { spellId: string; feature: string; freeUses?: number[] }[]
  /** Умения с ограниченным числом применений («Второе дыхание», «Ярость»), восстанавливаются отдыхом. */
  resources?: ClassResource[]
  /** «Приёмы оружия» (Weapon Mastery): сколько видов оружия по уровням, каких, что можно сменить после долгого отдыха. */
  weaponMastery?: WeaponMasteryRule
  /** Языки от умений класса: заданные («Друидический») и сколько выбрать ещё («Воровской жаргон» — 1 из любых). */
  languages?: { fixed?: string[]; choose?: number }
  /** Число таинственных воззваний по уровням 1–20 (Колдун). */
  invocations?: number[]
  /** Использование заклинаний (нет — класс без магии на 1-м уровне). */
  spellcasting?: ClassSpellcasting
}

/**
 * «Приёмы оружия»: count — видов оружия по уровням 1–20; weapons — melee (простое или воинское рукопашное, Варвар),
 * any (простое или воинское, Воин), proficient (которым владеет герой); swap — после долгого отдыха сменить
 * один вид (one) или весь выбор (all).
 */
export interface WeaponMasteryRule {
  count: number[]
  weapons: 'melee' | 'any' | 'proficient'
  swap: 'one' | 'all'
}

/** Вариант порядка: дополнительный заговор и бонус к навыкам или владение оружием и доспехами. */
export interface ClassOrderOption {
  id: string
  name: string
  nameEn: string
  description: string
  extraCantrip?: boolean
  /** Бонус к проверкам этих навыков, равный модификатору характеристики (минимум +1). */
  skillBonus?: { skills: SkillId[]; ability: Ability }
  martialWeapons?: boolean
  armor?: ArmorType[]
}

/**
 * Умение с применениями (класс, вид, воззвание): число по уровням 1–20 (uses), по модификатору характеристики
 * (usesAbility, минимум 1) или равное бонусу мастерства (usesProficiency). Короткий отдых возвращает shortRest
 * применений ('all' — все; нет — только долгий), долгий — все. minLevel — с какого уровня персонажа умение есть.
 * effect: healing — лечение броском движка (+ уровень класса при addLevel); damage — урон броском движка
 * (кубиков по уровням, тип — у варианта вида), save — спасбросок цели (Сл 8 + мод. dcAbility + БМ);
 * tempHp: 'proficiency' — временные хиты, равные бонусу мастерства.
 */
export interface ClassResource {
  id: string
  name: string
  description: string
  uses?: number[]
  usesAbility?: Ability
  usesProficiency?: boolean
  shortRest?: number | 'all'
  minLevel?: number
  /** Запас (Наложение рук): применение тратит произвольное количество, лечит на это количество. */
  pool?: boolean
  nameEn?: string
  effect?: ResourceEffect
}

export interface ResourceEffect {
  healing?: string
  addLevel?: boolean
  damage?: { count: number[]; die: number }
  save?: { ability: Ability; dcAbility: Ability }
  tempHp?: 'proficiency'
}

/** Умение с применениями — общее имя для классов, видов и воззваний. */
export type FeatureResource = ClassResource

/** Воинское оружие: всё, никакое, только лёгкое (Монах), фехтовальное или лёгкое (Плут). */
export type MartialWeaponTraining = 'all' | 'none' | 'light' | 'finesse-or-light'

/** Инструмент предыстории: конкретный или на выбор указанного вида. */
export type ToolGrant = { itemId: string; choose?: undefined } | { choose: ToolKind; itemId?: undefined }

export interface BackgroundDefinition {
  id: string
  name: string
  nameEn?: string
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
  nameEn?: string
  description: string
  speed?: number
  darkvision?: number
  /** Врождённые заклинания ветви (заговоры наследия, «Разговор с животными» лесного гнома). */
  innateSpells?: InnateSpellGrant[]
  /** Тип урона ветви (драконий предок — оружие дыхания и сопротивление). */
  damageType?: string
}

export interface SpeciesDefinition {
  id: string
  name: string
  nameEn: string
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
  /** Особенности вида с применениями (оружие дыхания, «Прилив адреналина»). */
  resources?: ClassResource[]
}

export const FEAT_CATEGORIES = ['origin', 'fighting-style'] as const
export type FeatCategory = (typeof FEAT_CATEGORIES)[number]

export interface FeatDefinition {
  id: string
  name: string
  nameEn: string
  /** Черта происхождения или черта боевого стиля. */
  category: FeatCategory
  description: string
  /** Сколько навыков даёт черта на выбор (Одарённый — 3). */
  skillChoices?: number
  /** Вместо навыков можно выбрать инструменты в любом сочетании (Одарённый). */
  orTools?: boolean
  /**
   * Можно взять несколько раз (SRD: «Repeatable»): any — без ограничений (Одарённый), different-list — каждый раз
   * с другим списком заклинаний («Посвящённый в магию»). Нет поля — только один раз.
   */
  repeatable?: 'any' | 'different-list'
}

/** Язык SRD 5.2.1: обычный (Standard) или редкий (Rare). */
export interface LanguageDefinition {
  id: string
  name: string
  nameEn: string
  rarity: 'standard' | 'rare'
  note?: string
}

/**
 * Таинственное воззвание колдуна. prerequisite: уровень колдуна, другое воззвание, заговор колдуна с уроном
 * (damage) или с броском атаки (attack). spell — заклинание без ячейки (at-will — сколько угодно, long-rest — раз до
 * долгого отдыха; id — из справочника, пока заклинания нет — только nameEn), tome — «Договор гримуара» (заговоры
 * и ритуалы на выбор), resource — применения (раз до долгого отдыха).
 */
export interface InvocationDefinition {
  id: string
  name: string
  nameEn: string
  description: string
  prerequisite?: { level?: number; invocation?: string; cantrip?: 'damage' | 'attack' }
  repeatable?: boolean
  spell?: { id?: string; nameEn?: string; free: 'at-will' | 'long-rest'; self?: boolean }
  tome?: { cantrips: number; rituals: number }
  resource?: ClassResource
}

export interface PackDefinition {
  id: string
  name: string
  nameEn: string
  contents: { itemId: string; quantity: number }[]
}

export interface RulesData {
  classes: Record<string, ClassDefinition>
  backgrounds: Record<string, BackgroundDefinition>
  species: Record<string, SpeciesDefinition>
  feats: Record<string, FeatDefinition>
  packs: Record<string, PackDefinition>
  /** Языки (обычные и редкие) — rules/languages.json. */
  languages: Record<string, LanguageDefinition>
  /** Таинственные воззвания колдуна — rules/invocations.json. */
  invocations: Record<string, InvocationDefinition>
  /** Справочник заклинаний и таблицы ячеек (src/data/spells.json, rules/spell-slots.json). */
  spells: SpellCatalog
  spellSlots: SpellSlotTables
  /** Справочник предметов, на который ссылаются данные. */
  catalog: ItemCatalog
}
