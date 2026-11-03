// Справочник предметов: загрузка и валидация. Чистые функции.

import {
  ARMOR_TYPES,
  DAMAGE_TYPES,
  ITEM_CATEGORIES,
  TOOL_KINDS,
  WEAPON_KINDS,
  WEAPON_MASTERIES,
  WEAPON_PROPERTIES,
  type ItemCatalog,
  type ItemDefinition,
} from '../types/items'
import { isInt, isNonEmptyString, isNumber, isObject, isOneOf, ValidationError } from './validation'

const DICE_RE = /^\d+d\d+$/

/** Проверяет массив описаний предметов и возвращает справочник по id. */
export function parseItemCatalog(raw: unknown): ItemCatalog {
  const problems: string[] = []
  const fail = (message: string) => problems.push(message)
  if (!Array.isArray(raw)) throw new ValidationError('Некорректный справочник предметов', ['ожидается массив предметов'])

  const catalog: ItemCatalog = {}
  raw.forEach((item: unknown, i) => {
    let where = `items[${i}]`
    if (!isObject(item)) return fail(`${where}: должен быть объектом`)
    if (!isNonEmptyString(item.id)) return fail(`${where}: "id" должно быть непустой строкой`)
    where += ` "${item.id}"`
    if (catalog[item.id]) fail(`${where}: повторяющийся id`)
    for (const key of ['name', 'icon', 'description'] as const) {
      if (!isNonEmptyString(item[key])) fail(`${where}: "${key}" должно быть непустой строкой`)
    }
    if (!isOneOf(ITEM_CATEGORIES, item.category)) fail(`${where}: "category" должно быть одним из: ${ITEM_CATEGORIES.join(', ')}`)
    if (!isNumber(item.weight) || item.weight < 0) fail(`${where}: "weight" должно быть неотрицательным числом`)
    if (item.cost !== undefined && (!isNumber(item.cost) || item.cost <= 0)) fail(`${where}: "cost" — положительное число (в зм)`)
    if (item.toolKind !== undefined && !isOneOf(TOOL_KINDS, item.toolKind)) {
      fail(`${where}: "toolKind" должно быть одним из: ${TOOL_KINDS.join(', ')}`)
    }

    if (item.weapon !== undefined) {
      const w = item.weapon
      if (!isObject(w)) {
        fail(`${where}: "weapon" должно быть объектом`)
      } else {
        if (!isOneOf(WEAPON_KINDS, w.kind)) fail(`${where}: "weapon.kind" — simple или martial`)
        if (typeof w.damage !== 'string' || !DICE_RE.test(w.damage)) fail(`${where}: "weapon.damage" должно быть в нотации "2d6"`)
        if (!isOneOf(DAMAGE_TYPES, w.damageType)) fail(`${where}: "weapon.damageType" должно быть одним из: ${DAMAGE_TYPES.join(', ')}`)
        if (!Array.isArray(w.properties) || !w.properties.every((p) => isOneOf(WEAPON_PROPERTIES, p))) {
          fail(`${where}: "weapon.properties" — массив из: ${WEAPON_PROPERTIES.join(', ')}`)
        }
        if (w.mastery !== undefined && !isOneOf(WEAPON_MASTERIES, w.mastery)) {
          fail(`${where}: "weapon.mastery" должно быть одним из: ${WEAPON_MASTERIES.join(', ')}`)
        }
      }
    }
    if (item.armor !== undefined) {
      const a = item.armor
      if (!isObject(a)) {
        fail(`${where}: "armor" должно быть объектом`)
      } else {
        if (!isOneOf(ARMOR_TYPES, a.type)) fail(`${where}: "armor.type" должно быть одним из: ${ARMOR_TYPES.join(', ')}`)
        if (!isInt(a.baseAC) || a.baseAC < 0) fail(`${where}: "armor.baseAC" должно быть неотрицательным целым`)
      }
    }
    catalog[item.id] = item as unknown as ItemDefinition
  })

  if (problems.length > 0) throw new ValidationError('Некорректный справочник предметов', problems)
  return catalog
}
