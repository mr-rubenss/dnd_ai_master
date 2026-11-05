// Адаптер формата OpenAI Chat Completions (POST {baseUrl}/chat/completions): tools, tool_choice, stream: true.
// Подходит для DeepSeek, Polza, OpenRouter и других совместимых API. Поток разбирается терпимо:
// комментарии и keep-alive, куски без choices (только usage), пустой delta, конец без [DONE], ответ обычным JSON
// вместо потока, «размышления» рассуждающих моделей, вызовы инструментов по частям.
import { AiError, errorFromResponse, redactSecrets, retryDelay } from '../errors.ts'
import { readLines, readSse, sseParser, type SseEvent } from '../sse.ts'
import type {
  AiConnection,
  AiDiagnostics,
  AiMaster,
  AiMessage,
  AiRequest,
  AiResponse,
  AiTool,
  AiToolCall,
  AiToolChoice,
  AiTransport,
  AiUsage,
} from '../types.ts'

/** Адрес метода: base URL без завершающего «/» + /chat/completions. */
export const chatCompletionsUrl = (baseUrl: string) => `${baseUrl.trim().replace(/\/+$/, '')}/chat/completions`

function toApiMessage(m: AiMessage): Record<string, unknown> {
  switch (m.role) {
    case 'assistant':
      return {
        role: 'assistant',
        content: m.content,
        ...(m.toolCalls?.length
          ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.rawArguments } })) }
          : {}),
      }
    case 'tool':
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
    default:
      return { role: m.role, content: m.content }
  }
}

const toApiTool = (t: AiTool) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })

const toApiToolChoice = (c: AiToolChoice) => (typeof c === 'string' ? c : { type: 'function', function: { name: c.name } })

/** Тело запроса в формате Chat Completions. `streamOptions: false` — без stream_options (не все сервисы его знают). */
export function buildRequestBody(model: string, request: AiRequest, streamOptions = true): Record<string, unknown> {
  const stream = request.stream !== false
  return {
    model,
    messages: request.messages.map(toApiMessage),
    ...(request.tools?.length ? { tools: request.tools.map(toApiTool) } : {}),
    ...(request.toolChoice && request.tools?.length ? { tool_choice: toApiToolChoice(request.toolChoice) } : {}),
    ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    stream,
    ...(stream && streamOptions ? { stream_options: { include_usage: true } } : {}),
  }
}

function parseArguments(id: string, name: string, raw: string): AiToolCall {
  const text = raw.trim() === '' ? '{}' : raw
  try {
    return { id, name, arguments: JSON.parse(text), rawArguments: raw }
  } catch {
    return { id, name, arguments: null, rawArguments: raw, argumentsError: 'Аргументы инструмента — некорректный JSON.' }
  }
}

const toUsage = (u: unknown): AiUsage | null => {
  const usage = u as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null | undefined
  if (!usage || typeof usage.prompt_tokens !== 'number') return null
  const out = usage.completion_tokens ?? 0
  return { inputTokens: usage.prompt_tokens, outputTokens: out, totalTokens: usage.total_tokens ?? usage.prompt_tokens + out }
}

const toFinish = (reason: unknown): AiResponse['finishReason'] =>
  reason === 'stop' || reason === 'length' || reason === 'tool_calls' ? reason : reason === 'function_call' ? 'tool_calls' : 'other'

/** Текст из content: строка или массив частей `[{ type: 'text', text }]`. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((p) => (typeof p === 'string' ? p : typeof p?.text === 'string' ? p.text : '')).join('')
  return ''
}

/** «Размышления»: DeepSeek — reasoning_content, OpenRouter/Polza — reasoning (строка). */
const reasoningText = (part: { reasoning?: unknown; reasoning_content?: unknown } | undefined) =>
  typeof part?.reasoning_content === 'string' ? part.reasoning_content : typeof part?.reasoning === 'string' ? part.reasoning : ''

/** Аргументы — строка JSON; некоторые сервисы присылают сразу объект. */
const argsText = (args: unknown) => (typeof args === 'string' ? args : args == null ? '' : JSON.stringify(args))

const snippet = (text: string, apiKey: string) => {
  const s = redactSecrets(text, apiKey).replace(/\s+/g, ' ').trim()
  return s.length > 80 ? `${s.slice(0, 80)}…` : s
}

type RawToolCall = { index?: number; id?: string; function?: { name?: string; arguments?: unknown } }
type RawChoice = {
  delta?: { content?: unknown; reasoning?: unknown; reasoning_content?: unknown; tool_calls?: RawToolCall[] } | null
  message?: { content?: unknown; reasoning?: unknown; reasoning_content?: unknown; tool_calls?: RawToolCall[] } | null
  finish_reason?: unknown
}

/** Ответ без стриминга (обычный JSON). */
function parseCompletion(json: unknown, contentType: string, apiKey: string): AiResponse {
  const root = json as { choices?: RawChoice[]; usage?: unknown; error?: unknown } | null
  if (root?.error) throw errorFromResponse(500, root, new Headers(), apiKey)
  const choice = root?.choices?.[0]
  if (!choice?.message)
    throw new AiError('bad-response', { stage: `ответ обычным JSON без choices[0].message: «${snippet(JSON.stringify(json), apiKey)}»` })
  const calls = Array.isArray(choice.message.tool_calls) ? choice.message.tool_calls : []
  return {
    text: contentText(choice.message.content),
    toolCalls: calls.map((c, i) => parseArguments(c.id ?? `call_${i}`, c.function?.name ?? '', argsText(c.function?.arguments))),
    usage: toUsage(root?.usage),
    finishReason: toFinish(choice.finish_reason),
    streamed: false,
    reasoning: reasoningText(choice.message),
    stats: { events: 1, skipped: 0, contentType, format: 'json' },
  }
}

/** Собирает ответ из событий потока: текст по частям, размышления, вызовы инструментов по `index`. */
async function parseEvents(events: AsyncIterable<SseEvent>, request: AiRequest, apiKey: string, contentType: string): Promise<AiResponse> {
  let text = ''
  let reasoning = ''
  let usage: AiUsage | null = null
  let finishReason: AiResponse['finishReason'] = 'other'
  let parsed = 0
  let skipped = 0
  let firstBad = ''
  const calls = new Map<number, { id: string; name: string; args: string }>()
  for await (const { event, data } of events) {
    const trimmed = data.trim()
    if (trimmed === '[DONE]') break
    if (trimmed === '') continue
    let chunk: { error?: unknown; usage?: unknown; choices?: RawChoice[] }
    try {
      chunk = JSON.parse(trimmed)
    } catch {
      // Непонятная строка — пропускаем, но запоминаем для объяснения.
      skipped++
      firstBad ||= trimmed
      continue
    }
    if (chunk?.error || event === 'error') {
      const code = Number((chunk?.error as { code?: unknown } | undefined)?.code)
      throw Object.assign(errorFromResponse(Number.isInteger(code) && code >= 400 ? code : 500, chunk, new Headers(), apiKey), {
        stage: `ошибка внутри потока: «${snippet(trimmed, apiKey)}»`,
      })
    }
    parsed++
    usage = toUsage(chunk?.usage) ?? usage
    for (const choice of chunk?.choices ?? []) {
      // Некоторые сервисы присылают в потоке не delta, а целое message.
      const part = choice?.delta ?? choice?.message ?? undefined
      const piece = contentText(part?.content)
      if (piece) {
        text += piece
        request.onText?.(piece)
      }
      reasoning += reasoningText(part)
      for (const call of part?.tool_calls ?? []) {
        const index = typeof call.index === 'number' ? call.index : calls.size
        const acc = calls.get(index) ?? { id: '', name: '', args: '' }
        if (call.id) acc.id = call.id
        if (call.function?.name) acc.name = acc.name.endsWith(call.function.name) ? acc.name : acc.name + call.function.name
        if (call.function?.arguments) acc.args += argsText(call.function.arguments)
        calls.set(index, acc)
      }
      if (choice?.finish_reason) finishReason = toFinish(choice.finish_reason)
    }
  }
  if (parsed === 0) {
    throw new AiError('bad-response', {
      stage: firstBad
        ? `разбор потока: ни одной строки JSON, первая строка — «${snippet(firstBad, apiKey)}»`
        : 'разбор потока: сервер закрыл поток, не прислав данных',
    })
  }
  const toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([i, c]) => parseArguments(c.id || `call_${i}`, c.name, c.args))
  return { text, toolCalls, usage, finishReason, streamed: parsed > 1, reasoning, stats: { events: parsed, skipped, contentType, format: 'stream' } }
}

/** События SSE из уже прочитанного текста (сервер прислал поток без типа text/event-stream). */
async function* sseFromText(text: string): AsyncGenerator<SseEvent> {
  const out: SseEvent[] = []
  const parser = sseParser((e) => out.push(e))
  for (const line of text.split(/\r\n|\n|\r/)) parser.line(line)
  parser.end()
  yield* out
}

/** Ответ сервера: поток SSE или обычный JSON — по типу содержимого, а если он не указан или неверен — по самому тексту. */
async function parseBody(response: Response, request: AiRequest, apiKey: string): Promise<AiResponse> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('text/event-stream') && response.body)
    return parseEvents(readSse(response.body, request.signal), request, apiKey, contentType)
  const text = await response.text()
  const trimmed = text.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let json: unknown
    try {
      json = JSON.parse(trimmed)
    } catch {
      throw new AiError('bad-response', { stage: `ответ похож на JSON, но не разбирается: «${snippet(trimmed, apiKey)}»` })
    }
    return parseCompletion(json, contentType, apiKey)
  }
  if (/^(data|event|:)/m.test(trimmed)) return parseEvents(sseFromText(text), request, apiKey, contentType || 'не указан')
  throw new AiError('bad-response', {
    stage: trimmed ? `непонятный ответ (тип «${contentType || 'не указан'}»): «${snippet(trimmed, apiKey)}»` : 'сервер прислал пустой ответ',
  })
}

/** Сервер не знает stream_options — повторим запрос без него. */
const rejectsStreamOptions = (error: unknown) =>
  error instanceof AiError && error.kind === 'bad-request' && /stream_options/i.test(error.detail ?? '')

export function createOpenAiChatMaster(connection: AiConnection, transport: AiTransport): AiMaster {
  const { baseUrl, model, apiKey } = connection
  const url = chatCompletionsUrl(baseUrl)
  let streamOptions = true

  const post = (body: Record<string, unknown>, signal?: AbortSignal) =>
    transport.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal,
    })

  async function attempt(request: AiRequest): Promise<AiResponse> {
    let response: Response
    try {
      response = await post(buildRequestBody(model, request, streamOptions), request.signal)
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') throw new AiError('aborted')
      throw new AiError('network', { stage: 'запрос не дошёл до сервера (нет сети, неверный адрес или CORS)' })
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      throw errorFromResponse(response.status, body, response.headers, apiKey)
    }
    try {
      return await parseBody(response, request, apiKey)
    } catch (error) {
      if (error instanceof AiError) throw error
      if ((error as Error)?.name === 'AbortError') throw new AiError('aborted')
      throw new AiError('network', { stage: 'соединение оборвалось во время чтения ответа' })
    }
  }

  return {
    format: 'openai-chat',
    async complete(request) {
      // Текст уже показан игроку — повтор задвоил бы его, поэтому повторяем только «чистые» попытки.
      let started = false
      const tracked: AiRequest = {
        ...request,
        onText: (delta) => {
          started = true
          request.onText?.(delta)
        },
      }
      for (let n = 1; ; n++) {
        try {
          return await attempt(tracked)
        } catch (error) {
          if (streamOptions && request.stream !== false && rejectsStreamOptions(error)) {
            streamOptions = false
            n--
            continue
          }
          if (!(error instanceof AiError) || !error.retryable || started || n > transport.maxRetries || request.signal?.aborted) throw error
          const delayMs = retryDelay(error, n)
          request.onRetry?.({ attempt: n, delayMs, reason: error.message })
          await transport.sleep(delayMs)
        }
      }
    },

    async diagnose({ maxLines = 20, signal } = {}) {
      const body = buildRequestBody(model, { messages: [{ role: 'user', content: 'Скажи одно слово: привет.' }], maxTokens: 400 }, streamOptions)
      const result: AiDiagnostics = {
        url,
        request: `POST ${url} · модель «${model}» · stream: true · max_tokens: 400 (ключ в заголовке Authorization не показан)`,
        status: null,
        statusText: '',
        headers: [],
        lines: [],
      }
      let response: Response
      try {
        response = await post(body, signal)
      } catch (error) {
        result.error =
          (error as Error)?.name === 'AbortError'
            ? 'Запрос отменён.'
            : 'Запрос не дошёл до сервера: нет сети, неверный адрес или сервер не разрешает запросы из браузера (CORS).'
        return result
      }
      result.status = response.status
      result.statusText = response.statusText
      response.headers.forEach((value, name) => {
        if (/^(authorization|cookie|set-cookie|proxy-authorization)$/i.test(name)) return
        result.headers.push([name, redactSecrets(value, apiKey)])
      })
      result.headers.sort(([a], [b]) => a.localeCompare(b))
      if (response.body) {
        try {
          for await (const line of readLines(response.body, signal)) {
            result.lines.push(redactSecrets(line, apiKey))
            if (result.lines.length >= maxLines) break
          }
        } catch {
          result.error = 'Соединение оборвалось во время чтения ответа.'
        }
      }
      return result
    },
  }
}
