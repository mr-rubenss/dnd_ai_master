// Мягкое сопоставление названия заклинания: без учёта регистра и ё/е, с падежами («малой иллюзией» → «Малая
// иллюзия») — слова сравниваются по началу корня (общему началу слова). Сначала — заклинания героя, затем весь
// справочник (чтобы движок мог сказать «герой его не знает», а не «такого нет»). Частичных совпадений движок
// не угадывает: «огненный шар» не превратится в «Огненный снаряд». Чистые функции.
import type { SpellDefinition } from '../types/spells'

/** Нормализация: нижний регистр, ё → е, без кавычек и знаков. */
export const normalizeSpellText = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'„“”.,!?:;()[\]-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Значимые слова (короткие предлоги и союзы — «от», «и» — не считаются). */
const words = (s: string) => normalizeSpellText(s).split(' ').filter((w) => w.length > 2)

/**
 * Одно ли это слово в разных падежах: общее начало не короче 3 букв и отличается от более короткого слова не больше
 * чем на 3 буквы окончания («малой»/«малая», «иллюзией»/«иллюзия», «стрелу»/«стрела»).
 */
export function sameWord(a: string, b: string): boolean {
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  return p >= 3 && p >= Math.min(a.length, b.length) - 3
}

/** Все значимые слова названия есть в тексте (в любом падеже). */
export function nameInText(name: string, text: string): boolean {
  const nameWords = words(name)
  const textWords = words(text)
  return nameWords.length > 0 && nameWords.every((n) => textWords.some((t) => sameWord(n, t)))
}

/** Запрос называет именно это заклинание: id, название или английское название — точно или с падежами. */
export function spellMatches(spell: Pick<SpellDefinition, 'id' | 'name' | 'nameEn'>, query: string): 'exact' | 'words' | null {
  const q = normalizeSpellText(query)
  if (!q) return null
  if (query.trim() === spell.id || q === normalizeSpellText(spell.name) || (spell.nameEn && q === normalizeSpellText(spell.nameEn))) return 'exact'
  const qWords = words(q)
  const fits = (name: string) => {
    const n = words(name)
    // Все слова названия — в запросе, а лишних слов в запросе не больше одного («заговор малая иллюзия»).
    return n.length > 0 && n.every((w) => qWords.some((t) => sameWord(w, t))) && qWords.length <= n.length + 1
  }
  return fits(spell.name) || (spell.nameEn ? fits(spell.nameEn) : false) ? 'words' : null
}

export type SpellLookup = { spell: SpellDefinition } | { ambiguous: SpellDefinition[] } | null

/** Найти заклинание по запросу: среди заклинаний героя, затем во всём справочнике. Несколько подходящих — неоднозначно. */
export function findSpell(query: string, known: readonly SpellDefinition[], catalog: Record<string, SpellDefinition>): SpellLookup {
  const all = Object.values(catalog)
  for (const pool of [known, all]) {
    const exact = pool.filter((s) => spellMatches(s, query) === 'exact')
    if (exact.length === 1) return { spell: exact[0] }
    const byWords = pool.filter((s) => spellMatches(s, query) !== null)
    if (byWords.length === 1) return { spell: byWords[0] }
    if (byWords.length > 1) return { ambiguous: byWords }
  }
  return null
}
