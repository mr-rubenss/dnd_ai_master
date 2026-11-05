// Подсказки действий от ведущего. В конце ответа ведущий пишет служебную строку
// «Варианты: действие | действие | действие» (см. src/ai/dm-prompt.md). Код вырезает её из рассказа — и из текста,
// который ещё идёт потоком, — и показывает варианты кнопками под полем ввода. Чистые функции.

/** Сколько подсказок показываем. */
export const MAX_SUGGESTIONS = 3
/** Самая длинная подсказка (символов). */
export const MAX_SUGGESTION_LENGTH = 80

import type { ChatMessage } from '../types/game'

const MARKER = 'варианты'
/** Строка подсказок: «Варианты:», допускаем разметку (**Варианты:**) и маркер списка в начале. */
const MARKER_LINE = /^[\s>*_\-–—]*варианты[*_\s]*:/i

const cleanSuggestion = (raw: string) =>
  raw
    .replace(/^[\s*_\-–—•\d.)]+/, '')
    .replace(/[*_]+$/g, '')
    .replace(/^[«"„“']+|[»"“”']+$/g, '')
    .trim()

/** Разбор подсказок: допустимые варианты без повторов, не больше MAX_SUGGESTIONS. */
export function parseSuggestions(raw: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const part of raw.split(/[|;]/)) {
    const text = cleanSuggestion(part)
    const key = text.toLowerCase()
    if (!text || text.length > MAX_SUGGESTION_LENGTH || seen.has(key)) continue
    seen.add(key)
    result.push(text)
    if (result.length === MAX_SUGGESTIONS) break
  }
  return result
}

/** Рассказ без строки подсказок и сами подсказки. Строка подсказок может стоять только после рассказа. */
export function splitSuggestions(text: string): { text: string; suggestions: string[] } {
  const lines = text.split('\n')
  const index = lines.findIndex((line) => MARKER_LINE.test(line))
  if (index < 0) return { text: text.trim(), suggestions: [] }
  const rest = [lines[index].replace(MARKER_LINE, ''), ...lines.slice(index + 1)].join(' ')
  return { text: lines.slice(0, index).join('\n').trim(), suggestions: parseSuggestions(rest) }
}

/**
 * Что показать игроку из текста, который ещё приходит потоком: без строки подсказок, в том числе недописанной
 * (последняя строка, которая может оказаться началом «Варианты:»).
 */
export function streamingText(text: string): string {
  const visible = splitSuggestions(text).text
  if (visible !== text.trim()) return visible
  const lastBreak = text.lastIndexOf('\n')
  const last = text.slice(lastBreak + 1).replace(/^[\s>*_\-–—]+/, '').toLowerCase()
  if (lastBreak >= 0 && last && MARKER.startsWith(last)) return text.slice(0, lastBreak).trimEnd()
  return text
}

/** Проверка подсказок в действии: список строк, не больше MAX_SUGGESTIONS, каждая непустая и не длиннее предела. */
export function suggestionsProblem(suggestions: unknown): string | null {
  if (suggestions === undefined) return null
  if (!Array.isArray(suggestions) || suggestions.length > MAX_SUGGESTIONS) return `Подсказок может быть не больше ${MAX_SUGGESTIONS}.`
  for (const s of suggestions)
    if (typeof s !== 'string' || !s.trim() || s.length > MAX_SUGGESTION_LENGTH) return 'Подсказка должна быть короткой непустой строкой.'
  return null
}

/** Последний ответ ведущего, который можно переписать: он последний в ленте и это не карточка броска; иначе null. */
export function rewritableMessageId(messages: readonly ChatMessage[]): string | null {
  const last = messages.at(-1)
  return last && last.author === 'master' && !last.check ? last.id : null
}
