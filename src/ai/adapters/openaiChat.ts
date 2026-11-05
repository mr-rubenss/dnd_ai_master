// Адаптер формата OpenAI Chat Completions (POST {baseUrl}/chat/completions): tools, tool_choice, stream: true.
// Подходит для DeepSeek и других совместимых API.
import { AiError, errorFromResponse, retryDelay } from '../errors.ts'
import { readSse } from '../sse.ts'
import type { AiConnection, AiMaster, AiMessage, AiRequest, AiResponse, AiTool, AiToolCall, AiToolChoice, AiTransport, AiUsage } from '../types.ts'

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

/** Тело запроса в формате Chat Completions. */
export function buildRequestBody(model: string, request: AiRequest): Record<string, unknown> {
  const stream = request.stream !== false
  return {
    model,
    messages: request.messages.map(toApiMessage),
    ...(request.tools?.length ? { tools: request.tools.map(toApiTool) } : {}),
    ...(request.toolChoice && request.tools?.length ? { tool_choice: toApiToolChoice(request.toolChoice) } : {}),
    ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
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

/** Ответ без стриминга. */
function parseCompletion(json: unknown): AiResponse {
  const choice = (json as { choices?: { message?: { content?: unknown; tool_calls?: unknown }; finish_reason?: unknown }[] })?.choices?.[0]
  if (!choice?.message) throw new AiError('bad-response')
  const calls = Array.isArray(choice.message.tool_calls) ? choice.message.tool_calls : []
  return {
    text: typeof choice.message.content === 'string' ? choice.message.content : '',
    toolCalls: calls.map((c: { id?: string; function?: { name?: string; arguments?: string } }, i: number) =>
      parseArguments(c.id ?? `call_${i}`, c.function?.name ?? '', c.function?.arguments ?? ''),
    ),
    usage: toUsage((json as { usage?: unknown }).usage),
    finishReason: toFinish(choice.finish_reason),
    streamed: false,
  }
}

/** Ответ потоком: текст по частям, вызовы инструментов собираются по `index` из кусочков аргументов. */
async function parseStream(body: ReadableStream<Uint8Array>, request: AiRequest, apiKey: string): Promise<AiResponse> {
  let text = ''
  let usage: AiUsage | null = null
  let finishReason: AiResponse['finishReason'] = 'other'
  let chunks = 0
  const calls = new Map<number, { id: string; name: string; args: string }>()
  for await (const data of readSse(body, request.signal)) {
    if (data.trim() === '[DONE]') break
    let chunk: {
      error?: unknown
      usage?: unknown
      choices?: {
        delta?: { content?: unknown; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }
        finish_reason?: unknown
      }[]
    }
    try {
      chunk = JSON.parse(data)
    } catch {
      throw new AiError('bad-response')
    }
    if (chunk.error) throw errorFromResponse(500, chunk, new Headers(), apiKey)
    chunks++
    usage = toUsage(chunk.usage) ?? usage
    const choice = chunk.choices?.[0]
    if (!choice) continue
    const delta = choice.delta
    if (typeof delta?.content === 'string' && delta.content) {
      text += delta.content
      request.onText?.(delta.content)
    }
    for (const part of delta?.tool_calls ?? []) {
      const index = part.index ?? calls.size
      const call = calls.get(index) ?? { id: '', name: '', args: '' }
      if (part.id) call.id = part.id
      if (part.function?.name) call.name += part.function.name
      if (part.function?.arguments) call.args += part.function.arguments
      calls.set(index, call)
    }
    if (choice.finish_reason) finishReason = toFinish(choice.finish_reason)
  }
  const toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([i, c]) => parseArguments(c.id || `call_${i}`, c.name, c.args))
  return { text, toolCalls, usage, finishReason, streamed: chunks > 1 }
}

export function createOpenAiChatMaster(connection: AiConnection, transport: AiTransport): AiMaster {
  const { baseUrl, model, apiKey } = connection

  async function attempt(request: AiRequest): Promise<AiResponse> {
    let response: Response
    try {
      response = await transport.fetch(chatCompletionsUrl(baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(buildRequestBody(model, request)),
        signal: request.signal,
      })
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') throw new AiError('aborted')
      throw new AiError('network')
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      throw errorFromResponse(response.status, body, response.headers, apiKey)
    }
    try {
      const type = response.headers.get('content-type') ?? ''
      if (request.stream !== false && response.body && type.includes('text/event-stream')) return await parseStream(response.body, request, apiKey)
      return parseCompletion(await response.json())
    } catch (error) {
      if (error instanceof AiError) throw error
      if ((error as Error)?.name === 'AbortError') throw new AiError('aborted')
      if (error instanceof SyntaxError) throw new AiError('bad-response')
      throw new AiError('network')
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
          if (!(error instanceof AiError) || !error.retryable || started || n > transport.maxRetries || request.signal?.aborted) throw error
          const delayMs = retryDelay(error, n)
          request.onRetry?.({ attempt: n, delayMs, reason: error.message })
          await transport.sleep(delayMs)
        }
      }
    },
  }
}
