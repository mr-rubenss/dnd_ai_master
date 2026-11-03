// Типы персонажа и инвентаря. Пример — src/data/characters/fighter-ratibor.json.

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const
export type Ability = (typeof ABILITIES)[number]
export type AbilityScores = Record<Ability, number>

export interface Character {
  id: string
  name: string
  species: string
  /** Идентификатор класса для правил (например, "fighter"). */
  classId: string
  /** Название класса для игрока. */
  className: string
  background: string
  level: number
  abilities: AbilityScores
  maxHp: number
  hp: number
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
