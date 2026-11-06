// Сроки ожидания ответа модели (мс). Общий срок — на весь ответ, простой — сколько можно ждать очередного куска
// потока (и первого тоже). Ход ведущего — дольше: длинный рассказ идёт потоком, но может занять больше минуты.
// В e2e сроки можно сократить на время страницы: window.__aiMasterTimeouts = { default: { totalMs, idleMs } }.

export interface AiTimeouts {
  totalMs: number
  idleMs: number
}

export const AI_TIMEOUT_PURPOSES = ['default', 'turn', 'background'] as const
export type AiTimeoutPurpose = (typeof AI_TIMEOUT_PURPOSES)[number]

export const AI_TIMEOUTS: Record<AiTimeoutPurpose, AiTimeouts> = {
  /** Проверка подключения, итог истории, сжатие памяти. */
  default: { totalMs: 60_000, idleMs: 20_000 },
  /** Ход ведущего в ленте. */
  turn: { totalMs: 90_000, idleMs: 20_000 },
  /** Подбор предыстории по истории героя (одна попытка). */
  background: { totalMs: 60_000, idleMs: 20_000 },
}

/** Сроки для запроса (с учётом переопределения из e2e). */
export function aiTimeouts(purpose: AiTimeoutPurpose = 'default'): AiTimeouts {
  const override = (globalThis as { __aiMasterTimeouts?: Partial<Record<AiTimeoutPurpose, Partial<AiTimeouts>>> }).__aiMasterTimeouts
  return { ...AI_TIMEOUTS[purpose], ...(override?.default ?? {}), ...(override?.[purpose] ?? {}) }
}
