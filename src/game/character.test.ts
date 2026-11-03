import { describe, expect, it } from 'vitest'
import fighterJson from '../data/characters/fighter-ratibor.json'
import itemsJson from '../data/items.json'
import type { AbilityScores, Inventory } from '../types/character'
import { abilityModifier } from '../engine/abilities'
import { armorClass, carryingCapacity, inventoryWeight, parseCharacterSheet } from './character'
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

  it('стартовое золото 18 (4 зм воина + 14 зм солдата), вес снаряжения 148 фнт.', () => {
    expect(sheet.inventory.gold).toBe(18)
    expect(inventoryWeight(sheet.inventory, catalog)).toBe(148)
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

  it('у Ратибора владения воина, солдата и человека: спасброски Силы и Телосложения, 5 навыков', () => {
    const sheet = parseCharacterSheet(fighterJson, catalog)
    expect(sheet.character.proficiencies.savingThrows).toEqual(['str', 'con'])
    expect(Object.keys(sheet.character.proficiencies.skills).sort()).toEqual(['athletics', 'insight', 'intimidation', 'perception', 'survival'])
    expect(sheet.character).toMatchObject({ speciesId: 'human', backgroundId: 'soldier', feats: ['savage-attacker', 'alert'] })
    expect(sheet.character.conditions).toEqual([])
  })

  it('отклоняет неизвестный навык и неверный уровень владения', () => {
    const raw = base()
    raw.character.proficiencies = { savingThrows: ['str', 'luck'], skills: { flying: 'proficient', stealth: 'master' } }
    expect(problemsOf(raw)).toEqual([
      'character.proficiencies.savingThrows: массив из str, dex, con, int, wis, cha',
      'character.proficiencies.skills: неизвестный навык "flying"',
      'character.proficiencies.skills.stealth: "proficient" или "expertise", а не "master"',
    ])
  })

  it('проверяет состояния: известные, без повторов, уровень только у Истощения (1–6)', () => {
    const raw = base()
    raw.character.conditions = [
      { id: 'poisoned' },
      { id: 'poisoned' },
      { id: 'exhaustion', level: 7 },
      { id: 'frightened', level: 1 },
      { id: 'cursed' },
    ]
    expect(problemsOf(raw)).toEqual([
      'character.conditions[1]: состояние "poisoned" указано дважды',
      'character.conditions[2]: уровень Истощения — целое от 1 до 6',
      'character.conditions[3]: уровень есть только у Истощения',
      'character.conditions[4]: неизвестное состояние',
    ])
  })

  it('отклоняет не-оружие в слоте оружия и хиты больше максимума', () => {
    const raw = base()
    raw.inventory.equipped.weapon = 'rope'
    raw.character.hp = 99
    expect(problemsOf(raw)).toEqual(['character.hp: целое от 0 до maxHp', 'inventory.equipped.weapon: "rope" — не оружие'])
  })
})
