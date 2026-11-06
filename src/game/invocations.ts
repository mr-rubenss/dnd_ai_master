// Таинственные воззвания колдуна (SRD 5.2.1, «Eldritch Invocation Options»): список — rules/invocations.json,
// число по уровням — invocations класса (1 на 1-м уровне, 3 на 2-м, … 10 на 18-м). Требования: уровень колдуна,
// другое воззвание, заговор колдуна с уроном или с броском атаки. Эффекты на лист: заклинания без ячейки
// («Доспех теней», «Договор цепи»), «Договор гримуара» — 3 заговора и 2 ритуала 1-го круга из любых списков,
// применения («Дар защитников»). Чистые функции.
import type { Character, InvocationChoice } from '../types/character'
import type { InvocationDefinition, RulesData } from '../types/rules'
import type { SpellDefinition } from '../types/spells'

export type InvocationRules = Pick<RulesData, 'classes' | 'invocations' | 'spells' | 'feats'>
export type InvocationSubject = Pick<Character, 'classId' | 'level'> & Partial<Pick<Character, 'magic' | 'invocations'>>

/** Сколько воззваний положено на уровне героя (0 — не колдун). */
export function invocationCount(c: Pick<Character, 'classId' | 'level'>, rules: Pick<RulesData, 'classes'>): number {
  const table = rules.classes[c.classId]?.invocations
  return table ? (table[Math.min(20, Math.max(1, c.level)) - 1] ?? 0) : 0
}

/** Заговоры колдуна героя, подходящие требованию воззвания (с уроном / с броском атаки). */
function eligibleCantrips(c: InvocationSubject, kind: 'damage' | 'attack', rules: InvocationRules): SpellDefinition[] {
  return (c.magic?.cantrips ?? [])
    .map((id) => rules.spells[id])
    .filter((s): s is SpellDefinition => Boolean(s?.effect?.damage) && (kind === 'damage' || Boolean(s.effect?.attack)))
}

/** Почему воззвание нельзя взять (или null): требования по уровню, воззванию, заговору. */
export function invocationPrerequisiteProblem(c: InvocationSubject, inv: InvocationDefinition, chosen: InvocationChoice[], rules: InvocationRules): string | null {
  const pre = inv.prerequisite
  if (!pre) return null
  if (pre.level && c.level < pre.level) return `«${inv.name}» — с ${pre.level}-го уровня колдуна`
  if (pre.invocation && !chosen.some((x) => x.id === pre.invocation)) return `«${inv.name}» требует воззвания «${rules.invocations[pre.invocation]?.name ?? pre.invocation}»`
  if (pre.cantrip && eligibleCantrips(c, pre.cantrip, rules).length === 0)
    return `«${inv.name}» требует заговора колдуна ${pre.cantrip === 'attack' ? 'с броском атаки' : 'с уроном'}`
  return null
}

/** Воззвания, которые можно выбрать (с учётом уже выбранных). */
export function availableInvocations(c: InvocationSubject, chosen: InvocationChoice[], rules: InvocationRules): InvocationDefinition[] {
  return Object.values(rules.invocations)
    .filter((inv) => !invocationPrerequisiteProblem(c, inv, chosen, rules))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}

/** Варианты книги «Договора гримуара»: заговоры любого списка и ритуалы 1-го круга, которые ещё не подготовлены. */
export function tomeOptions(c: InvocationSubject, rules: Pick<RulesData, 'spells'>) {
  const have = new Set([...(c.magic?.cantrips ?? []), ...(c.magic?.prepared ?? [])])
  const all = Object.values(rules.spells).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  return {
    cantrips: all.filter((s) => s.level === 0 && !have.has(s.id)),
    rituals: all.filter((s) => s.level === 1 && s.ritual && !have.has(s.id)),
  }
}

/** Проверка выбора воззваний: число по таблице, требования, повторы, выбор у «Договора гримуара». */
export function invocationProblems(c: InvocationSubject, list: InvocationChoice[] | undefined, rules: InvocationRules): string[] {
  const count = invocationCount(c, rules)
  const chosen = list ?? []
  if (count === 0) return chosen.length ? ['Воззвания есть только у колдуна.'] : []
  const problems: string[] = []
  if (chosen.length !== count) problems.push(`Таинственные воззвания: выберите ${count} (выбрано ${chosen.length})`)
  chosen.forEach((x, i) => {
    const inv = rules.invocations[x.id]
    if (!inv) return problems.push(`Неизвестное воззвание «${x.id}»`)
    const pre = invocationPrerequisiteProblem(c, inv, chosen, rules)
    if (pre) problems.push(pre)
    const twins = chosen.filter((y, j) => j !== i && y.id === x.id)
    if (twins.length && !inv.repeatable) problems.push(`«${inv.name}» можно взять только один раз`)
    if (inv.repeatable && inv.prerequisite?.cantrip) {
      if (!x.spellId || !eligibleCantrips(c, inv.prerequisite.cantrip, rules).some((s) => s.id === x.spellId)) problems.push(`«${inv.name}»: выберите подходящий заговор колдуна`)
      else if (twins.some((y) => y.spellId === x.spellId)) problems.push(`«${inv.name}»: каждый раз — другой заговор`)
    }
    if (x.id === 'lessons-of-the-first-ones') {
      if (!x.feat || rules.feats[x.feat]?.category !== 'origin') problems.push(`«${inv.name}»: выберите черту происхождения`)
      else if (twins.some((y) => y.feat === x.feat)) problems.push(`«${inv.name}»: каждый раз — другая черта`)
    }
    if (inv.tome) {
      const opts = tomeOptions(c, rules)
      const cantrips = x.cantrips ?? []
      const rituals = x.rituals ?? []
      if (cantrips.length !== inv.tome.cantrips) problems.push(`«${inv.name}»: выберите ${inv.tome.cantrips} заговора (выбрано ${cantrips.length})`)
      else if (!cantrips.every((id) => opts.cantrips.some((s) => s.id === id)) || new Set(cantrips).size !== cantrips.length)
        problems.push(`«${inv.name}»: заговоры — разные и ещё не подготовленные`)
      if (rituals.length !== inv.tome.rituals) problems.push(`«${inv.name}»: выберите ${inv.tome.rituals} ритуала 1-го круга (выбрано ${rituals.length})`)
      else if (!rituals.every((id) => opts.rituals.some((s) => s.id === id)) || new Set(rituals).size !== rituals.length)
        problems.push(`«${inv.name}»: ритуалы — разные заклинания 1-го круга с пометкой «ритуал», ещё не подготовленные`)
    } else if (x.cantrips?.length || x.rituals?.length) problems.push(`«${inv.name}» не даёт книги заклинаний`)
  })
  return [...new Set(problems)]
}

export const needsInvocationChoice = (c: InvocationSubject, rules: InvocationRules) => invocationCount(c, rules) > 0 && invocationProblems(c, c.invocations, rules).length > 0

/** Подпись воззвания с выбором: «Договор гримуара (Свет, Огненный снаряд…)». */
export function invocationLabel(x: InvocationChoice, rules: Pick<RulesData, 'invocations' | 'spells' | 'feats'>): string {
  const inv = rules.invocations[x.id]
  const name = inv?.name ?? x.id
  const extra = [...(x.cantrips ?? []), ...(x.rituals ?? []), ...(x.spellId ? [x.spellId] : [])].map((id) => rules.spells[id]?.name ?? id)
  if (x.feat) extra.push(rules.feats[x.feat]?.name ?? x.feat)
  return extra.length ? `${name} (${extra.join(', ')})` : name
}
