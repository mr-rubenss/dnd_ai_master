// «Дополните лист»: что нужно выбрать герою старого сохранения (или если выбор разошёлся с правилами) — порядок класса,
// заклинания, приёмы оружия, языки, таинственные воззвания. Одно окно для всего (SpellChoiceDialog). Чистые функции.
import type { Character, InvocationChoice } from '../types/character'
import type { CharacterMagic } from '../types/spells'
import { magicShapeProblems, invocationShapeProblems } from './character'
import { armorWithOrder, orderProblem } from './classOrder'
import { invocationProblems } from './invocations'
import { languageProblems } from './languages'
import { magicProblems } from './magic'
import { masteryProblems } from './weaponMastery'
import { needsOrderChoice } from './classOrder'
import { needsInvocationChoice } from './invocations'
import { needsLanguageChoice } from './languages'
import { needsSpellChoice, type MagicRules, type MagicSubject } from './magic'
import { needsMasteryChoice } from './weaponMastery'

export type SheetSubject = MagicSubject & Partial<Pick<Character, 'weaponMasteries' | 'languages' | 'invocations' | 'masterySwapReady'>>

/** Что именно нужно дополнить. */
export function sheetNeeds(c: SheetSubject, rules: MagicRules) {
  return {
    order: needsOrderChoice(c, rules),
    spells: needsSpellChoice(c, rules),
    masteries: needsMasteryChoice(c, rules),
    languages: needsLanguageChoice(c, rules),
    invocations: needsInvocationChoice(c, rules),
  }
}

/** Нужно ли дополнить лист героя (старое сохранение). */
export function needsSheetCompletion(c: SheetSubject, rules: MagicRules): boolean {
  return Object.values(sheetNeeds(c, rules)).some(Boolean)
}

/** Что игрок выбрал в окне «Дополните лист» (только то, что нужно было дополнить). */
export interface SheetCompletion {
  order?: string
  magic?: CharacterMagic
  weaponMasteries?: string[]
  languages?: string[]
  invocations?: InvocationChoice[]
}

/**
 * Применить выбор к листу героя вне истории («Мои герои»): каждая часть — только если её нужно дополнить,
 * и только правильная. Возвращает новый лист или причину отказа.
 */
export function applySheetCompletion(c: Character, completion: SheetCompletion, rules: MagicRules): { character: Character } | { reason: string } {
  let next = c
  if (completion.order !== undefined) {
    if (!needsOrderChoice(next, rules)) return { reason: 'Порядок уже выбран.' }
    const problem = orderProblem(next.classId, completion.order, rules)
    if (problem) return { reason: problem }
    const option = rules.classes[next.classId]?.order?.options.find((o) => o.id === completion.order)
    next = { ...next, classOrder: completion.order, proficiencies: { ...next.proficiencies, armor: armorWithOrder(next.proficiencies.armor, option) } }
  }
  if (completion.magic) {
    if (!needsSpellChoice(next, rules)) return { reason: 'Заклинания этого героя уже выбраны.' }
    const problem = magicShapeProblems(completion.magic)[0] ?? magicProblems(next, completion.magic, rules)[0]
    if (problem) return { reason: problem }
    next = { ...next, magic: structuredClone(completion.magic) }
  }
  if (completion.weaponMasteries) {
    if (!needsMasteryChoice(next, rules)) return { reason: 'Приёмы оружия уже выбраны.' }
    const problem = masteryProblems(next, completion.weaponMasteries, rules)[0]
    if (problem) return { reason: problem }
    next = { ...next, weaponMasteries: [...completion.weaponMasteries] }
  }
  if (completion.languages) {
    if (!needsLanguageChoice(next, rules)) return { reason: 'Языки уже выбраны.' }
    const problem = languageProblems(next.classId, completion.languages, rules)[0]
    if (problem) return { reason: problem }
    next = { ...next, languages: [...completion.languages] }
  }
  if (completion.invocations) {
    if (!needsInvocationChoice(next, rules)) return { reason: 'Воззвания уже выбраны.' }
    const problem = invocationShapeProblems(completion.invocations)[0] ?? invocationProblems(next, completion.invocations, rules)[0]
    if (problem) return { reason: problem }
    next = { ...next, invocations: structuredClone(completion.invocations) }
  }
  if (needsSheetCompletion(next, rules)) return { reason: 'Лист ещё не дополнен.' }
  return { character: next }
}
