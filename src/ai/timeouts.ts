// Сроки ожидания ответа модели (мс). Общий срок — на весь ответ; первый кусок — сколько ждать начала ответа (большой
// запрос модель сначала читает: у посредников вроде OpenRouter с запросом ~25 тыс. токенов это бывает дольше 20 с);
// простой — сколько можно ждать очередного куска потока. Служебные строки сервера («ещё работаю», keep-alive) и
// пришедшие заголовки ответа продлевают ожидание (`AiRequest.onAlive`), но не дольше общего срока.
// Ход ведущего — дольше: длинный рассказ идёт потоком, но может занять больше минуты.
// В e2e сроки можно сократить на время страницы: window.__aiMasterTimeouts = { default: { totalMs, idleMs } }
// (без firstMs ожидание первого куска — как простой).

export interface AiTimeouts {
  totalMs: number
  /** Ожидание первого куска ответа; без него — как `idleMs`. */
  firstMs?: number
  idleMs: number
}

export const AI_TIMEOUT_PURPOSES = ['default', 'turn', 'background'] as const
export type AiTimeoutPurpose = (typeof AI_TIMEOUT_PURPOSES)[number]

export const AI_TIMEOUTS: Record<AiTimeoutPurpose, AiTimeouts> = {
  /** Проверка подключения, итог истории, сжатие памяти. */
  default: { totalMs: 90_000, firstMs: 45_000, idleMs: 20_000 },
  /** Ход ведущего в ленте. */
  turn: { totalMs: 150_000, firstMs: 60_000, idleMs: 20_000 },
  /** Подбор предыстории по истории героя (одна попытка). */
  background: { totalMs: 90_000, firstMs: 45_000, idleMs: 20_000 },
}

/** Сроки для запроса (с учётом переопределения из e2e). */
export function aiTimeouts(purpose: AiTimeoutPurpose = 'default'): AiTimeouts {
  const override = (globalThis as { __aiMasterTimeouts?: Partial<Record<AiTimeoutPurpose, Partial<AiTimeouts>>> }).__aiMasterTimeouts
  const extra = { ...(override?.default ?? {}), ...(override?.[purpose] ?? {}) }
  // Переопределили простой без первого куска — первый кусок ждём столько же (короткие сроки в e2e).
  return { ...AI_TIMEOUTS[purpose], ...(extra.idleMs !== undefined && extra.firstMs === undefined ? { firstMs: extra.idleMs } : {}), ...extra }
}
