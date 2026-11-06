// Заклинания SRD 5.2: справочник (src/data/spells.json, проверка — parseSpellCatalog в src/game/spells.ts)
// и магия героя в листе персонажа (Character.magic). Производное (ячейки всего, Сл, бонус атаки) не хранится —
// его считает src/game/magic.ts по таблицам классов (src/data/rules/classes.json, spell-slots.json).
import type { Ability } from '../engine/abilities'

export const SPELL_SCHOOLS = ['abjuration', 'conjuration', 'divination', 'enchantment', 'evocation', 'illusion', 'necromancy', 'transmutation'] as const
export type SpellSchool = (typeof SPELL_SCHOOLS)[number]

export const SPELL_SCHOOL_NAMES: Record<SpellSchool, string> = {
  abjuration: 'Ограждение',
  conjuration: 'Вызов',
  divination: 'Прорицание',
  enchantment: 'Очарование',
  evocation: 'Воплощение',
  illusion: 'Иллюзия',
  necromancy: 'Некромантия',
  transmutation: 'Преобразование',
}

/** Все типы урона SRD 5.2. */
export const ALL_DAMAGE_TYPES = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'] as const

/** Урон заклинания: кубики (запись движка, «3d4+3») и тип урона SRD. */
export interface SpellDamage {
  dice: string
  type: string
}

/**
 * Структурированный эффект — то, что движок умеет исполнить сам: атака заклинанием, спасбросок цели, урон,
 * лечение (+ модификатор характеристики заклинаний), свет. Нет поля — эффект только описанием.
 */
export interface SpellEffect {
  attack?: 'melee' | 'ranged'
  save?: Ability
  /** Что при успешном спасброске: половина урона или ничего. */
  onSave?: 'half' | 'none'
  damage?: SpellDamage
  healing?: string
  addModifier?: boolean
  light?: boolean
}

export interface SpellDefinition {
  id: string
  name: string
  /** Английское название из SRD 5.2.1 (русское — наш перевод). */
  nameEn: string
  /** Круг: 0 — заговор. */
  level: number
  school: SpellSchool
  castingTime: string
  range: string
  components: { verbal: boolean; somatic: boolean; material?: string }
  duration: string
  concentration: boolean
  ritual: boolean
  /** Списки классов (id классов), в которые входит заклинание. */
  classes: string[]
  description: string
  effect?: SpellEffect
}

export type SpellCatalog = Record<string, SpellDefinition>

/** Как класс меняет подготовленные заклинания (SRD 5.2). */
export type SpellSwapRule = 'long-rest-any' | 'long-rest-one' | 'level-one'

/** Использование заклинаний класса: таблица по уровням 1–20 (индекс = уровень − 1). */
export interface ClassSpellcasting {
  ability: Ability
  /** Ячейки: полный заклинатель, половинный (Паладин, Следопыт) или магия договора (Колдун). */
  progression: 'full' | 'half' | 'pact'
  cantrips: number[]
  prepared: number[]
  swap: SpellSwapRule
  /** Книга заклинаний (Волшебник): заклинаний на 1-м уровне и сколько добавляется за уровень. */
  spellbook?: { start: number; perLevel: number }
}

/** Таблицы ячеек: по уровням 1–20 — сколько ячеек каждого круга (индекс = круг − 1). */
export interface SpellSlotTables {
  full: number[][]
  half: number[][]
  pact: { slots: number[]; level: number[] }
}

/** Врождённое заклинание вида: без ячейки; uses — бесплатных сотворений (по бонусу мастерства) на долгий отдых. */
export interface InnateSpellGrant {
  spellId: string
  uses?: 'proficiency'
}

/** Списки, из которых берёт заклинания черта «Посвящённый в магию». */
export const INITIATE_LISTS = ['cleric', 'druid', 'wizard'] as const
export type InitiateList = (typeof INITIATE_LISTS)[number]
/** Характеристика заклинаний вида и черты — на выбор игрока. */
export const INNATE_ABILITIES = ['int', 'wis', 'cha'] as const satisfies readonly Ability[]

/** Выбор черты «Посвящённый в магию»: список класса, характеристика, 2 заговора и 1 заклинание 1-го круга. */
export interface InitiateMagic {
  list: InitiateList
  ability: Ability
  cantrips: string[]
  spell: string
}

/**
 * Магия героя — только то, что выбрал игрок и что потрачено. Нет поля у заклинателя — заклинания ещё не выбраны
 * (старое сохранение: игра предложит выбрать).
 */
export interface CharacterMagic {
  /** Заговоры класса. */
  cantrips: string[]
  /** Подготовленные заклинания класса. */
  prepared: string[]
  /** Книга заклинаний (Волшебник): подготовленные — из неё. */
  spellbook?: string[]
  /** Потрачено ячеек по кругам: «1» → 1. У Колдуна — ячейки магии договора (их круг). */
  slotsUsed: Record<string, number>
  initiate?: InitiateMagic
  /** Характеристика врождённых заклинаний вида (нет — лучшая из Инт/Мдр/Хар). */
  speciesAbility?: Ability
  /** Потрачено бесплатных сотворений: ключ — «источник:заклинание» (initiate:sleep, species:speak-with-animals). */
  freeUsed?: Record<string, number>
}
