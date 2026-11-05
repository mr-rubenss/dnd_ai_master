// Разбор потока Server-Sent Events (`data: …` строки, пустая строка — конец события, `:` — комментарий-пинг).

/** Читает поток и отдаёт данные событий по одному (без префикса `data:`). */
export async function* readSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let data: string[] = []
  const flush = function* () {
    if (data.length > 0) yield data.join('\n')
    data = []
  }
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Запрос отменён', 'AbortError')
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r\n|\r|\n/)
      buffer = done ? '' : (lines.pop() ?? '')
      for (const line of lines) {
        if (line === '') yield* flush()
        else if (line.startsWith(':')) continue
        else if (line.startsWith('data:')) data.push(line.slice(line[5] === ' ' ? 6 : 5))
      }
      if (done) {
        yield* flush()
        return
      }
    }
  } finally {
    reader.releaseLock()
  }
}
