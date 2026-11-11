// Варианты потокового формата OpenAI-совместимых сервисов (DeepSeek, Polza, OpenRouter и др.).
import { describe, expect, it } from 'vitest'
import { AiError } from '../errors'
import { createMaster } from '../index'
import { readLines, readSse } from '../sse'
import { fakeTransport, jsonResponse, sse } from '../testing'
import type { AiConnection, AiRequest } from '../types'

const KEY = 'sk-polza-0123456789abcdef'
const connection: AiConnection = { format: 'openai-chat', baseUrl: 'https://polza.ai/api/v1', model: 'deepseek/deepseek-chat', apiKey: KEY }
const ask: AiRequest = { messages: [{ role: 'user', content: 'Привет' }] }
const delta = (d: unknown, finish: string | null = null) => ({
  id: 'gen-1',
  object: 'chat.completion.chunk',
  choices: [{ index: 0, delta: d, finish_reason: finish }],
})

function stream(pieces: string[], contentType = 'text/event-stream') {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of pieces) c.enqueue(encoder.encode(p))
      c.close()
    },
  })
  return new Response(body, { status: 200, headers: contentType ? { 'content-type': contentType } : {} })
}

async function run(response: Response, request: AiRequest = ask) {
  const parts: string[] = []
  const { transport, calls } = fakeTransport([response])
  const result = await createMaster(connection, transport).complete({ ...request, onText: (d) => parts.push(d) })
  return { result, parts, calls }
}

async function fails(response: Response) {
  const { transport } = fakeTransport([response])
  try {
    await createMaster(connection, transport).complete(ask)
  } catch (error) {
    expect(error).toBeInstanceOf(AiError)
    expect((error as Error).message).not.toContain(KEY)
    return error as AiError
  }
  throw new Error('ожидалась ошибка')
}

describe('строки SSE', () => {
  it('комментарии, keep-alive, пустые строки, \\r\\n и \\r, data без пробела, event', async () => {
    const pieces = [
      ': OPENROUTER PROCESSING\n\n',
      ':keep-alive\r\n\r\n\n\n',
      'data:{"a":1}\r',
      '\r',
      'event: error\ndata: {"b":2}\n',
      '\n',
      'data: tail',
    ]
    const events = []
    for await (const e of readSse(stream(pieces).body!)) events.push(e)
    expect(events).toEqual([
      { event: 'message', data: '{"a":1}' },
      { event: 'error', data: '{"b":2}' },
      { event: 'message', data: 'tail' },
    ])
  })

  it('строки, разрезанные между кусками, в том числе посередине \\r\\n', async () => {
    const lines = []
    for await (const l of readLines(stream(['data: при', 'вет\r', '\ndata: ещё\r', '\n']).body!)) lines.push(l)
    expect(lines).toEqual(['data: привет', 'data: ещё'])
  })
})

describe('поток: терпимость к вариантам формата', () => {
  it('куски без choices (только usage, только id), пустой delta, delta: null, content: null', async () => {
    const { result, parts } = await run(
      stream([
        sse({ id: 'gen-1', object: 'chat.completion.chunk', created: 1 }),
        sse(delta({})),
        sse(delta(null)),
        sse(delta({ role: 'assistant', content: null })),
        sse(delta({ content: 'Привет, ' })),
        sse({ id: 'gen-1', choices: [] }),
        sse(delta({ content: 'путник.' }, 'stop')),
        sse({ id: 'gen-1', choices: [], usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 } }),
        'data: [DONE]\n\n',
      ]),
    )
    expect(parts).toEqual(['Привет, ', 'путник.'])
    expect(result).toMatchObject({
      text: 'Привет, путник.',
      finishReason: 'stop',
      usage: { inputTokens: 9, outputTokens: 4, totalTokens: 13 },
      streamed: true,
    })
  })

  it('комментарии и keep-alive между данными не мешают', async () => {
    const { result } = await run(
      stream([
        ': OPENROUTER PROCESSING\n\n',
        ': keep-alive\n\n',
        sse(delta({ content: 'Да' })),
        ':\n\n',
        sse(delta({ content: '.' }, 'stop')),
        'data: [DONE]\n\n',
      ]),
    )
    expect(result.text).toBe('Да.')
    expect(result.stats.skipped).toBe(0)
  })

  it('сервер на связи: onAlive — при заголовках ответа и на каждой строке, в том числе служебной (до первого куска)', async () => {
    const seen: string[] = []
    const { result } = await run(
      stream([': OPENROUTER PROCESSING\n\n', ': OPENROUTER PROCESSING\n\n', sse(delta({ content: 'Да' }, 'stop')), 'data: [DONE]\n\n']),
      { ...ask, onAlive: () => seen.push('alive'), onProgress: () => seen.push('chunk') },
    )
    expect(result.text).toBe('Да')
    // Заголовки, две служебные строки и пустые строки после них — до первого куска ответа.
    expect(seen.indexOf('chunk')).toBeGreaterThan(2)
    expect(seen.slice(0, 3)).toEqual(['alive', 'alive', 'alive'])
  })

  it('[DONE] с пробелами; конец потока без [DONE] и без завершающей пустой строки', async () => {
    expect((await run(stream([sse(delta({ content: 'А' })), 'data:  [DONE] \n\n', sse(delta({ content: 'лишнее' }))]))).result.text).toBe('А')
    const noDone = await run(stream([sse(delta({ content: 'Б' })), `data: ${JSON.stringify(delta({ content: 'В' }, 'stop'))}`]))
    expect(noDone.result).toMatchObject({ text: 'БВ', finishReason: 'stop' })
  })

  it('«размышления» рассуждающих моделей (reasoning, reasoning_content) собираются отдельно и не показываются', async () => {
    const { result, parts } = await run(
      stream([
        sse(delta({ reasoning: 'Нужно посчитать… ' })),
        sse(delta({ reasoning_content: 'один, два.' })),
        sse(delta({ content: 'Один, два.' }, 'stop')),
        'data: [DONE]\n\n',
      ]),
    )
    expect(result.reasoning).toBe('Нужно посчитать… один, два.')
    expect(result.text).toBe('Один, два.')
    expect(parts).toEqual(['Один, два.'])
    const onlyThinking = await run(stream([sse(delta({ reasoning: 'Думаю…' })), sse(delta({}, 'length'))]))
    expect(onlyThinking.result).toMatchObject({ text: '', reasoning: 'Думаю…', finishReason: 'length' })
  })

  it('content массивом частей и целое message вместо delta', async () => {
    const { result } = await run(
      stream([
        sse(delta({ content: [{ type: 'text', text: 'Часть ' }] })),
        sse({ choices: [{ index: 0, message: { role: 'assistant', content: 'целиком.' }, finish_reason: 'stop' }] }),
      ]),
    )
    expect(result.text).toBe('Часть целиком.')
  })

  it('непонятные строки пропускаются (и считаются), если остальное разбирается', async () => {
    const { result } = await run(stream(['data: {обрыв\n\n', sse(delta({ content: 'Ок' }, 'stop')), 'data: [DONE]\n\n']))
    expect(result.text).toBe('Ок')
    expect(result.stats).toMatchObject({ skipped: 1, events: 1, format: 'stream' })
  })
})

describe('ответ не потоком — принимается целиком', () => {
  const completion = {
    choices: [{ index: 0, message: { role: 'assistant', content: 'Целиком.' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 3, completion_tokens: 2 },
  }

  it('просили поток, а пришёл обычный JSON — не ошибка', async () => {
    const { result, parts } = await run(jsonResponse(200, completion))
    expect(result).toMatchObject({ text: 'Целиком.', streamed: false, usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } })
    expect(result.stats).toMatchObject({ format: 'json', contentType: 'application/json' })
    expect(parts).toEqual([])
  })

  it('JSON без типа содержимого; поток с типом text/plain — по самому тексту', async () => {
    expect((await run(new Response(JSON.stringify(completion), { status: 200 }))).result.text).toBe('Целиком.')
    const plain = await run(
      stream([sse(delta({ content: 'По' })), sse(delta({ content: 'ток' }, 'stop')), 'data: [DONE]\n\n'], 'text/plain; charset=utf-8'),
    )
    expect(plain.result).toMatchObject({ text: 'Поток', finishReason: 'stop' })
    expect(plain.parts).toEqual(['По', 'ток'])
  })
})

describe('вызовы инструментов по частям', () => {
  it('index и куски arguments; имя приходит один раз или повторяется в каждом куске; id — только в первом', async () => {
    const { result } = await run(
      stream([
        sse(delta({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'add_numbers', arguments: '' } }] })),
        sse(delta({ tool_calls: [{ index: 1, id: 'call_2', type: 'function', function: { name: 'get_time_of_day', arguments: '{"place":' } }] })),
        sse(delta({ tool_calls: [{ index: 0, function: { name: 'add_numbers', arguments: '{"a":2,' } }] })),
        sse(delta({ tool_calls: [{ index: 0, function: { arguments: '"b":3}' } }] })),
        sse(delta({ tool_calls: [{ index: 1, function: { arguments: '"Таверна"}' } }] })),
        sse(delta({}, 'tool_calls')),
        sse({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 } }),
      ]),
    )
    expect(result.finishReason).toBe('tool_calls')
    expect(result.toolCalls).toEqual([
      { id: 'call_1', name: 'add_numbers', arguments: { a: 2, b: 3 }, rawArguments: '{"a":2,"b":3}' },
      { id: 'call_2', name: 'get_time_of_day', arguments: { place: 'Таверна' }, rawArguments: '{"place":"Таверна"}' },
    ])
  })

  it('без index — по порядку; без id — свой; аргументы объектом; пустые аргументы — {}', async () => {
    const { result } = await run(
      stream([
        sse(delta({ tool_calls: [{ function: { name: 'add_numbers', arguments: { a: 1, b: 1 } } }] })),
        sse(delta({ tool_calls: [{ function: { name: 'get_time_of_day', arguments: '' } }] })),
      ]),
    )
    expect(result.toolCalls).toEqual([
      { id: 'call_0', name: 'add_numbers', arguments: { a: 1, b: 1 }, rawArguments: '{"a":1,"b":1}' },
      { id: 'call_1', name: 'get_time_of_day', arguments: {}, rawArguments: '' },
    ])
  })
})

describe('ошибки формата — с указанием, на чём споткнулись', () => {
  it('ошибка внутри потока (в т. ч. event: error) — вид по коду и место', async () => {
    const error = await fails(
      stream([sse(delta({ content: 'На' })), 'event: error\ndata: {"error":{"code":402,"message":"Insufficient credits"}}\n\n']),
    )
    expect(error.kind).toBe('billing')
    expect(error.stage).toContain('ошибка внутри потока')
  })

  it('ни одной строки JSON — bad-response и первая строка', async () => {
    const error = await fails(stream(['data: <html>Bad Gateway</html>\n\n']))
    expect(error.kind).toBe('bad-response')
    expect(error.stage).toBe('разбор потока: ни одной строки JSON, первая строка — «<html>Bad Gateway</html>»')
  })

  it('поток закрылся без данных; пустой ответ; HTML вместо ответа', async () => {
    expect((await fails(stream([': keep-alive\n\n']))).stage).toBe('разбор потока: сервер закрыл поток, не прислав данных')
    expect((await fails(new Response('', { status: 200 }))).stage).toBe('сервер прислал пустой ответ')
    const html = await fails(new Response('<!doctype html><title>Login</title>', { status: 200, headers: { 'content-type': 'text/html' } }))
    expect(html.stage).toBe('непонятный ответ (тип «text/html»): «<!doctype html><title>Login</title>»')
  })

  it('сервер не знает stream_options — повтор без него, дальше запросы тоже без него', async () => {
    const reject = () => jsonResponse(400, { error: { message: 'Unrecognized request argument supplied: stream_options' } })
    const ok = () => stream([sse(delta({ content: 'Ок' }, 'stop'))])
    const { transport, calls } = fakeTransport([reject(), ok(), ok()])
    const master = createMaster(connection, transport)
    expect((await master.complete(ask)).text).toBe('Ок')
    expect((await master.complete(ask)).text).toBe('Ок')
    expect(calls.map((c) => 'stream_options' in c.body)).toEqual([true, false, false])
  })
})

describe('диагностика', () => {
  it('статус, заголовки без Authorization/Cookie, первые 20 строк, ключ скрыт', async () => {
    const lines = [': OPENROUTER PROCESSING', '', ...Array.from({ length: 30 }, (_, i) => `data: {"n":${i}}`)].join('\n')
    const response = new Response(lines, {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/event-stream', 'set-cookie': 'session=secret', 'x-trace-id': 'abc', 'x-echo': `Bearer ${KEY}` },
    })
    const { transport, calls } = fakeTransport([response])
    const d = await createMaster(connection, transport).diagnose()
    expect(d.status).toBe(200)
    expect(d.url).toBe('https://polza.ai/api/v1/chat/completions')
    expect(d.request).toContain('модель «deepseek/deepseek-chat»')
    expect(d.request).not.toContain(KEY)
    expect(d.headers).toEqual([
      ['content-type', 'text/event-stream'],
      ['x-echo', 'Bearer [ключ скрыт]'],
      ['x-trace-id', 'abc'],
    ])
    expect(d.lines).toHaveLength(20)
    expect(d.lines.slice(0, 3)).toEqual([': OPENROUTER PROCESSING', '', 'data: {"n":0}'])
    expect(calls[0].body).toMatchObject({ stream: true, model: 'deepseek/deepseek-chat' })
  })

  it('ответ с ошибкой тоже показывается как есть; ключ из текста скрыт', async () => {
    const { transport } = fakeTransport([jsonResponse(401, { error: { message: `Bad key ****${KEY.slice(-4)}` } })])
    const d = await createMaster(connection, transport).diagnose()
    expect(d.status).toBe(401)
    expect(d.lines.join('\n')).not.toContain(KEY.slice(-4))
    expect(d.lines[0]).toContain('[ключ скрыт]')
  })

  it('нет сети — объяснение вместо статуса', async () => {
    const { transport } = fakeTransport([new TypeError('Failed to fetch')])
    const d = await createMaster(connection, transport).diagnose()
    expect(d.status).toBeNull()
    expect(d.error).toContain('Запрос не дошёл до сервера')
  })
})
