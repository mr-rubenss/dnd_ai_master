// Типы персонажа и инвентаря. Пример — src/data/characters/fighter-ratibor.json.

import type { AbilityScores } from '../engine/abilities'
import type { Proficiencies } from '../engine/checks'
import type { ActiveCondition } from '../engine/conditions'

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
}

export interface InventoryEntry {
  itemId: string
  quantity: number
}

/** Надетая экипировка: id предметов из инвентаря или null, если слот пуст. */
export interface Equipment {
  weapon: string | null
  armor: string | null
  shield: string | null
}

export interface Inventory {
  gold: number
  items: InventoryEntry[]
  equipped: Equipment
}

/** Стартовые данные персонажа: сам персонаж и его снаряжение. */
export interface CharacterSheet {
  character: Character
  inventory: Inventory
}
