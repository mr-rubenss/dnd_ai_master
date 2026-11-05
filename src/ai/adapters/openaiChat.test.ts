import { describe, expect, it } from 'vitest'
import { createMaster } from '../index'
import { AiError, redactSecrets } from '../errors'
import { fakeTransport, jsonResponse, sse, sseResponse } from '../testing'
import type { AiConnection, AiRequest } from '../types'
import { buildRequestBody, chatCompletionsUrl } from './openaiChat'

const KEY = 'sk-test-0123456789abcdef'
const connection: AiConnection = { format: 'openai-chat', baseUrl: 'https://api.deepseek.com/', model: 'deepseek-chat', apiKey: KEY }
const ask: AiRequest = { messages: [{ role: 'user', content: 'Привет' }] }

const completion = (message: Record<string, unknown>, finish = 'stop', usage = { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 }) => ({
  id: 'x',
  choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: finish }],
  usage,
})
const delta = (d: Record<string, unknown>, finish: string | null = null) => ({ choices: [{ index: 0, delta: d, finish_reason: finish }] })

/** Ошибка вызова (ожидаемо брошенная) — для проверок вида и текста. */
async function failure(promise: Promise<unknown>): Promise<AiError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(AiError)
    expect((error as Error).message).not.toContain(KEY)
    expect((error as Error).message).not.toContain(KEY.slice(-4))
    return error as AiError
  }
  throw new Error('ожидалась ошибка')
}

describe('запрос в формате Chat Completions', () => {
  it('адрес, ключ в заголовке, модель, сообщения, инструменты, tool_choice, стриминг', async () => {
    const { transport, calls } = fakeTransport([sseResponse([sse(delta({ content: 'ок' }, 'stop')), sse('[DONE]')])])
    await createMaster(connection, transport).complete({
      messages: [
        { role: 'system', content: 'Ты ведущий' },
        { role: 'user', content: 'Бросаю кости' },
        { role: 'assistant', content: null, toolCalls: [{ id: 'c1', name: 'roll', arguments: { dice: '1d20' }, rawArguments: '{"dice":"1d20"}' }] },
        { role: 'tool', toolCallId: 'c1', content: '{"total":15}' },
      ],
      tools: [{ name: 'roll', description: 'Бросок', parameters: { type: 'object', properties: { dice: { type: 'string' } } } }],
      toolChoice: 'required',
      maxTokens: 300,
      temperature: 0.5,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.deepseek.com/chat/completions')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`)
    expect(calls[0].body).toEqual({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'Ты ведущий' },
        { role: 'user', content: 'Бросаю кости' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'roll', arguments: '{"dice":"1d20"}' } }] },
        { role: 'tool', tool_call_id: 'c1', content: '{"total":15}' },
      ],
      tools: [
        {
          type: 'function',
          function: { name: 'roll', description: 'Бросок', parameters: { type: 'object', properties: { dice: { type: 'string' } } } },
        },
      ],
      tool_choice: 'required',
      max_tokens: 300,
      temperature: 0.5,
      stream: true,
      stream_options: { include_usage: true },
    })
  })

  it('выбор конкретного инструмента; без стриминга; без инструментов нет tool_choice', () => {
    const tools = [{ name: 'roll', description: '', parameters: {} }]
    expect(buildRequestBody('m', { ...ask, tools, toolChoice: { name: 'roll' } }).tool_choice).toEqual({
      type: 'function',
      function: { name: 'roll' },
    })
    const plain = buildRequestBody('m', { ...ask, toolChoice: 'auto', stream: false })
    expect(plain).toEqual({ model: 'm', messages: [{ role: 'user', content: 'Привет' }], stream: false })
    expect(chatCompletionsUrl(' https://api.example.com/v1/// ')).toBe('https://api.example.com/v1/chat/completions')
  })
})

describe('ответ', () => {
  it('текст без стриминга: текст, расход токенов, причина окончания', async () => {
    const { transport } = fakeTransport([jsonResponse(200, completion({ content: 'Таверна шумит.' }))])
    const response = await createMaster(connection, transport).complete({ ...ask, stream: false })
    expect(response).toEqual({
      text: 'Таверна шумит.',
      toolCalls: [],
      usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
      finishReason: 'stop',
      streamed: false,
    })
  })

  it('стриминг: части текста по мере прихода, пинги и разрезанные строки, расход в последнем куске', async () => {
    const stream = [
      ': keep-alive\n\n',
      sse(delta({ role: 'assistant', content: '' })),
      'data: {"choices":[{"index":0,"delta":{"content":"Дверь "},"finish_reason":null}]}\r\n\r\nda',
      'ta: {"choices":[{"index":0,"delta":{"content":"скрипит"}',
      ',"finish_reason":null}]}\n\n',
      sse(delta({ content: '.' }, 'stop')),
      sse({ choices: [], usage: { prompt_tokens: 40, completion_tokens: 3, total_tokens: 43 } }),
      'data: [DONE]\n\n',
    ]
    const parts: string[] = []
    const { transport } = fakeTransport([sseResponse(stream)])
    const response = await createMaster(connection, transport).complete({ ...ask, onText: (d) => parts.push(d) })
    expect(parts).toEqual(['Дверь ', 'скрипит', '.'])
    expect(response).toEqual({
      text: 'Дверь скрипит.',
      toolCalls: [],
      usage: { inputTokens: 40, outputTokens: 3, totalTokens: 43 },
      finishReason: 'stop',
      streamed: true,
    })
  })

  it('стриминг: несколько вызовов инструментов в одном ответе, аргументы собираются из кусочков', async () => {
    const stream = [
      sse(delta({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'add_numbers', arguments: '' } }] })),
      sse(delta({ tool_calls: [{ index: 0, function: { arguments: '{"a": 2,' } }] })),
      sse(delta({ tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'get_time_of_day', arguments: '{"pla' } }] })),
      sse(delta({ tool_calls: [{ index: 0, function: { arguments: ' "b": 3}' } }] })),
      sse(delta({ tool_calls: [{ index: 1, function: { arguments: 'ce": "Таверна"}' } }] })),
      sse(delta({}, 'tool_calls')),
      'data: [DONE]\n\n',
    ]
    const { transport } = fakeTransport([sseResponse(stream)])
    const response = await createMaster(connection, transport).complete(ask)
    expect(response.finishReason).toBe('tool_calls')
    expect(response.text).toBe('')
    expect(response.toolCalls).toEqual([
      { id: 'call_a', name: 'add_numbers', arguments: { a: 2, b: 3 }, rawArguments: '{"a": 2, "b": 3}' },
      { id: 'call_b', name: 'get_time_of_day', arguments: { place: 'Таверна' }, rawArguments: '{"place": "Таверна"}' },
    ])
  })

  it('несколько вызовов без стриминга; некорректные аргументы помечаются, а не роняют ответ', async () => {
    const message = {
      content: null,
      tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'add_numbers', arguments: '{"a":1,"b":2}' } },
        { id: 'c2', type: 'function', function: { name: 'get_time_of_day', arguments: '{place: Таверна' } },
      ],
    }
    const { transport } = fakeTransport([jsonResponse(200, completion(message, 'tool_calls'))])
    const response = await createMaster(connection, transport).complete({ ...ask, stream: false })
    expect(response.toolCalls[0]).toEqual({ id: 'c1', name: 'add_numbers', arguments: { a: 1, b: 2 }, rawArguments: '{"a":1,"b":2}' })
    expect(response.toolCalls[1]).toMatchObject({ id: 'c2', arguments: null, argumentsError: 'Аргументы инструмента — некорректный JSON.' })
  })

  it('сервер ответил обычным JSON на запрос со стримингом — тоже понимаем', async () => {
    const { transport } = fakeTransport([jsonResponse(200, completion({ content: 'Целиком.' }))])
    expect((await createMaster(connection, transport).complete(ask)).text).toBe('Целиком.')
  })
})

describe('ошибки', () => {
  const providerError = (message: string, type = 'invalid_request_error', code: string | null = null) => ({ error: { message, type, code } })

  it('неверный ключ — понятное сообщение без ключа и без слов поставщика', async () => {
    const body = providerError(`Authentication Fails, Your api key: ****${KEY.slice(-4)} is invalid`, 'authentication_error')
    const { transport, calls } = fakeTransport([jsonResponse(401, body)])
    const error = await failure(createMaster(connection, transport).complete(ask))
    expect(error.kind).toBe('auth')
    expect(error.message).toBe('Ключ API не принят. Проверьте ключ в «Настройки» → «Ведущий».')
    expect(calls).toHaveLength(1)
  })

  it('нет денег на счёте: 402 (DeepSeek) и insufficient_quota (OpenAI)', async () => {
    const a = fakeTransport([jsonResponse(402, providerError('Insufficient Balance'))])
    expect((await failure(createMaster(connection, a.transport).complete(ask))).kind).toBe('billing')
    const b = fakeTransport([jsonResponse(429, providerError('You exceeded your current quota', 'insufficient_quota', 'insufficient_quota'))])
    const error = await failure(createMaster(connection, b.transport).complete(ask))
    expect(error.kind).toBe('billing')
    expect(error.message).toContain('закончились деньги')
    expect(b.calls).toHaveLength(1)
  })

  it('превышен лимит: автоматический повтор через паузу (Retry-After или 2, 4, 8 с)', async () => {
    const retries: number[] = []
    const { transport, calls, sleeps } = fakeTransport([
      jsonResponse(429, providerError('Rate limit reached'), { 'retry-after': '3' }),
      jsonResponse(429, providerError('Rate limit reached')),
      jsonResponse(200, completion({ content: 'Наконец-то.' })),
    ])
    const response = await createMaster(connection, transport).complete({ ...ask, onRetry: (r) => retries.push(r.delayMs) })
    expect(response.text).toBe('Наконец-то.')
    expect(calls).toHaveLength(3)
    expect(sleeps).toEqual([3000, 4000])
    expect(retries).toEqual([3000, 4000])
  })

  it('лимит не отпускает — после повторов понятная ошибка', async () => {
    const { transport, calls } = fakeTransport(
      [429, 429, 429].map((s) => jsonResponse(s, providerError('Rate limit'))),
      2,
    )
    const error = await failure(createMaster(connection, transport).complete(ask))
    expect(error.kind).toBe('rate-limit')
    expect(error.message).toBe('Превышен лимит запросов к модели. Подождите немного и попробуйте снова.')
    expect(calls).toHaveLength(3)
  })

  it('сервер перегружен (5xx) — тоже повтор', async () => {
    const { transport, sleeps } = fakeTransport([jsonResponse(503, {}), jsonResponse(200, completion({ content: 'Ок' }))])
    expect((await createMaster(connection, transport).complete(ask)).text).toBe('Ок')
    expect(sleeps).toEqual([2000])
  })

  it('модель не найдена (400 Model Not Exist или 404 про модель); 404 без модели — неверный адрес', async () => {
    const a = fakeTransport([jsonResponse(400, providerError('Model Not Exist'))])
    expect((await failure(createMaster(connection, a.transport).complete(ask))).kind).toBe('model-not-found')
    const b = fakeTransport([jsonResponse(404, providerError('The model `gpt-9` does not exist', 'invalid_request_error', 'model_not_found'))])
    const error = await failure(createMaster(connection, b.transport).complete(ask))
    expect(error.kind).toBe('model-not-found')
    expect(error.message).toBe('Модель не найдена. Проверьте название модели в «Настройки» → «Ведущий».')
    const c = fakeTransport([new Response('Not Found', { status: 404 })])
    expect((await failure(createMaster(connection, c.transport).complete(ask))).kind).toBe('not-found')
  })

  it('нет сети (fetch не дошёл до сервера, в том числе CORS)', async () => {
    const { transport } = fakeTransport([new TypeError('Failed to fetch')])
    const error = await failure(createMaster(connection, transport).complete(ask))
    expect(error.kind).toBe('network')
    expect(error.message).toContain('нет сети')
  })

  it('прочие отказы — с подробностью поставщика, но без ключа', async () => {
    const { transport } = fakeTransport([jsonResponse(400, providerError(`Bad header Bearer ${KEY}; context too long`))])
    const error = await failure(createMaster(connection, transport).complete(ask))
    expect(error.kind).toBe('bad-request')
    expect(error.message).toBe('Модель не приняла запрос. Bad header Bearer [ключ скрыт]; context too long')
  })

  it('ошибка посреди потока — без повтора (текст уже показан)', async () => {
    const parts: string[] = []
    const { transport, calls } = fakeTransport([sseResponse([sse(delta({ content: 'Начало' })), sse({ error: { message: 'overloaded' } })])])
    const error = await failure(createMaster(connection, transport).complete({ ...ask, onText: (d) => parts.push(d) }))
    expect(error.kind).toBe('server')
    expect(parts).toEqual(['Начало'])
    expect(calls).toHaveLength(1)
  })

  it('непонятный поток и непонятный JSON — bad-response', async () => {
    const a = fakeTransport([sseResponse(['data: {не json\n\n'])])
    expect((await failure(createMaster(connection, a.transport).complete(ask))).kind).toBe('bad-response')
    const b = fakeTransport([jsonResponse(200, { choices: [] })])
    expect((await failure(createMaster(connection, b.transport).complete({ ...ask, stream: false }))).kind).toBe('bad-response')
  })

  it('отмена запроса', async () => {
    const abort = new DOMException('отменено', 'AbortError')
    const { transport } = fakeTransport([abort])
    expect((await failure(createMaster(connection, transport).complete(ask))).kind).toBe('aborted')
  })

  it('без адреса, модели или ключа — «Ведущий не настроен»', () => {
    expect(() => createMaster({ ...connection, apiKey: ' ' })).toThrow('Ведущий не настроен')
    expect(() => createMaster({ ...connection, model: '' })).toThrow(AiError)
  })
})

describe('ключ не попадает в тексты', () => {
  it('redactSecrets убирает ключ, его концы, Bearer и sk-строки', () => {
    expect(redactSecrets(`key ${KEY} end`, KEY)).toBe('key [ключ скрыт] end')
    expect(redactSecrets(`Your api key: ****${KEY.slice(-4)} is invalid`, KEY)).toBe('Your api key: [ключ скрыт] is invalid')
    expect(redactSecrets('Authorization: Bearer abc.def')).toBe('Authorization: Bearer [ключ скрыт]')
    expect(redactSecrets('ключ sk-proj-AAAA1111BBBB тут')).toBe('ключ [ключ скрыт] тут')
  })
})
