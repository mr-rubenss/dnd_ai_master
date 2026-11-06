import type { Coins } from '../game/coins'
// Типы персонажа и инвентаря. Пример — src/data/characters/fighter-ratibor.json.

import type { AbilityScores } from '../engine/abilities'
import type { Proficiencies } from '../engine/checks'
import type { ActiveCondition } from '../engine/conditions'
import type { CharacterMagic } from './spells'

export { ABILITIES, type Ability, type AbilityScores } from '../engine/abilities'

export interface Character {
  id: string
  name: string
  species: string
  /** Идентификатор класса для правил (например, "fighter"). */
  classId: string
  /** Название класса для игрока. */
  className: string
  background: string
  /** id вида, предыстории и вариант вида (ветвь, предок) — ссылки на src/data/rules/. */
  speciesId: string
  backgroundId: string
  speciesOption: string | null
  level: number
  abilities: AbilityScores
  maxHp: number
  hp: number
  /** Владение спасбросками и навыками (с компетентностью). */
  proficiencies: Proficiencies
  /** Действующие состояния (Отравлен, Истощение 2 и т. п.). */
  conditions: ActiveCondition[]
  /** Черты (id из src/data/rules/feats.json). */
  feats: string[]
  /** Внешность — свободный текст игрока. */
  appearance: string
  /**
   * «История героя» — кем был герой, своими словами игрока («бывший моряк, сбежал после бунта, ищет брата»).
   * Всегда идёт в контекст ведущего как источник зацепок. Нет поля — не написана.
   */
  backstory?: string
  /**
   * «Летопись» — раздел предыстории героя: итоги пройденных историй по порядку.
   * Переходит вместе с героем в новые истории. Нет поля — записей ещё нет.
   */
  chronicle?: ChronicleEntry[]
  /**
   * Магия (src/game/magic.ts): выбранные заговоры и заклинания, книга, «Посвящённый в магию», потраченные ячейки.
   * Нет поля у заклинателя — заклинания ещё не выбраны (старое сохранение).
   */
  magic?: CharacterMagic
}

/** Чем закончился для героя путь в истории. */
export type ChronicleFate = 'survived' | 'fallen'

/** Запись «Летописи»: итог одной завершённой истории для героя. */
export interface ChronicleEntry {
  storyId: string
  storyTitle: string
  /** Когда история завершена, мс с начала эпохи. */
  endedAt: number
  /** Краткое содержание истории (3–6 предложений). */
  summary: string
  /** Чем всё кончилось. */
  outcome: string
  startLevel: number
  endLevel: number
  /** Ключевые находки героя: «Кинжал ×2». */
  finds: string[]
  fate: ChronicleFate
}

export interface InventoryEntry {
  itemId: string
  quantity: number
  /** Заряды у предмета с применениями (набор целителя — 10): сколько осталось у начатого; нет поля — полный. */
  charges?: number
}

/**
 * Экипировка: id предметов из инвентаря или null, если слот пуст.
 * Основная рука — оружие; вторая рука — щит или второе лёгкое оружие (пусто при двуручном хвате).
 * Правила смены — src/game/equipment.ts.
 */
export interface Equipment {
  mainHand: string | null
  offHand: string | null
  armor: string | null
}

export interface Inventory {
  /** Кошелёк: золотые, серебряные и медные монеты (src/game/coins.ts). В старых сохранениях — `gold` числом. */
  coins: Coins
  items: InventoryEntry[]
  equipped: Equipment
}

/** Стартовые данные персонажа: сам персонаж и его снаряжение. */
export interface CharacterSheet {
  character: Character
  inventory: Inventory
}
