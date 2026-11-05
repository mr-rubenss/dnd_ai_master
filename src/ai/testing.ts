// Помощники для тестов: подменённые ответы API (обычный JSON и поток SSE, разрезанный на произвольные куски).
import type { AiMaster, AiRequest, AiResponse, AiTransport } from './types.ts'

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

/** Поток SSE: `pieces` отдаются как есть — так проверяется склейка строк, разрезанных между кусками. */
export function sseResponse(pieces: string[]) {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of pieces) controller.enqueue(encoder.encode(p))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } })
}

/** Событие SSE с JSON-данными. */
export const sse = (data: unknown) => `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`

export interface FakeCall {
  url: string
  init: RequestInit
  body: Record<string, unknown>
}

/** Транспорт с очередью ответов; запоминает запросы и паузы. */
export function fakeTransport(responses: (Response | Error | (() => Response))[], maxRetries = 3) {
  const calls: FakeCall[] = []
  const sleeps: number[] = []
  const transport: AiTransport = {
    maxRetries,
    sleep: async (ms) => void sleeps.push(ms),
    fetch: async (input, init) => {
      calls.push({ url: String(input), init: init ?? {}, body: JSON.parse(String(init?.body ?? '{}')) })
      const next = responses.shift()
      if (!next) throw new Error('нет подготовленного ответа')
      if (next instanceof Error) throw next
      return typeof next === 'function' ? next() : next
    },
  }
  return { transport, calls, sleeps }
}

/** Ответ ведущего с разумными значениями по умолчанию. */
export const aiResponse = (r: Partial<AiResponse> = {}): AiResponse => ({
  text: '',
  toolCalls: [],
  usage: null,
  finishReason: 'stop',
  streamed: false,
  reasoning: '',
  stats: { events: 1, skipped: 0, contentType: 'text/event-stream', format: 'stream' },
  ...r,
})

/** Ведущий-заглушка: на каждый запрос — следующий шаг из очереди (шаг может звать onText). */
export function fakeMaster(steps: ((req: AiRequest) => AiResponse | Promise<AiResponse>)[]) {
  const requests: AiRequest[] = []
  const master: AiMaster = {
    format: 'openai-chat',
    async complete(req) {
      requests.push(req)
      const step = steps.shift()
      if (!step) throw new Error('лишний запрос')
      return step(req)
    },
    diagnose: async () => ({ url: '', request: '', status: null, statusText: '', headers: [], lines: [] }),
  }
  return { master, requests }
}
