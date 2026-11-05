// Примерный подсчёт токенов — без токенизатора поставщика (он у каждого свой и в браузер не грузится).
// Оценка по числу символов с поправкой на кириллицу (русский текст «дороже» английского), а после ответа
// коэффициент уточняется по usage из ответа API (`calibrated`). Чистые функции.
import type { AiMessage, AiTool } from './types'

/** Символов на токен: кириллица, прочие буквы и цифры, пробелы и знаки. Подобрано по токенизаторам DeepSeek/GPT. */
const CYRILLIC_PER_TOKEN = 2.6
const OTHER_PER_TOKEN = 3.8
/** Служебные токены на каждое сообщение (роль, разделители). */
export const MESSAGE_OVERHEAD = 4

/** Сырая оценка без поправки на модель. */
export function rawTokens(text: string): number {
  if (!text) return 0
  let cyr = 0
  for (const ch of text) if (ch >= 'Ѐ' && ch <= 'ӿ') cyr++
  const other = text.length - cyr
  return Math.ceil(cyr / CYRILLIC_PER_TOKEN + other / OTHER_PER_TOKEN)
}

/** Сырая оценка сообщения: текст, вызовы инструментов и служебные токены. */
export function rawMessageTokens(message: AiMessage): number {
  let n = MESSAGE_OVERHEAD + rawTokens(message.content ?? '')
  if (message.role === 'assistant') for (const c of message.toolCalls ?? []) n += rawTokens(c.name) + rawTokens(c.rawArguments) + MESSAGE_OVERHEAD
  return n
}

/** Сырая оценка описаний инструментов (уходят в запрос как JSON). */
export const rawToolsTokens = (tools: readonly AiTool[] | undefined) => (tools?.length ? rawTokens(JSON.stringify(tools)) : 0)

/** Границы поправочного коэффициента: даже странный usage не должен сломать бюджет. */
export const MIN_FACTOR = 0.5
export const MAX_FACTOR = 3

/**
 * Новый коэффициент по usage: сколько токенов на самом деле насчитал поставщик против нашей сырой оценки.
 * Сглаживание — чтобы один необычный запрос не дёргал бюджет.
 */
export function calibrated(factor: number, raw: number, actual: number): number {
  if (!(raw > 0) || !(actual > 0)) return factor
  const next = factor * 0.6 + (actual / raw) * 0.4
  return Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, Math.round(next * 1000) / 1000))
}

/** Оценка с поправкой: сколько токенов, вероятно, насчитает поставщик. */
export const estimate = (raw: number, factor: number) => Math.ceil(raw * factor)
