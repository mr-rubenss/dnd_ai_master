// Правила персонажа (SRD 5.2) и валидация листа персонажа. Чистые функции.

import { ABILITIES, type AbilityScores, type Character, type CharacterSheet, type Inventory } from '../types/character'
import type { ItemCatalog } from '../types/items'
import { isInt, isNonEmptyString, isNumber, isObject, ValidationError } from './validation'

/** Модификатор характеристики: (значение − 10) / 2 с округлением вниз. */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2)
}

/** Бонус мастерства по уровню персонажа: +2 на 1–4, +3 на 5–8 … +6 на 17–20. */
export function proficiencyBonus(level: number): number {
  return 2 + Math.floor((level - 1) / 4)
}

/**
 * Класс доспеха от надетой экипировки.
 * Без доспеха: 10 + Лов. Лёгкий: база + Лов. Средний: база + Лов (макс. +2). Тяжёлый: база. Щит: +бонус.
 */
export function armorClass(abilities: AbilityScores, inventory: Inventory, catalog: ItemCatalog): number {
  const dex = abilityModifier(abilities.dex)
  const armor = inventory.equipped.armor ? catalog[inventory.equipped.armor]?.armor : undefined
  let ac: number
  if (!armor) ac = 10 + dex
  else if (armor.type === 'light') ac = armor.baseAC + dex
  else if (armor.type === 'medium') ac = armor.baseAC + Math.min(dex, 2)
  else ac = armor.baseAC

  const shield = inventory.equipped.shield ? catalog[inventory.equipped.shield]?.armor : undefined
  if (shield?.type === 'shield') ac += shield.baseAC
  return ac
}

/** Общий вес предметов в инвентаре, фунты. */
export function inventoryWeight(inventory: Inventory, catalog: ItemCatalog): number {
  const total = inventory.items.reduce((sum, entry) => sum + (catalog[entry.itemId]?.weight ?? 0) * entry.quantity, 0)
  return Math.round(total * 100) / 100
}

/** Грузоподъёмность: Сила × 15 фунтов (для существ Среднего размера). */
export function carryingCapacity(abilities: AbilityScores): number {
  return abilities.str * 15
}

/** Проверяет лист персонажа (персонаж + инвентарь) по справочнику предметов. */
export function parseCharacterSheet(raw: unknown, catalog: ItemCatalog): CharacterSheet {
  const problems: string[] = []
  const fail = (message: string) => problems.push(message)
  const title = 'Некорректный лист персонажа'
  if (!isObject(raw)) throw new ValidationError(title, ['лист персонажа должен быть объектом'])

  const ch = raw.character
  if (!isObject(ch)) {
    fail('"character" должно быть объектом')
  } else {
    for (const key of ['id', 'name', 'species', 'classId', 'className', 'background'] as const) {
      if (!isNonEmptyString(ch[key])) fail(`character.${key}: должно быть непустой строкой`)
    }
    if (!isInt(ch.level) || ch.level < 1 || ch.level > 20) fail('character.level: целое от 1 до 20')
    if (!isObject(ch.abilities)) {
      fail('character.abilities: должно быть объектом с характеристиками')
    } else {
      for (const ability of ABILITIES) {
        const score = ch.abilities[ability]
        if (!isInt(score) || score < 1 || score > 30) fail(`character.abilities.${ability}: целое от 1 до 30`)
      }
    }
    if (!isInt(ch.maxHp) || ch.maxHp < 1) fail('character.maxHp: положительное целое')
    if (!isInt(ch.hp) || ch.hp < 0 || (isInt(ch.maxHp) && ch.hp > ch.maxHp)) fail('character.hp: целое от 0 до maxHp')
  }

  const inv = raw.inventory
  if (!isObject(inv)) {
    fail('"inventory" должно быть объектом')
  } else {
    if (!isNumber(inv.gold) || inv.gold < 0) fail('inventory.gold: неотрицательное число')
    const owned = new Set<string>()
    if (!Array.isArray(inv.items)) {
      fail('inventory.items: должно быть массивом')
    } else {
      inv.items.forEach((entry: unknown, i) => {
        const where = `inventory.items[${i}]`
        if (!isObject(entry)) return fail(`${where}: должен быть объектом`)
        if (typeof entry.itemId !== 'string' || !catalog[entry.itemId]) {
          return fail(`${where}: неизвестный предмет "${String(entry.itemId)}"`)
        }
        if (owned.has(entry.itemId)) fail(`${where}: предмет "${entry.itemId}" указан дважды — объедините количество`)
        owned.add(entry.itemId)
        if (!isInt(entry.quantity) || entry.quantity < 1) fail(`${where}: "quantity" — положительное целое`)
      })
    }

    const eq = inv.equipped
    if (!isObject(eq)) {
      fail('inventory.equipped: должно быть объектом { weapon, armor, shield }')
    } else {
      const slot = (name: 'weapon' | 'armor' | 'shield', check: (id: string) => string | null) => {
        const id = eq[name]
        if (id === null) return
        if (typeof id !== 'string') return fail(`inventory.equipped.${name}: id предмета или null`)
        if (!owned.has(id)) return fail(`inventory.equipped.${name}: предмета "${id}" нет в инвентаре`)
        const error = check(id)
        if (error) fail(`inventory.equipped.${name}: ${error}`)
      }
      slot('weapon', (id) => (catalog[id].weapon ? null : `"${id}" — не оружие`))
      slot('armor', (id) => {
        const armor = catalog[id].armor
        return armor && armor.type !== 'shield' ? null : `"${id}" — не доспех`
      })
      slot('shield', (id) => (catalog[id].armor?.type === 'shield' ? null : `"${id}" — не щит`))

      const weaponId = typeof eq.weapon === 'string' ? eq.weapon : null
      if (weaponId && eq.shield && catalog[weaponId]?.weapon?.properties.includes('two-handed')) {
        fail('inventory.equipped: двуручное оружие нельзя использовать вместе со щитом')
      }
    }
  }

  if (problems.length > 0) throw new ValidationError(title, problems)
  return { character: ch as unknown as Character, inventory: inv as unknown as Inventory }
}
