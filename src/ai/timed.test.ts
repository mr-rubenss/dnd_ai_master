import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiError } from './errors'
import { isReasoningModel } from './settings'
import { aiResponse } from './testing'
import { timedMaster, type AttemptReport } from './timed'
import type { AiMaster, AiProgress, AiRequest } from './types'

/** Модель, которая отвечает, когда скажут, и может присылать куски потока. */
function slowMaster() {
  let resolve!: () => void
  let req!: AiRequest
  const master: AiMaster = {
    format: 'openai-chat',
    complete(r) {
      req = r
      return new Promise((ok, fail) => {
        resolve = () => ok(aiResponse({ text: 'Готово', reasoning: 'думал' }))
        r.signal?.addEventListener('abort', () => fail(new AiError('aborted')))
      })
    },
    diagnose: async () => ({ url: '', request: '', status: null, statusText: '', headers: [], lines: [] }),
  }
  const chunk = (p: Partial<AiProgress> = {}) => req.onProgress?.({ events: 1, textChars: 3, reasoningChars: 0, toolChars: 0, toolArgs: '', ...p })
  return { master, finish: () => resolve(), chunk, request: () => req }
}

const ask: AiRequest = { messages: [{ role: 'user', content: 'Привет' }] }

describe('запрос со сроками и отменой', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('ответ вовремя — как есть; в отчёт — длительность, размеры, «размышления»', async () => {
    const m = slowMaster()
    const reports: AttemptReport[] = []
    const timed = timedMaster(m.master, { totalMs: 60_000, idleMs: 20_000, onAttempt: (r) => reports.push(r) })
    const p = timed.complete(ask)
    await vi.advanceTimersByTimeAsync(5_000)
    m.chunk()
    m.finish()
    expect((await p).text).toBe('Готово')
    expect(reports).toEqual([{ durationMs: 5_000, status: 'ok', requestChars: 6, responseChars: 6, reasoningChars: 5, firstChunkMs: 5_000 }])
  })

  it('20 с без единого куска — простой: запрос оборван, понятное сообщение', async () => {
    const m = slowMaster()
    const p = timedMaster(m.master, { totalMs: 60_000, idleMs: 20_000 }).complete(ask)
    const caught = p.catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(20_000)
    const error = (await caught) as AiError
    expect(error.kind).toBe('timeout')
    expect(error.message).toBe('Модель молчит: за 20 с не пришло ни одного куска ответа. Запрос остановлен.')
    expect(m.request().signal?.aborted).toBe(true)
  })

  it('первый кусок ждём дольше простоя (firstMs): большой запрос модель сначала читает', async () => {
    const m = slowMaster()
    const p = timedMaster(m.master, { totalMs: 150_000, firstMs: 60_000, idleMs: 20_000 }).complete(ask)
    await vi.advanceTimersByTimeAsync(45_000)
    m.chunk()
    m.finish()
    expect((await p).text).toBe('Готово')
  })

  it('без кусков дольше firstMs — простой с этим сроком; после первого куска — простой idleMs', async () => {
    const m = slowMaster()
    const first = timedMaster(m.master, { totalMs: 150_000, firstMs: 60_000, idleMs: 20_000 }).complete(ask).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(((await first) as AiError).message).toBe('Модель молчит: за 60 с не пришло ни одного куска ответа. Запрос остановлен.')
    const m2 = slowMaster()
    const second = timedMaster(m2.master, { totalMs: 150_000, firstMs: 60_000, idleMs: 20_000 }).complete(ask).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(5_000)
    m2.chunk()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(((await second) as AiError).message).toBe('Модель молчит: за 20 с не пришло ни одного куска ответа. Запрос остановлен.')
  })

  it('сервер на связи (keep-alive) — ожидание начинается заново, но не дольше общего срока', async () => {
    const m = slowMaster()
    const p = timedMaster(m.master, { totalMs: 90_000, firstMs: 20_000, idleMs: 20_000 }).complete(ask)
    const caught = p.catch((e: unknown) => e)
    for (let t = 0; t < 4; t++) {
      await vi.advanceTimersByTimeAsync(15_000)
      m.request().onAlive?.()
    }
    m.chunk()
    await vi.advanceTimersByTimeAsync(15_000)
    m.request().onAlive?.()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(((await caught) as AiError).message).toBe('Модель не ответила за 90 с. Запрос остановлен.')
  })

  it('куски идут, но ответа нет 60 с — общий срок', async () => {
    const m = slowMaster()
    const p = timedMaster(m.master, { totalMs: 60_000, idleMs: 20_000 }).complete(ask)
    const caught = p.catch((e: unknown) => e)
    for (let t = 0; t < 6; t++) {
      await vi.advanceTimersByTimeAsync(10_000)
      m.chunk()
    }
    expect(((await caught) as AiError).message).toBe('Модель не ответила за 60 с. Запрос остановлен.')
  })

  it('«Отменить» обрывает запрос сразу', async () => {
    const m = slowMaster()
    const controller = new AbortController()
    const reports: AttemptReport[] = []
    const p = timedMaster(m.master, { totalMs: 60_000, idleMs: 20_000, signal: controller.signal, onAttempt: (r) => reports.push(r) }).complete(ask)
    const caught = p.catch((e: unknown) => e)
    controller.abort()
    expect(((await caught) as AiError).kind).toBe('aborted')
    expect(m.request().signal?.aborted).toBe(true)
    expect(reports[0].status).toBe('cancelled')
  })
})

describe('рассуждающие модели', () => {
  it('узнаются по названию', () => {
    for (const m of ['deepseek-reasoner', 'deepseek/deepseek-r1', 'o3-mini', 'claude-thinking', 'qwq-32b']) expect(isReasoningModel(m), m).toBe(true)
    for (const m of ['deepseek-chat', 'gpt-4o-mini', 'deepseek/deepseek-chat-v3', 'llama-3.1-70b']) expect(isReasoningModel(m), m).toBe(false)
  })
})
