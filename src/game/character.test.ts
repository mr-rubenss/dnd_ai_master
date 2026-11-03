import { describe, expect, it } from 'vitest'
import fighterJson from '../data/characters/fighter-ratibor.json'
import itemsJson from '../data/items.json'
import type { AbilityScores, Inventory } from '../types/character'
import {
  abilityModifier,
  armorClass,
  carryingCapacity,
  inventoryWeight,
  parseCharacterSheet,
  proficiencyBonus,
} from './character'
import { parseItemCatalog } from './items'
import { ValidationError } from './validation'

const catalog = parseItemCatalog(itemsJson)
const abilities: AbilityScores = { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 }

function inventoryWith(equipped: Inventory['equipped'], extra: string[] = []): Inventory {
  const ids = [...new Set([...Object.values(equipped).filter((id): id is string => id !== null), ...extra])]
  return { gold: 0, items: ids.map((itemId) => ({ itemId, quantity: 1 })), equipped }
}

function problemsOf(raw: unknown): string[] {
  try {
    parseCharacterSheet(raw, catalog)
    return []
  } catch (error) {
    if (error instanceof ValidationError) return error.problems
    throw error
  }
}

describe('правила персонажа', () => {
  it('считает модификатор характеристики', () => {
    expect(abilityModifier(1)).toBe(-5)
    expect(abilityModifier(8)).toBe(-1)
    expect(abilityModifier(10)).toBe(0)
    expect(abilityModifier(11)).toBe(0)
    expect(abilityModifier(17)).toBe(3)
    expect(abilityModifier(20)).toBe(5)
  })

  it('считает бонус мастерства по уровню', () => {
    expect([1, 4, 5, 8, 9, 13, 17, 20].map(proficiencyBonus)).toEqual([2, 2, 3, 3, 4, 5, 6, 6])
  })

  it('КД без доспеха — 10 + Ловкость', () => {
    expect(armorClass(abilities, inventoryWith({ weapon: null, armor: null, shield: null }), catalog)).toBe(12)
  })

  it('тяжёлый доспех не добавляет Ловкость, щит даёт +2', () => {
    expect(armorClass(abilities, inventoryWith({ weapon: null, armor: 'chain-mail', shield: null }), catalog)).toBe(16)
    expect(armorClass(abilities, inventoryWith({ weapon: null, armor: 'chain-mail', shield: 'shield' }), catalog)).toBe(18)
  })

  it('грузоподъёмность — Сила × 15', () => {
    expect(carryingCapacity({ ...abilities, str: 17 })).toBe(255)
  })
})

describe('тестовый воин Ратибор (SRD 5.2)', () => {
  const sheet = parseCharacterSheet(fighterJson, catalog)

  it('проходит валидацию', () => {
    expect(sheet.character.className).toBe('Воин')
    expect(sheet.character.level).toBe(1)
  })

  it('хиты 1-го уровня: 10 (к10 воина) + модификатор Телосложения', () => {
    expect(sheet.character.maxHp).toBe(10 + abilityModifier(sheet.character.abilities.con))
    expect(sheet.character.hp).toBe(sheet.character.maxHp)
  })

  it('в кольчуге имеет КД 16, держит двуручный меч, щита нет', () => {
    expect(armorClass(sheet.character.abilities, sheet.inventory, catalog)).toBe(16)
    expect(sheet.inventory.equipped).toEqual({ weapon: 'greatsword', armor: 'chain-mail', shield: null })
  })

  it('стартовое золото 18 (4 зм воина + 14 зм солдата), вес снаряжения 143 фнт.', () => {
    expect(sheet.inventory.gold).toBe(18)
    expect(inventoryWeight(sheet.inventory, catalog)).toBe(143)
  })
})

describe('parseCharacterSheet', () => {
  const base = () => structuredClone(fighterJson) as unknown as { character: Record<string, unknown>; inventory: Inventory }

  it('отклоняет неизвестный предмет', () => {
    const raw = base()
    raw.inventory.items.push({ itemId: 'magic-sword', quantity: 1 })
    expect(problemsOf(raw)).toEqual([`inventory.items[${raw.inventory.items.length - 1}]: неизвестный предмет "magic-sword"`])
  })

  it('отклоняет экипировку, которой нет в инвентаре', () => {
    const raw = base()
    raw.inventory.equipped.shield = 'shield'
    expect(problemsOf(raw)).toContain('inventory.equipped.shield: предмета "shield" нет в инвентаре')
  })

  it('отклоняет двуручное оружие вместе со щитом', () => {
    const raw = base()
    raw.inventory.items.push({ itemId: 'shield', quantity: 1 })
    raw.inventory.equipped.shield = 'shield'
    expect(problemsOf(raw)).toEqual(['inventory.equipped: двуручное оружие нельзя использовать вместе со щитом'])
  })

  it('отклоняет не-оружие в слоте оружия и хиты больше максимума', () => {
    const raw = base()
    raw.inventory.equipped.weapon = 'rope'
    raw.character.hp = 99
    expect(problemsOf(raw)).toEqual(['character.hp: целое от 0 до maxHp', 'inventory.equipped.weapon: "rope" — не оружие'])
  })
})
