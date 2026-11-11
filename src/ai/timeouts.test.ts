import { afterEach, describe, expect, it } from 'vitest'
import { AI_TIMEOUTS, aiTimeouts } from './timeouts'

const g = globalThis as { __aiMasterTimeouts?: unknown }

describe('сроки ответа модели', () => {
  afterEach(() => delete g.__aiMasterTimeouts)

  it('ход ведущего: первый кусок ждём дольше простоя — большой запрос (~25 тыс. токенов) модель читает дольше 20 с', () => {
    expect(AI_TIMEOUTS.turn.firstMs).toBeGreaterThanOrEqual(60_000)
    expect(AI_TIMEOUTS.turn.idleMs).toBe(20_000)
    expect(AI_TIMEOUTS.turn.totalMs).toBeGreaterThan(AI_TIMEOUTS.turn.firstMs! + AI_TIMEOUTS.turn.idleMs)
    for (const t of Object.values(AI_TIMEOUTS)) expect(t.firstMs!).toBeGreaterThan(t.idleMs)
  })

  it('переопределение из e2e: простой без firstMs — первый кусок ждём столько же', () => {
    g.__aiMasterTimeouts = { turn: { totalMs: 5000, idleMs: 1500 } }
    expect(aiTimeouts('turn')).toEqual({ totalMs: 5000, firstMs: 1500, idleMs: 1500 })
    g.__aiMasterTimeouts = { turn: { totalMs: 5000, firstMs: 3000, idleMs: 1000 } }
    expect(aiTimeouts('turn')).toEqual({ totalMs: 5000, firstMs: 3000, idleMs: 1000 })
    expect(aiTimeouts('default')).toEqual(AI_TIMEOUTS.default)
  })
})
