// Справочник заклинаний (src/data/spells.json) и таблицы ячеек (src/data/rules/spell-slots.json): загрузка и проверка
// схемой. Ошибка в JSON (в том числе сгенерированном ИИ) не доходит до игры. Чистые функции.
import { ABILITIES } from '../engine/abilities'
import { parseDice } from '../engine/dice'
import { ALL_DAMAGE_TYPES, SPELL_SCHOOLS, type SpellCatalog, type SpellDefinition, type SpellSlotTables } from '../types/spells'
import { isInt, isNonEmptyString, isObject, isOneOf, ValidationError } from './validation'

/** Классы, у которых есть списки заклинаний SRD 5.2. */
export const SPELL_LIST_CLASSES = ['bard', 'cleric', 'druid', 'paladin', 'ranger', 'sorcerer', 'warlock', 'wizard'] as const
/** Самый высокий круг в справочнике (пока только заговоры и 1-й круг). */
export const MAX_SPELL_LEVEL = 1

/** Запись кубиков, которую понимает движок («2d8», «3d4+3»). */
export function isDiceNotation(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    parseDice(value)
    return true
  } catch {
    return false
  }
}

export function parseSpellCatalog(raw: unknown): SpellCatalog {
  const problems: string[] = []
  const fail = (message: string) => problems.push(message)
  if (!Array.isArray(raw)) throw new ValidationError('Некорректный справочник заклинаний', ['ожидается массив заклинаний'])
  const catalog: SpellCatalog = {}
  raw.forEach((spell: unknown, i) => {
    let where = `spells[${i}]`
    if (!isObject(spell) || !isNonEmptyString(spell.id)) return fail(`${where}: нужен объект с непустым "id"`)
    where += ` "${spell.id}"`
    if (catalog[spell.id]) fail(`${where}: повторяющийся id`)
    for (const key of ['name', 'castingTime', 'range', 'duration', 'description'] as const) {
      if (!isNonEmptyString(spell[key])) fail(`${where}: "${key}" — непустая строка`)
    }
    if (!isInt(spell.level) || spell.level < 0 || spell.level > MAX_SPELL_LEVEL) fail(`${where}: "level" — от 0 (заговор) до ${MAX_SPELL_LEVEL}`)
    if (!isOneOf(SPELL_SCHOOLS, spell.school)) fail(`${where}: "school" — одна из: ${SPELL_SCHOOLS.join(', ')}`)
    const c = spell.components
    if (!isObject(c) || typeof c.verbal !== 'boolean' || typeof c.somatic !== 'boolean' || (c.material !== undefined && !isNonEmptyString(c.material)))
      fail(`${where}: "components" — { verbal, somatic, material? }`)
    else if (!c.verbal && !c.somatic && c.material === undefined) fail(`${where}: у заклинания нет ни одного компонента`)
    if (typeof spell.concentration !== 'boolean') fail(`${where}: "concentration" — true или false`)
    if (typeof spell.ritual !== 'boolean') fail(`${where}: "ritual" — true или false`)
    if (spell.ritual === true && spell.level === 0) fail(`${where}: заговор не бывает ритуалом`)
    if (!Array.isArray(spell.classes) || spell.classes.length === 0 || !spell.classes.every((x) => isOneOf(SPELL_LIST_CLASSES, x)))
      fail(`${where}: "classes" — непустой список из: ${SPELL_LIST_CLASSES.join(', ')}`)
    if (spell.effect !== undefined) {
      const e = spell.effect
      if (!isObject(e)) fail(`${where}: "effect" — объект`)
      else {
        if (e.attack !== undefined && e.attack !== 'melee' && e.attack !== 'ranged') fail(`${where}: effect.attack — melee или ranged`)
        if (e.save !== undefined && !isOneOf(ABILITIES, e.save)) fail(`${where}: effect.save — характеристика`)
        if (e.attack !== undefined && e.save !== undefined) fail(`${where}: effect — либо атака, либо спасбросок`)
        if (e.onSave !== undefined && (e.save === undefined || (e.onSave !== 'half' && e.onSave !== 'none'))) fail(`${where}: effect.onSave — half или none, только со спасброском`)
        const d = e.damage
        if (d !== undefined && (!isObject(d) || !isDiceNotation(d.dice) || !isOneOf(ALL_DAMAGE_TYPES, d.type))) fail(`${where}: effect.damage — { dice: «2d8», type: тип урона }`)
        if (e.healing !== undefined && !isDiceNotation(e.healing)) fail(`${where}: effect.healing — кубики («2d8»)`)
        if (e.addModifier !== undefined && (typeof e.addModifier !== 'boolean' || e.healing === undefined)) fail(`${where}: effect.addModifier — только с healing`)
        if (e.light !== undefined && e.light !== true) fail(`${where}: effect.light — true`)
        if (e.attack !== undefined && d === undefined) fail(`${where}: у атаки заклинанием нужен урон`)
      }
    }
    catalog[spell.id] = spell as unknown as SpellDefinition
  })
  if (problems.length > 0) throw new ValidationError('Некорректный справочник заклинаний', problems)
  return catalog
}

export function parseSpellSlotTables(raw: unknown): SpellSlotTables {
  const problems: string[] = []
  const levels = (list: unknown, where: string) => {
    if (!Array.isArray(list) || list.length !== 20) return problems.push(`${where}: 20 строк — по уровням 1–20`)
    list.forEach((row, i) => {
      if (!Array.isArray(row) || row.length < 1 || row.length > 9 || !row.every((n) => isInt(n) && n >= 0)) problems.push(`${where}[${i}]: ячейки по кругам — целые ≥ 0`)
    })
  }
  if (!isObject(raw)) throw new ValidationError('Некорректные таблицы ячеек', ['ожидается объект { full, half, pact }'])
  levels(raw.full, 'full')
  levels(raw.half, 'half')
  const pact = raw.pact
  const ints = (a: unknown, min: number, max: number) => Array.isArray(a) && a.length === 20 && a.every((n) => isInt(n) && n >= min && n <= max)
  if (!isObject(pact) || !ints(pact.slots, 1, 4) || !ints(pact.level, 1, 5)) problems.push('pact: { slots, level } — по 20 целых')
  if (problems.length > 0) throw new ValidationError('Некорректные таблицы ячеек', problems)
  return raw as unknown as SpellSlotTables
}
