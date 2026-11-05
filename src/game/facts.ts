// Журнал фактов ведущего: правила записи. Факт — заметка мастера: одна строка до ~20 слов, имена точно.
// Движок ограничивает длину, повтор обновляет старую запись, при объединении фактов ни одно имя не теряется.
// Чистые функции.
import type { WorldFact } from '../types/story'

/** Жёсткий предел слов в факте (в промтах просим ~20). */
export const MAX_FACT_WORDS = 30
export const MAX_FACT_CHARS = 240
/** Журнал фактов «разросся» — пора объединять повторы и устаревшее. */
export const FACTS_SOFT_CHARS = 4_000
export const FACTS_SOFT_COUNT = 60

const words = (text: string) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w))

/** Проблема с текстом факта (для модели — просьба сократить) или null. */
export function factProblem(text: string): string | null {
  const t = text.trim()
  if (!t) return 'Пустой факт.'
  if (t.includes('\n')) return 'Факт — одна строка. Запиши каждый факт отдельным вызовом.'
  const n = words(t).length
  if (n > MAX_FACT_WORDS || t.length > MAX_FACT_CHARS)
    return `Факт слишком длинный (${n} слов). Сократи до ~20 слов в стиле заметки мастера: без прилагательных и вводных слов, имена — точно.`
  return null
}

/** Основы слов (первые 5 букв) — чтобы «Тобиас»/«Тобиаса» и «должен»/«должна» считались одним словом. */
const stems = (text: string) => new Set(words(text.toLowerCase()).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 5)).filter(Boolean))

/** Похожесть двух фактов (доля общих основ слов, 0…1). */
export function factSimilarity(a: string, b: string): number {
  const x = stems(a)
  const y = stems(b)
  if (x.size === 0 || y.size === 0) return 0
  let common = 0
  for (const s of x) if (y.has(s)) common++
  return common / (x.size + y.size - common)
}

/** С какого порога новый факт считается повтором уже записанного (тогда запись обновляется). */
export const SAME_FACT_SIMILARITY = 0.5

/** Уже записанный факт, который повторяет новый (самый похожий), или undefined. */
export function sameFact(facts: readonly WorldFact[], text: string): WorldFact | undefined {
  let best: WorldFact | undefined
  let bestScore = SAME_FACT_SIMILARITY
  for (const f of facts) {
    const score = factSimilarity(f.text, text)
    if (score >= bestScore) {
      best = f
      bestScore = score
    }
  }
  return best
}

/**
 * Имена и названия в фактах: слова с заглавной буквы не в начале строки, а также первое слово строки вида
 * «Имя — …» (так рекомендуют писать факты). Кавычки «…» тоже считаются названием.
 */
export function namesIn(texts: readonly string[]): string[] {
  const names = new Set<string>()
  for (const text of texts) {
    for (const m of text.matchAll(/«([^»]{2,40})»/g)) names.add(m[1].trim())
    // Слова в кавычках — уже название целиком.
    const ws = text.replace(/«[^»]*»/g, ' ').replace(/["]/g, ' ').split(/\s+/).filter(Boolean)
    ws.forEach((raw, i) => {
      const w = raw.replace(/^[^\p{L}]+|[^\p{L}-]+$/gu, '')
      if (w.length < 3 || !/^\p{Lu}/u.test(w)) return
      if (i === 0 && ws[1] !== '—' && ws[1] !== '-' && !raw.endsWith(':')) return
      names.add(w)
    })
  }
  return [...names]
}

/** Есть ли имя в тексте — с начала слова, с учётом окончаний: «Тобиас» → «Тобиаса», «Брам» → «Брама» (но не «брата»). */
function mentions(text: string, name: string): boolean {
  const lower = text.toLowerCase()
  const n = name.toLowerCase()
  if (n.includes(' ')) return lower.includes(n)
  const stem = n.length <= 4 ? n : n.slice(0, Math.max(4, n.length - 2))
  return new RegExp(`(^|[^\\p{L}])${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(lower)
}

/** Имена из старых фактов, которых нет в новых (при объединении фактов их терять нельзя). */
export function lostNames(before: readonly string[], after: readonly string[]): string[] {
  const joined = after.join('\n')
  return namesIn(before).filter((name) => !mentions(joined, name))
}

/** Общая длина журнала фактов в символах. */
export const factsChars = (facts: readonly WorldFact[]) => facts.reduce((n, f) => n + f.text.length + 3, 0)

/** Журнал фактов разросся — нужно объединить повторы и устаревшее. */
export const factsTooLarge = (facts: readonly WorldFact[]) => facts.length > FACTS_SOFT_COUNT || factsChars(facts) > FACTS_SOFT_CHARS
