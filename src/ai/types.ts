// Общий интерфейс ИИ-ведущего. Игра работает только с ним; формат API конкретного поставщика —
// забота адаптера (src/ai/adapters/). Новый формат = новый адаптер + строка в реестре (index.ts), игра не меняется.

/** Вызов инструмента, который предложила модель (ИИ только предлагает — исполняет и проверяет код игры). */
export interface AiToolCall {
  id: string
  name: string
  /** Аргументы, разобранные из JSON; null — если модель прислала некорректный JSON (см. `argumentsError`). */
  arguments: unknown
  /** Аргументы как прислала модель (строка JSON) — нужны, чтобы вернуть историю диалога модели как есть. */
  rawArguments: string
  argumentsError?: string
}

export type AiMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: AiToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string }

/** Описание инструмента: имя, назначение, параметры — JSON Schema объекта. */
export interface AiTool {
  name: string
  description: string
  parameters: Record<string, unknown>
}

/** auto — модель решает сама; none — без инструментов; required — обязательно вызвать; { name } — этот инструмент. */
export type AiToolChoice = 'auto' | 'none' | 'required' | { name: string }

export interface AiRequest {
  messages: AiMessage[]
  tools?: AiTool[]
  toolChoice?: AiToolChoice
  maxTokens?: number
  temperature?: number
  /** Стриминг (по умолчанию — да): текст приходит по частям в `onText`. */
  stream?: boolean
  onText?: (delta: string) => void
  /** Перед автоматическим повтором (превышен лимит запросов, сервер перегружен). */
  onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void
  signal?: AbortSignal
}

/** Расход токенов. */
export interface AiUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface AiResponse {
  text: string
  toolCalls: AiToolCall[]
  /** null — поставщик не сообщил расход. */
  usage: AiUsage | null
  /** stop — закончил; length — упёрся в лимит длины; tool_calls — ждёт результатов инструментов. */
  finishReason: 'stop' | 'length' | 'tool_calls' | 'other'
  /** Ответ действительно пришёл потоком (несколько частей). */
  streamed: boolean
}

/** Ведущий: отправить сообщения и инструменты — получить текст, вызовы инструментов и расход токенов. */
export interface AiMaster {
  /** Формат API адаптера, например `openai-chat`. */
  readonly format: AiFormat
  complete(request: AiRequest): Promise<AiResponse>
}

/** Форматы API, для которых есть адаптеры. */
export const AI_FORMATS = {
  'openai-chat': 'OpenAI Chat Completions',
} as const
export type AiFormat = keyof typeof AI_FORMATS

/** Куда и с чем обращаться. Ключ передаёт только браузер игрока — напрямую по адресу API. */
export interface AiConnection {
  format: AiFormat
  baseUrl: string
  model: string
  apiKey: string
}

/** Зависимости адаптера — подменяются в тестах. */
export interface AiTransport {
  fetch: typeof fetch
  sleep: (ms: number) => Promise<void>
  /** Сколько раз повторять при превышении лимита / перегрузке. */
  maxRetries: number
}
