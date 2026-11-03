// Типы предметов. Справочник предметов — src/data/items.json.

export const ITEM_CATEGORIES = ['weapon', 'armor', 'ammunition', 'gear', 'tool', 'consumable', 'treasure'] as const
export const DAMAGE_TYPES = ['slashing', 'piercing', 'bludgeoning'] as const
export const WEAPON_PROPERTIES = [
  'ammunition',
  'finesse',
  'heavy',
  'light',
  'loading',
  'reach',
  'thrown',
  'two-handed',
  'versatile',
] as const
export const WEAPON_MASTERIES = ['cleave', 'graze', 'nick', 'push', 'sap', 'slow', 'topple', 'vex'] as const
export const ARMOR_TYPES = ['light', 'medium', 'heavy', 'shield'] as const
export const WEAPON_KINDS = ['simple', 'martial'] as const
/** Вид инструмента: ремесленные, игровой набор, музыкальный инструмент, прочие наборы. */
export const TOOL_KINDS = ['artisan', 'gaming', 'musical', 'kit'] as const

export type ItemCategory = (typeof ITEM_CATEGORIES)[number]
export type DamageType = (typeof DAMAGE_TYPES)[number]
export type WeaponProperty = (typeof WEAPON_PROPERTIES)[number]
export type WeaponMastery = (typeof WEAPON_MASTERIES)[number]
export type ArmorType = (typeof ARMOR_TYPES)[number]
export type WeaponKind = (typeof WEAPON_KINDS)[number]
export type ToolKind = (typeof TOOL_KINDS)[number]

export interface WeaponStats {
  /** Простое или воинское оружие — от этого зависит владение. */
  kind: WeaponKind
  /** Кубы урона в нотации «2d6». */
  damage: string
  damageType: DamageType
  properties: WeaponProperty[]
  mastery?: WeaponMastery
  /** Урон при хвате двумя руками (свойство «универсальное»). */
  versatileDamage?: string
  /** Дистанция в футах: обычная/максимальная (для метательного и стрелкового оружия). */
  range?: { normal: number; long: number }
}

export interface ArmorStats {
  type: ArmorType
  /** Базовый КД доспеха; для щита — бонус к КД. */
  baseAC: number
  /** Минимальная Сила; без неё скорость снижается на 10 футов. */
  strength?: number
  stealthDisadvantage?: boolean
}

export interface ItemDefinition {
  id: string
  name: string
  category: ItemCategory
  /** Эмодзи-иконка. */
  icon: string
  /** Вес одной штуки в фунтах. */
  weight: number
  description: string
  /** Цена в золотых (1 см = 0,1 зм, 1 мм = 0,01 зм). Без цены предмет нельзя купить. */
  cost?: number
  /** Есть у инструментов, которыми можно владеть. */
  toolKind?: ToolKind
  weapon?: WeaponStats
  armor?: ArmorStats
}

export type ItemCatalog = Record<string, ItemDefinition>
