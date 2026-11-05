// Разбор потока Server-Sent Events. Устойчив к вариантам OpenAI-совместимых сервисов:
// строки-комментарии («:», keep-alive и «: PROCESSING»), пустые строки, \r\n и \r, `data:` без пробела,
// поле `event:` (например, `event: error`), конец потока без пустой строки и без [DONE].

export interface SseEvent {
  /** Тип события из поля `event:` (по умолчанию — message). */
  event: string
  data: string
}

/** Разбирает строки SSE в события. Вызывается построчно; `end()` — конец потока. */
export function sseParser(onEvent: (event: SseEvent) => void) {
  let data: string[] = []
  let event = 'message'
  const dispatch = () => {
    if (data.length > 0) onEvent({ event, data: data.join('\n') })
    data = []
    event = 'message'
  }
  return {
    line(line: string) {
      if (line === '') return dispatch()
      if (line.startsWith(':')) return // комментарий / keep-alive
      const colon = line.indexOf(':')
      const field = colon === -1 ? line : line.slice(0, colon)
      let value = colon === -1 ? '' : line.slice(colon + 1)
      if (value.startsWith(' ')) value = value.slice(1)
      if (field === 'data') data.push(value)
      else if (field === 'event') event = value || 'message'
      // id, retry и неизвестные поля не нужны
    },
    end: dispatch,
  }
}

/** Режет поток байтов на строки (\n, \r\n, \r), в том числе строки, разрезанные между кусками. */
export async function* readLines(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Запрос отменён', 'AbortError')
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      // \r в самом конце куска может быть половиной \r\n — ждём следующий кусок.
      const parts = buffer.split(/\r\n|\n|\r(?!$)/)
      buffer = done ? '' : (parts.pop() ?? '')
      if (done && buffer === '' && parts.at(-1) === '') parts.pop()
      for (const line of parts) yield line.endsWith('\r') ? line.slice(0, -1) : line
      if (done) return
    }
  } finally {
    reader.releaseLock()
  }
}

/** Читает поток и отдаёт события по одному. */
export async function* readSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<SseEvent> {
  const queue: SseEvent[] = []
  const parser = sseParser((e) => queue.push(e))
  for await (const line of readLines(body, signal)) {
    parser.line(line)
    while (queue.length) yield queue.shift()!
  }
  parser.end()
  while (queue.length) yield queue.shift()!
}
