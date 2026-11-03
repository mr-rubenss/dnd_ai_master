import { describe, expect, it } from 'vitest'
import fighterJson from '../data/characters/fighter-ratibor.json'
import itemsJson from '../data/items.json'
import type { AbilityScores, Inventory } from '../types/character'
import { abilityModifier } from '../engine/abilities'
import { armorClass, carryingCapacity, inventoryWeight, parseCharacterSheet, type ArmorClassSubject } from './character'
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
  /** Владеет всеми доспехами и щитами (как Воин). */
  const trained = { armor: ['light', 'medium', 'heavy', 'shield'] as const }
  const none = { armor: [] as const }
  const subject = (overrides: Partial<ArmorClassSubject> = {}): ArmorClassSubject => ({ abilities, proficiencies: trained, ...overrides })
  const wearing = (armor: string | null, offHand: string | null = null) => inventoryWith({ mainHand: null, offHand, armor })

  it('КД без доспеха — 10 + Ловкость', () => {
    expect(armorClass(subject(), wearing(null), catalog)).toBe(12)
    expect(armorClass(subject({ abilities: { ...abilities, dex: 8 } }), wearing(null), catalog)).toBe(9)
  })

  // Таблица доспехов SRD 5.2: [id, КД при Лов 14 (+2), при Лов 18 (+4), при Лов 8 (−1)].
  // Лёгкий: база + Лов. Средний: база + Лов, но не больше +2. Тяжёлый: только база (и минус Лов не вычитается).
  it.each([
    ['padded-armor', 13, 15, 10],
    ['leather-armor', 13, 15, 10],
    ['studded-leather', 14, 16, 11],
    ['hide-armor', 14, 14, 11],
    ['chain-shirt', 15, 15, 12],
    ['scale-mail', 16, 16, 13],
    ['breastplate', 16, 16, 13],
    ['half-plate', 17, 17, 14],
    ['ring-mail', 14, 14, 14],
    ['chain-mail', 16, 16, 16],
    ['splint-armor', 17, 17, 17],
    ['plate-armor', 18, 18, 18],
  ])('КД в доспехе %s: Лов +2 → %i, Лов +4 → %i, Лов −1 → %i', (armor, dex14, dex18, dex8) => {
    const ac = (dex: number) => armorClass(subject({ abilities: { ...abilities, dex } }), wearing(armor), catalog)
    expect([ac(14), ac(18), ac(8)]).toEqual([dex14, dex18, dex8])
  })

  it('щит даёт +2 к любому доспеху и без доспеха', () => {
    expect(armorClass(subject(), wearing(null, 'shield'), catalog)).toBe(14)
    expect(armorClass(subject(), wearing('leather-armor', 'shield'), catalog)).toBe(15)
    expect(armorClass(subject(), wearing('chain-mail', 'shield'), catalog)).toBe(18)
  })

  it('щит без владения щитами не даёт КД (SRD 5.2, владение доспехами)', () => {
    const rogue = { armor: ['light'] as const }
    expect(armorClass(subject({ proficiencies: rogue }), wearing('leather-armor', 'shield'), catalog)).toBe(13)
    expect(armorClass(subject({ proficiencies: none }), wearing(null, 'shield'), catalog)).toBe(12)
  })

  it('доспех без владения даёт свой КД: штрафы — к броскам, а не к КД', () => {
    expect(armorClass(subject({ proficiencies: none }), wearing('chain-mail'), catalog)).toBe(16)
  })

  it('Оборона: +1 к КД только в доспехе, не за один щит', () => {
    expect(armorClass(subject({ feats: ['defense'] }), wearing('chain-mail'), catalog)).toBe(17)
    expect(armorClass(subject({ feats: ['defense'] }), wearing('leather-armor', 'shield'), catalog)).toBe(16)
    expect(armorClass(subject({ feats: ['defense'] }), wearing(null, 'shield'), catalog)).toBe(14)
  })

  it('Защита без доспехов: Варвар 10 + Лов + Тел (со щитом), Монах 10 + Лов + Мдр (без щита)', () => {
    const monkish = { ...abilities, con: 14, wis: 16 }
    const barbarian = subject({ abilities: monkish, classId: 'barbarian', proficiencies: { armor: ['light', 'medium', 'shield'] } })
    const monk = subject({ abilities: monkish, classId: 'monk', proficiencies: none })
    expect(armorClass(barbarian, wearing(null), catalog)).toBe(10 + 2 + 2)
    expect(armorClass(barbarian, wearing(null, 'shield'), catalog)).toBe(10 + 2 + 2 + 2)
    // В доспехе Защита без доспехов не действует.
    expect(armorClass(barbarian, wearing('hide-armor'), catalog)).toBe(12 + 2)
    expect(armorClass(monk, wearing(null), catalog)).toBe(10 + 2 + 3)
    // Монах со щитом теряет Защиту без доспехов, а без владения щитом и щит не помогает.
    expect(armorClass(monk, wearing(null, 'shield'), catalog)).toBe(10 + 2)
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
    expect(armorClass(sheet.character, sheet.inventory, catalog)).toBe(16)
    expect(sheet.inventory.equipped).toEqual({ mainHand: 'greatsword', offHand: null, armor: 'chain-mail' })
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
    raw.inventory.equipped.offHand = 'shield'
    expect(problemsOf(raw)).toContain('inventory.equipped: Вторая рука: предмета «shield» нет в инвентаре')
  })

  it('отклоняет двуручное оружие вместе со щитом', () => {
    const raw = base()
    raw.inventory.items.push({ itemId: 'shield', quantity: 1 })
    raw.inventory.equipped.offHand = 'shield'
    expect(problemsOf(raw)).toEqual(['inventory.equipped: «Двуручный меч» — двуручное оружие и занимает обе руки, а во второй руке «Щит»'])
  })

  it('у Ратибора владения воина, солдата и человека: спасброски Силы и Телосложения, 5 навыков', () => {
    const sheet = parseCharacterSheet(fighterJson, catalog)
    expect(sheet.character.proficiencies.savingThrows).toEqual(['str', 'con'])
    expect(Object.keys(sheet.character.proficiencies.skills).sort()).toEqual(['athletics', 'insight', 'intimidation', 'perception', 'survival'])
    expect(sheet.character).toMatchObject({
      speciesId: 'human',
      backgroundId: 'soldier',
      feats: ['savage-attacker', 'alert', 'great-weapon-fighting'],
    })
    expect(sheet.character.proficiencies.tools).toEqual(['dice-set'])
    expect(sheet.character.conditions).toEqual([])
  })

  it('отклоняет неизвестный навык и неверный уровень владения', () => {
    const raw = base()
    raw.character.proficiencies = { savingThrows: ['str', 'luck'], skills: { flying: 'proficient', stealth: 'master' }, armor: ['light'], tools: [] }
    expect(problemsOf(raw)).toEqual([
      'character.proficiencies.savingThrows: массив из str, dex, con, int, wis, cha',
      'character.proficiencies.skills: неизвестный навык "flying"',
      'character.proficiencies.skills.stealth: "proficient" или "expertise", а не "master"',
    ])
  })

  it('проверяет владение доспехами: только известные виды, без повторов', () => {
    const raw = base()
    const proficiencies = raw.character.proficiencies as Record<string, unknown>
    proficiencies.armor = ['light', 'mithral']
    expect(problemsOf(raw)).toEqual(['character.proficiencies.armor: массив из light, medium, heavy, shield'])
    proficiencies.armor = ['shield', 'shield']
    expect(problemsOf(raw)).toEqual(['character.proficiencies.armor: виды доспехов не должны повторяться'])
  })

  it('«Летопись» необязательна; записи проверяются', () => {
    const raw = base()
    raw.character.chronicle = [
      { storyId: 's', storyTitle: 'Т', endedAt: 1, summary: 'Итог.', outcome: 'Конец.', startLevel: 1, endLevel: 2, finds: ['Кинжал'], fate: 'survived' },
    ]
    expect(problemsOf(raw)).toEqual([])
    raw.character.chronicle = [{ storyId: 's', fate: 'lost' }]
    expect(problemsOf(raw)).toEqual([
      'character.chronicle[0]: ожидается { storyId, storyTitle, endedAt, summary, outcome, startLevel, endLevel, finds, fate }',
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

  it('владение инструментами — только инструменты из справочника', () => {
    const raw = base()
    ;(raw.character.proficiencies as { tools: string[] }).tools = ['dice-set', 'rope']
    expect(problemsOf(raw)).toEqual(['character.proficiencies.tools: массив id инструментов из справочника'])
  })

  it('отклоняет не-оружие в слоте оружия и хиты больше максимума', () => {
    const raw = base()
    raw.inventory.equipped.mainHand = 'rope'
    raw.character.hp = 99
    expect(problemsOf(raw)).toEqual(['character.hp: целое от 0 до maxHp', 'inventory.equipped: Основная рука: «Верёвка (50 футов)» — не оружие'])
  })
})
