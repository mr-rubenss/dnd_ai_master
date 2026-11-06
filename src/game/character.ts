// Правила персонажа (SRD 5.2) и валидация листа персонажа. Чистые функции.

import { ABILITIES, abilityModifier, type AbilityScores } from '../engine/abilities'
import { CONDITIONS, MAX_EXHAUSTION } from '../engine/conditions'
import { SKILLS } from '../engine/skills'
import type { Character, CharacterSheet, Equipment, Inventory } from '../types/character'
import { ARMOR_TYPES, type ArmorType, type ItemCatalog } from '../types/items'
import { coinsFromGold, isCoins } from './coins'
import { EQUIPMENT_SLOTS, equipmentProblems } from './equipment'
import { isInt, isNonEmptyString, isNumber, isObject, ValidationError } from './validation'

/** Что нужно для расчёта КД. */
export interface ArmorClassSubject {
  abilities: AbilityScores
  classId?: string
  /** id черт: Оборона даёт +1 в доспехе. */
  feats?: string[]
  /** Владение доспехами: без владения щитами щит не даёт КД. */
  proficiencies: { armor: readonly ArmorType[] }
}

/**
 * Класс доспеха от надетой экипировки.
 * Без доспеха: 10 + Лов (Защита без доспехов: Варвар +Тел, Монах без щита +Мдр).
 * Лёгкий: база + Лов. Средний: база + Лов (макс. +2). Тяжёлый: база. Щит во второй руке: +2,
 * но только при владении щитами (SRD 5.2, Armor Training: без него щит не даёт КД).
 * Доспех без владения КД даёт как обычно (штрафы — помеха к броскам Сил/Лов и запрет колдовства).
 * Оборона (боевой стиль): +1, если надет доспех.
 */
export function armorClass(subject: ArmorClassSubject, inventory: Inventory, catalog: ItemCatalog): number {
  const { abilities, classId } = subject
  const dex = abilityModifier(abilities.dex)
  const armor = inventory.equipped.armor ? catalog[inventory.equipped.armor]?.armor : undefined
  const offHand = inventory.equipped.offHand ? catalog[inventory.equipped.offHand]?.armor : undefined
  const shield = offHand?.type === 'shield' ? offHand : undefined
  let ac: number
  if (!armor && classId === 'barbarian') ac = 10 + dex + abilityModifier(abilities.con)
  else if (!armor && classId === 'monk' && !shield) ac = 10 + dex + abilityModifier(abilities.wis)
  else if (!armor) ac = 10 + dex
  else if (armor.type === 'light') ac = armor.baseAC + dex
  else if (armor.type === 'medium') ac = armor.baseAC + Math.min(dex, 2)
  else ac = armor.baseAC

  if (shield && subject.proficiencies.armor.includes('shield')) ac += shield.baseAC
  if (armor && subject.feats?.includes('defense')) ac += 1
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
/** Самая длинная «История героя» (символов). */
export const MAX_BACKSTORY_LENGTH = 2000

/**
 * Миграция старых сохранений: золото числом (`gold`, с дробной частью) → кошелёк монетами (`coins`).
 * Применяется к листам героев, к началу истории (storyCreated) и к сохранённым снимкам.
 */
export function migrateInventory<T>(inventory: T): T {
  if (!isObject(inventory) || isCoins(inventory.coins)) return inventory
  const { gold, ...rest } = inventory as Record<string, unknown>
  return { ...rest, coins: coinsFromGold(typeof gold === 'number' && gold > 0 ? gold : 0) } as T
}

export function migrateSheet<T>(sheet: T): T {
  return isObject(sheet) && isObject(sheet.inventory) ? ({ ...sheet, inventory: migrateInventory(sheet.inventory) } as T) : sheet
}

export function parseCharacterSheet(input: unknown, catalog: ItemCatalog): CharacterSheet {
  const problems: string[] = []
  const fail = (message: string) => problems.push(message)
  const title = 'Некорректный лист персонажа'
  if (!isObject(input)) throw new ValidationError(title, ['лист персонажа должен быть объектом'])
  const raw = migrateSheet(input)

  const ch = raw.character
  if (!isObject(ch)) {
    fail('"character" должно быть объектом')
  } else {
    for (const key of ['id', 'name', 'species', 'classId', 'className', 'background', 'speciesId', 'backgroundId'] as const) {
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

    if (ch.speciesOption !== null && typeof ch.speciesOption !== 'string') fail('character.speciesOption: строка или null')
    if (!Array.isArray(ch.feats) || !ch.feats.every((f) => typeof f === 'string')) fail('character.feats: массив id черт')
    if (typeof ch.appearance !== 'string') fail('character.appearance: строка')
    if (ch.backstory !== undefined && (typeof ch.backstory !== 'string' || ch.backstory.length > MAX_BACKSTORY_LENGTH))
      fail(`character.backstory: строка не длиннее ${MAX_BACKSTORY_LENGTH} символов`)
    if (ch.chronicle !== undefined) {
      if (!Array.isArray(ch.chronicle)) fail('character.chronicle: массив записей «Летописи»')
      else {
        ch.chronicle.forEach((e: unknown, i) => {
          const ok =
            isObject(e) &&
            ['storyId', 'storyTitle', 'summary', 'outcome'].every((k) => isNonEmptyString(e[k])) &&
            isNumber(e.endedAt) &&
            isInt(e.startLevel) &&
            isInt(e.endLevel) &&
            Array.isArray(e.finds) &&
            e.finds.every((f) => typeof f === 'string') &&
            (e.fate === 'survived' || e.fate === 'fallen')
          if (!ok) fail(`character.chronicle[${i}]: ожидается { storyId, storyTitle, endedAt, summary, outcome, startLevel, endLevel, finds, fate }`)
        })
      }
    }

    const prof = ch.proficiencies
    if (!isObject(prof)) {
      fail('character.proficiencies: должно быть объектом { savingThrows, skills }')
    } else {
      if (!Array.isArray(prof.savingThrows) || !prof.savingThrows.every((a) => (ABILITIES as readonly unknown[]).includes(a))) {
        fail(`character.proficiencies.savingThrows: массив из ${ABILITIES.join(', ')}`)
      } else if (new Set(prof.savingThrows).size !== prof.savingThrows.length) {
        fail('character.proficiencies.savingThrows: характеристики не должны повторяться')
      }
      if (!Array.isArray(prof.armor) || !prof.armor.every((t) => (ARMOR_TYPES as readonly unknown[]).includes(t))) {
        fail(`character.proficiencies.armor: массив из ${ARMOR_TYPES.join(', ')}`)
      } else if (new Set(prof.armor).size !== prof.armor.length) {
        fail('character.proficiencies.armor: виды доспехов не должны повторяться')
      }
      if (!Array.isArray(prof.tools) || !prof.tools.every((t) => typeof t === 'string' && catalog[t]?.toolKind !== undefined)) {
        fail('character.proficiencies.tools: массив id инструментов из справочника')
      }
      if (!isObject(prof.skills)) {
        fail('character.proficiencies.skills: должно быть объектом { навык: "proficient" | "expertise" }')
      } else {
        for (const [skill, level] of Object.entries(prof.skills)) {
          if (!(SKILLS as readonly string[]).includes(skill)) fail(`character.proficiencies.skills: неизвестный навык "${skill}"`)
          else if (level !== 'proficient' && level !== 'expertise') {
            fail(`character.proficiencies.skills.${skill}: "proficient" или "expertise", а не ${JSON.stringify(level)}`)
          }
        }
      }
    }

    if (!Array.isArray(ch.conditions)) {
      fail('character.conditions: должно быть массивом состояний')
    } else {
      const seen = new Set<string>()
      ch.conditions.forEach((c: unknown, i) => {
        const where = `character.conditions[${i}]`
        if (!isObject(c) || !(CONDITIONS as readonly unknown[]).includes(c.id)) return fail(`${where}: неизвестное состояние`)
        const id = c.id as string
        if (seen.has(id)) fail(`${where}: состояние "${id}" указано дважды`)
        seen.add(id)
        if (id === 'exhaustion') {
          if (!isInt(c.level) || c.level < 1 || c.level > MAX_EXHAUSTION) fail(`${where}: уровень Истощения — целое от 1 до ${MAX_EXHAUSTION}`)
        } else if (c.level !== undefined) {
          fail(`${where}: уровень есть только у Истощения`)
        }
      })
    }
  }

  const inv = raw.inventory
  if (!isObject(inv)) {
    fail('"inventory" должно быть объектом')
  } else {
    if (!isCoins(inv.coins)) fail('inventory.coins: { gp, sp, cp } — неотрицательные целые')
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
        const uses = catalog[entry.itemId].use?.charges
        if (entry.charges !== undefined && (!uses || !isInt(entry.charges) || entry.charges < 1 || entry.charges > uses))
          fail(`${where}: "charges" — от 1 до числа применений предмета`)
      })
    }

    const eq = inv.equipped
    if (!isObject(eq) || !EQUIPMENT_SLOTS.every((slot) => eq[slot] === null || typeof eq[slot] === 'string')) {
      fail('inventory.equipped: должно быть объектом { mainHand, offHand, armor } с id предметов или null')
    } else if (Array.isArray(inv.items) && inv.items.every((e) => isObject(e) && typeof e.itemId === 'string' && catalog[e.itemId])) {
      for (const problem of equipmentProblems(eq as unknown as Equipment, inv as unknown as Inventory, catalog)) {
        fail(`inventory.equipped: ${problem}`)
      }
    }
  }

  if (problems.length > 0) throw new ValidationError(title, problems)
  return { character: ch as unknown as Character, inventory: inv as unknown as Inventory }
}
