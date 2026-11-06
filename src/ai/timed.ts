// Запрос к модели со сроками и отменой: общий срок, срок простоя (нет кусков потока), отмена извне.
// Отмена и тайм-аут обрывают сам запрос (fetch) и сразу возвращают ошибку, даже если адаптер ждёт паузу перед повтором.
// Обёртка над любым AiMaster — игра и адаптеры о ней не знают.
import { AiError } from './errors'
import type { AiTimeouts } from './timeouts'
import type { AiMaster, AiProgress, AiRequest } from './types'

/** Итог одной попытки — для журнала разработчика: сколько шла, сколько ушло и пришло, были ли «размышления». */
export interface AttemptReport {
  durationMs: number
  status: 'ok' | 'timeout' | 'cancelled' | 'error'
  /** Символов в запросе (сообщения и описания инструментов). */
  requestChars: number
  responseChars: number
  reasoningChars: number
  /** Сколько прошло до первого куска ответа (null — не пришло ни одного). */
  firstChunkMs: number | null
  error?: string
}

export interface TimedOptions extends AiTimeouts {
  /** Отмена извне (кнопка «Отменить», уход с экрана). */
  signal?: AbortSignal
  onProgress?: (progress: AiProgress) => void
  onAttempt?: (report: AttemptReport) => void
  now?: () => number
}

const seconds = (ms: number) => Math.round(ms / 1000)

export function timeoutMessage(kind: 'total' | 'idle', ms: number): string {
  return kind === 'idle'
    ? `Модель молчит: за ${seconds(ms)} с не пришло ни одного куска ответа. Запрос остановлен.`
    : `Модель не ответила за ${seconds(ms)} с. Запрос остановлен.`
}

const requestChars = (req: AiRequest) =>
  req.messages.reduce((n, m) => n + (m.content?.length ?? 0) + (m.role === 'assistant' ? (m.toolCalls ?? []).reduce((k, c) => k + c.rawArguments.length, 0) : 0), 0) +
  (req.tools ? JSON.stringify(req.tools).length : 0)

export function timedMaster(master: AiMaster, options: TimedOptions): AiMaster {
  const now = options.now ?? (() => Date.now())
  return {
    format: master.format,
    diagnose: (opts) => master.diagnose({ ...opts, signal: opts?.signal ?? options.signal }),
    async complete(request) {
      const controller = new AbortController()
      const started = now()
      let firstChunk: number | null = null
      let last: AiProgress | null = null
      let reason: AiError | null = null
      let rejectStop: (e: AiError) => void = () => {}
      const stopped = new Promise<never>((_, reject) => (rejectStop = reject))
      stopped.catch(() => {})
      const stop = (error: AiError) => {
        if (reason) return
        reason = error
        controller.abort()
        rejectStop(error)
      }
      const outer = [options.signal, request.signal].filter((s): s is AbortSignal => !!s)
      const onOuterAbort = () => stop(new AiError('aborted'))
      for (const s of outer) {
        if (s.aborted) onOuterAbort()
        else s.addEventListener('abort', onOuterAbort, { once: true })
      }
      const total = setTimeout(() => stop(new AiError('timeout', { message: timeoutMessage('total', options.totalMs) })), options.totalMs)
      let idle = setTimeout(() => stop(new AiError('timeout', { message: timeoutMessage('idle', options.idleMs) })), options.idleMs)
      const onProgress = (p: AiProgress) => {
        firstChunk ??= now() - started
        last = p
        clearTimeout(idle)
        idle = setTimeout(() => stop(new AiError('timeout', { message: timeoutMessage('idle', options.idleMs) })), options.idleMs)
        request.onProgress?.(p)
        options.onProgress?.(p)
      }
      const report = (status: AttemptReport['status'], response?: { text: string; reasoning: string; toolCalls: { rawArguments: string }[] }, error?: unknown) =>
        options.onAttempt?.({
          durationMs: now() - started,
          status,
          requestChars: requestChars(request),
          responseChars: response ? response.text.length + response.toolCalls.reduce((n, c) => n + c.rawArguments.length, 0) : ((last as AiProgress | null)?.textChars ?? 0) + ((last as AiProgress | null)?.toolChars ?? 0),
          reasoningChars: response ? response.reasoning.length : ((last as AiProgress | null)?.reasoningChars ?? 0),
          firstChunkMs: firstChunk,
          ...(error instanceof Error ? { error: error.message } : {}),
        })
      try {
        const response = await Promise.race([master.complete({ ...request, signal: controller.signal, onProgress }), stopped])
        report('ok', response)
        return response
      } catch (error) {
        const final = reason ?? error
        const r = reason as AiError | null
        report(r?.kind === 'timeout' ? 'timeout' : r?.kind === 'aborted' ? 'cancelled' : 'error', undefined, final)
        throw final
      } finally {
        clearTimeout(total)
        clearTimeout(idle)
        for (const s of outer) s.removeEventListener('abort', onOuterAbort)
      }
    },
  }
}
