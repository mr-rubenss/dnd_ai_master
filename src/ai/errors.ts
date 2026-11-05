// Ошибки ведущего: понятные сообщения для игрока. Ключ API никогда не попадает в сообщения.

export type AiErrorKind =
  | 'auth' // неверный ключ
  | 'billing' // нет денег на счёте
  | 'rate-limit' // превышен лимит запросов
  | 'network' // нет сети / адрес недоступен / CORS
  | 'model-not-found'
  | 'not-found' // неверный адрес API
  | 'bad-request'
  | 'context-length' // запрос не поместился в окно контекста модели
  | 'server'
  | 'bad-response'
  | 'aborted'
  | 'not-configured'

const MESSAGES: Record<AiErrorKind, string> = {
  auth: 'Ключ API не принят. Проверьте ключ в «Настройки» → «Ведущий».',
  billing: 'На счёте у поставщика модели закончились деньги. Пополните баланс в личном кабинете поставщика.',
  'rate-limit': 'Превышен лимит запросов к модели. Подождите немного и попробуйте снова.',
  network:
    'Не удалось связаться с адресом API: нет сети, адрес указан неверно или сервер не разрешает запросы из браузера (CORS — тогда нужен прокси).',
  'model-not-found': 'Модель не найдена. Проверьте название модели в «Настройки» → «Ведущий».',
  'not-found': 'По этому адресу API нет нужного метода. Проверьте адрес (base URL) в «Настройки» → «Ведущий».',
  'bad-request': 'Модель не приняла запрос.',
  'context-length': 'Запрос не поместился в окно контекста модели. Уменьшите «Окно контекста» или «Размер запроса» в «Настройки» → «Ведущий».',
  server: 'Сервер модели перегружен или недоступен. Попробуйте позже.',
  'bad-response': 'Модель прислала ответ в непонятном формате.',
  aborted: 'Запрос отменён.',
  'not-configured': 'Ведущий не настроен: укажите адрес API, модель и ключ в «Настройки» → «Ведущий».',
}

export class AiError extends Error {
  readonly kind: AiErrorKind
  readonly status?: number
  /** Сколько ждать перед повтором (из заголовка Retry-After), если сервер сообщил. */
  readonly retryAfterMs?: number
  /** Подробность от поставщика — уже без ключа (для «Модель не приняла запрос»). */
  readonly detail?: string
  /** На чём споткнулось: «HTTP 400 от сервера», «разбор потока: …» — для проверки подключения и диагностики. */
  readonly stage?: string

  constructor(kind: AiErrorKind, options: { status?: number; retryAfterMs?: number; detail?: string; message?: string; stage?: string } = {}) {
    super(options.message ?? (options.detail ? `${MESSAGES[kind]} ${options.detail}` : MESSAGES[kind]))
    this.name = 'AiError'
    this.kind = kind
    this.status = options.status
    this.retryAfterMs = options.retryAfterMs
    this.detail = options.detail
    this.stage = options.stage ?? (options.status ? `ответ сервера HTTP ${options.status}` : undefined)
  }

  /** Повторять ли запрос автоматически. */
  get retryable() {
    return this.kind === 'rate-limit' || this.kind === 'server'
  }
}

export const aiErrorMessage = (kind: AiErrorKind) => MESSAGES[kind]

/**
 * Убирает из текста ключ и всё на него похожее: сам ключ, его концы (поставщики пишут «****abcd»),
 * строки вида sk-… и заголовок Authorization.
 */
export function redactSecrets(text: string, apiKey?: string): string {
  const HIDDEN = '[ключ скрыт]'
  let out = text
    .replace(/Bearer\s+[^\s;,"']+/gi, `Bearer ${HIDDEN}`)
    .replace(/\b(sk|key|api)[-_][A-Za-z0-9_-]{6,}/gi, HIDDEN)
    .replace(/\*{2,}[A-Za-z0-9_-]*/g, HIDDEN)
  if (apiKey && apiKey.length >= 4) {
    out = out.split(apiKey).join(HIDDEN)
    for (const len of [8, 6, 4]) if (apiKey.length > len) out = out.split(apiKey.slice(-len)).join(HIDDEN)
  }
  return out
}

/** Ошибка по HTTP-ответу поставщика. `body` — разобранный JSON ошибки (если есть). */
export function errorFromResponse(status: number, body: unknown, headers: Headers, apiKey: string): AiError {
  const err = (body as { error?: { message?: unknown; code?: unknown; type?: unknown } } | null)?.error
  const raw = [err?.message, err?.code, err?.type].filter((x) => typeof x === 'string').join(' ')
  const detail = raw ? redactSecrets(String(err?.message ?? raw), apiKey).slice(0, 300) : undefined
  const retryAfter = parseRetryAfter(headers.get('retry-after'))
  const mentionsModel = /model/i.test(raw) && /(not\s*exist|not\s*found|does not exist|unknown|invalid model|no such)/i.test(raw)
  if (status === 401 || status === 403) return new AiError('auth', { status })
  if (status === 402 || /insufficient[_ ](quota|balance)/i.test(raw)) return new AiError('billing', { status })
  if (status === 429) return new AiError('rate-limit', { status, retryAfterMs: retryAfter })
  // «Слишком длинный контекст»: формулировки OpenAI, DeepSeek, OpenRouter, vLLM и др.
  if ((status === 400 || status === 413 || status === 422) && /context[_ ]length|context window|maximum context|too many tokens|prompt is too long|reduce the length|input is too long|exceeds? the (model'?s )?(max|context)/i.test(raw))
    return new AiError('context-length', { status, detail })
  if (mentionsModel && (status === 400 || status === 404 || status === 422)) return new AiError('model-not-found', { status })
  if (status === 404) return new AiError('not-found', { status })
  if (status >= 500) return new AiError('server', { status, retryAfterMs: retryAfter })
  return new AiError('bad-request', { status, detail })
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

/** Пауза перед повтором: Retry-After или 2, 4, 8… секунд (не больше 30). */
export const retryDelay = (error: AiError, attempt: number) => Math.min(30_000, error.retryAfterMs ?? 2000 * 2 ** (attempt - 1))
