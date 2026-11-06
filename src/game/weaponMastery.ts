// «Приёмы оружия» (Weapon Mastery, SRD 5.2.1): Варвар — 2 вида простого или воинского рукопашного оружия, Воин —
// 3 вида простого или воинского, Паладин, Следопыт и Плут — 2 вида оружия, которым владеют. Число по уровням —
// weaponMastery.count класса. После долгого отдыха Варвар и Воин меняют один вид, остальные — весь выбор.
// Эффекты приёмов в бою появятся с боевой системой; здесь — выбор, проверка и пометка «приём освоен». Чистые функции.
import type { Character } from '../types/character'
import { isRangedWeapon, type ItemCatalog, type ItemDefinition } from '../types/items'
import type { RulesData, WeaponMasteryRule } from '../types/rules'
import { isWeaponProficient } from './attacks'
import { weaponTraining } from './classOrder'

export type MasteryRules = Pick<RulesData, 'classes' | 'catalog'>
export type MasterySubject = Pick<Character, 'classId' | 'level' | 'classOrder'> & Partial<Pick<Character, 'weaponMasteries' | 'masterySwapReady'>>

export const masteryRule = (classId: string, rules: Pick<RulesData, 'classes'>): WeaponMasteryRule | undefined => rules.classes[classId]?.weaponMastery

/** Сколько видов оружия героя с освоенными приёмами (0 — у класса приёмов нет). */
export function masteryCount(c: Pick<Character, 'classId' | 'level'>, rules: Pick<RulesData, 'classes'>): number {
  const rule = masteryRule(c.classId, rules)
  return rule ? (rule.count[Math.min(20, Math.max(1, c.level)) - 1] ?? 0) : 0
}

/** Какие виды оружия можно выбрать: оружие справочника с приёмом, подходящее классу. */
export function masteryOptions(c: Pick<Character, 'classId' | 'classOrder'>, rules: MasteryRules): ItemDefinition[] {
  const rule = masteryRule(c.classId, rules)
  if (!rule) return []
  const training = weaponTraining(c, rules)
  return Object.values(rules.catalog)
    .filter((item) => item.weapon?.mastery)
    .filter((item) => (rule.weapons === 'melee' ? !isRangedWeapon(item.weapon!) : rule.weapons === 'proficient' ? isWeaponProficient(item, training) : true))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}

/** Подпись: какие виды можно выбрать. */
export function masteryKindText(rule: WeaponMasteryRule): string {
  if (rule.weapons === 'melee') return 'простое или воинское рукопашное оружие'
  if (rule.weapons === 'any') return 'простое или воинское оружие'
  return 'оружие, которым вы владеете'
}

/** Проверка выбора: число видов по таблице класса, виды — из подходящих, без повторов. */
export function masteryProblems(c: Pick<Character, 'classId' | 'level' | 'classOrder'>, weapons: string[] | undefined, rules: MasteryRules): string[] {
  const rule = masteryRule(c.classId, rules)
  if (!rule) return weapons?.length ? ['У этого класса нет приёмов оружия.'] : []
  const count = masteryCount(c, rules)
  const list = weapons ?? []
  const problems: string[] = []
  if (list.length !== count) problems.push(`Приёмы оружия: выберите ${count} (выбрано ${list.length})`)
  const allowed = new Set(masteryOptions(c, rules).map((i) => i.id))
  for (const id of list) if (!allowed.has(id)) problems.push(`Приёмы оружия: «${rules.catalog[id]?.name ?? id}» — не ${masteryKindText(rule)}`)
  if (new Set(list).size !== list.length) problems.push('Приёмы оружия: вид выбран дважды')
  return [...new Set(problems)]
}

/** Нужно выбрать приёмы: у класса они есть, а у героя не выбраны или выбор не сходится с правилами. */
export function needsMasteryChoice(c: MasterySubject, rules: MasteryRules): boolean {
  return Boolean(masteryRule(c.classId, rules)) && masteryProblems(c, c.weaponMasteries, rules).length > 0
}

/**
 * Можно ли записать новый выбор приёмов: если выбора нет (старое сохранение) — любой правильный; иначе — только после
 * долгого отдыха, и Варвар с Воином меняют не больше одного вида.
 */
export function masteryChangeProblem(c: MasterySubject, weapons: string[], rules: MasteryRules): string | null {
  const problems = masteryProblems(c, weapons, rules)
  if (problems.length) return problems[0]
  if (needsMasteryChoice(c, rules)) return null
  if (!c.masterySwapReady) return 'Приёмы оружия меняются после долгого отдыха.'
  const rule = masteryRule(c.classId, rules)!
  const changed = weapons.filter((id) => !(c.weaponMasteries ?? []).includes(id)).length
  if (changed === 0) return 'Выбор приёмов не изменился.'
  if (rule.swap === 'one' && changed > 1) return 'После долгого отдыха можно сменить только один вид оружия.'
  return null
}

/** Освоен ли приём этого оружия героем. */
export const hasMastery = (c: Partial<Pick<Character, 'weaponMasteries'>>, itemId: string) => (c.weaponMasteries ?? []).includes(itemId)

/** Подпись правила смены после долгого отдыха. */
export function masterySwapText(rule: WeaponMasteryRule): string {
  return rule.swap === 'one' ? 'После долгого отдыха можно сменить один вид оружия.' : 'После долгого отдыха можно сменить выбор.'
}

/** Названия выбранных видов: «Длинный меч, Метательное копьё». */
export const masteryNames = (weapons: string[] | undefined, catalog: ItemCatalog) => (weapons ?? []).map((id) => catalog[id]?.name ?? id).join(', ')
