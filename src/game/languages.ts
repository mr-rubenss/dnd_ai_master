// Языки (SRD 5.2.1, «Choose Languages»): каждый знает Общий и ещё два языка из таблицы обычных; умения класса
// дают свои: Друид — «Друидический», Плут — «Воровской жаргон» и ещё один язык из любой таблицы. В листе хранится
// весь список известных языков (Character.languages). Чистые функции.
import type { Character } from '../types/character'
import type { LanguageDefinition, RulesData } from '../types/rules'

export type LanguageRules = Pick<RulesData, 'classes' | 'languages'>

export const COMMON = 'common'
/** Сколько обычных языков выбирает каждый персонаж (кроме Общего). */
export const STANDARD_CHOICES = 2

/** Обычные языки на выбор (без Общего). */
export const standardLanguages = (rules: Pick<RulesData, 'languages'>): LanguageDefinition[] =>
  Object.values(rules.languages).filter((l) => l.rarity === 'standard' && l.id !== COMMON)

/** Языки от умений класса: заданные и сколько выбрать ещё. */
export function classLanguages(classId: string, rules: Pick<RulesData, 'classes'>) {
  const l = rules.classes[classId]?.languages
  return { fixed: l?.fixed ?? [], choose: l?.choose ?? 0, feature: rules.classes[classId]?.features.find((f) => f.nameEn === "Thieves' Cant")?.name }
}

/** Языки, известные герою, из выбора: Общий + от класса + выбранные. */
export function knownLanguages(classId: string, chosen: string[], rules: Pick<RulesData, 'classes'>): string[] {
  return [...new Set([COMMON, ...classLanguages(classId, rules).fixed, ...chosen])]
}

/** Выбор игрока из полного списка: обычные (2) и добавочные от класса. */
export function splitLanguages(classId: string, known: string[] | undefined, rules: LanguageRules): { standard: string[]; extra: string[] } {
  const { fixed, choose } = classLanguages(classId, rules)
  const rest = (known ?? []).filter((id) => id !== COMMON && !fixed.includes(id))
  const standard = rest.filter((id) => rules.languages[id]?.rarity === 'standard').slice(0, STANDARD_CHOICES)
  const extra = rest.filter((id) => !standard.includes(id)).slice(0, choose)
  return { standard, extra }
}

/** Проверка выбора при создании: два обычных и (у Плута) ещё один из любых, все разные. */
export function languageChoiceProblems(classId: string, standard: string[], extra: string[], rules: LanguageRules): string[] {
  const problems: string[] = []
  const { fixed, choose } = classLanguages(classId, rules)
  if (standard.length !== STANDARD_CHOICES) problems.push(`Языки: выберите ${STANDARD_CHOICES} из обычных (выбрано ${standard.length})`)
  if (standard.some((id) => rules.languages[id]?.rarity !== 'standard' || id === COMMON)) problems.push('Языки: два — из таблицы обычных (Общий и так известен)')
  if (extra.length !== choose) problems.push(choose ? `Язык от класса: выберите ${choose} (выбрано ${extra.length})` : 'У класса нет языка на выбор')
  if (extra.some((id) => !rules.languages[id] || id === COMMON || fixed.includes(id))) problems.push('Язык от класса: этот язык уже известен')
  const all = [...standard, ...extra]
  if (new Set(all).size !== all.length) problems.push('Язык выбран дважды')
  return [...new Set(problems)]
}

/** Проверка полного списка языков героя (старое сохранение, событие languagesChosen). */
export function languageProblems(classId: string, known: string[] | undefined, rules: LanguageRules): string[] {
  if (!known) return ['Выберите языки']
  if (known.some((id) => !rules.languages[id])) return ['Неизвестный язык']
  if (new Set(known).size !== known.length) return ['Язык указан дважды']
  if (!known.includes(COMMON)) return ['Общий язык знают все']
  const { fixed } = classLanguages(classId, rules)
  if (fixed.some((id) => !known.includes(id))) return [`Нет языка от класса: ${fixed.map((id) => rules.languages[id]?.name).join(', ')}`]
  const { standard, extra } = splitLanguages(classId, known, rules)
  const counted = new Set([COMMON, ...fixed, ...standard, ...extra])
  if (known.some((id) => !counted.has(id))) return ['Языков больше, чем положено']
  return languageChoiceProblems(classId, standard, extra, rules)
}

export const needsLanguageChoice = (c: Pick<Character, 'classId'> & Partial<Pick<Character, 'languages'>>, rules: LanguageRules) =>
  languageProblems(c.classId, c.languages, rules).length > 0

/** «Общий, Эльфийский, Драконий». */
export const languageNames = (ids: string[] | undefined, rules: Pick<RulesData, 'languages'>) => (ids ?? []).map((id) => rules.languages[id]?.name ?? id).join(', ')
