// «Божественный порядок» жреца и «Изначальный порядок» друида (SRD 5.2.1, умения 1-го уровня): выбор роли и её эффекты —
// дополнительный заговор и бонус Мудрости к проверкам Интеллекта (Магия + Религия/Природа) или владение воинским
// оружием и доспехами (тяжёлыми у Защитника, средними у Стража). Чистые функции.
import { abilityModifier } from '../engine/abilities'
import type { CheckSubject } from '../engine/checks'
import type { Character } from '../types/character'
import type { ClassOrderOption, MartialWeaponTraining, RulesData } from '../types/rules'
import { needsSpellChoice, type MagicRules, type MagicSubject } from './magic'

type OrderRules = Pick<RulesData, 'classes'>

/** Порядок класса (варианты), если у класса он есть. */
export const classOrderDef = (classId: string, rules: OrderRules) => rules.classes[classId]?.order

/** Выбранный вариант порядка героя. */
export function classOrderOf(c: Pick<Character, 'classId' | 'classOrder'>, rules: OrderRules): ClassOrderOption | undefined {
  return c.classOrder ? classOrderDef(c.classId, rules)?.options.find((o) => o.id === c.classOrder) : undefined
}

/** Нужно выбрать порядок: у класса он есть, а у героя не выбран (старое сохранение или новый герой). */
export function needsOrderChoice(c: Pick<Character, 'classId' | 'classOrder'>, rules: OrderRules): boolean {
  return Boolean(classOrderDef(c.classId, rules)) && !classOrderOf(c, rules)
}

/** Проверка выбора порядка. */
export function orderProblem(classId: string, order: string | null | undefined, rules: OrderRules): string | null {
  const def = classOrderDef(classId, rules)
  if (!def) return order ? 'У этого класса нет порядка.' : null
  if (!order) return `Выберите: ${def.feature.toLowerCase()}`
  return def.options.some((o) => o.id === order) ? null : `${def.feature}: такого варианта нет.`
}

/** Владение воинским оружием с учётом порядка (Защитник, Страж). */
export function weaponTraining(c: Pick<Character, 'classId' | 'classOrder'>, rules: OrderRules): MartialWeaponTraining {
  if (classOrderOf(c, rules)?.martialWeapons) return 'all'
  return rules.classes[c.classId]?.martialWeapons ?? 'all'
}

/** Владение доспехами после выбора порядка. */
export function armorWithOrder<T extends string>(armor: readonly T[], option: ClassOrderOption | undefined): T[] {
  return [...new Set([...armor, ...((option?.armor ?? []) as T[])])]
}

/** Субъект проверок с бонусами порядка (Чудотворец, Маг: +Мдр, минимум +1). */
export function checkSubjectOf<C extends Omit<CheckSubject, 'skillBonuses'> & Pick<Character, 'classId' | 'classOrder'>>(c: C, rules: OrderRules): C & Pick<CheckSubject, 'skillBonuses'> {
  const option = classOrderOf(c, rules)
  if (!option?.skillBonus) return c
  const value = Math.max(1, abilityModifier(c.abilities[option.skillBonus.ability]))
  return { ...c, skillBonuses: [{ skills: option.skillBonus.skills, label: option.name, value }] }
}

/** Нужно ли дополнить лист героя (старое сохранение): выбрать порядок класса или заклинания. */
export function needsSheetCompletion(c: MagicSubject, rules: MagicRules): boolean {
  return needsOrderChoice(c, rules) || needsSpellChoice(c, rules)
}
