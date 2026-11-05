// Настройки ведущего: поставщик (пресет или свой), адрес API, модель, ключ, длина ответов.
// Ключ хранится только в localStorage браузера игрока (отдельный ключ хранилища) и уходит только по адресу API.
import { AI_FORMATS, type AiConnection, type AiFormat } from './types.ts'

export const AI_SETTINGS_KEY = 'ai-master:ai'
export const API_KEY_STORAGE = 'ai-master:api-key'

/** Готовые поставщики. «Свой» — адрес и модель вводятся вручную. */
export const AI_PRESETS = {
  deepseek: { name: 'DeepSeek', format: 'openai-chat', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', contextWindow: 128_000 },
} as const satisfies Record<string, { name: string; format: AiFormat; baseUrl: string; model: string; contextWindow: number }>
export type AiPresetId = keyof typeof AI_PRESETS
export type AiProvider = AiPresetId | 'custom'

/** Длина ответов ведущего: лимит токенов и указание в системном промте. */
export const VERBOSITY = {
  short: { name: 'Коротко', maxTokens: 350, instruction: 'Отвечай коротко: 2–3 предложения, только самое важное.' },
  normal: { name: 'Обычно', maxTokens: 800, instruction: 'Отвечай в обычном объёме: 3–6 предложений.' },
  detailed: { name: 'Подробно', maxTokens: 1600, instruction: 'Отвечай подробно: 6–10 предложений, с атмосферными деталями, но без воды.' },
} as const
export type Verbosity = keyof typeof VERBOSITY

export interface AiSettings {
  provider: AiProvider
  /** Для «Своего» поставщика. */
  format: AiFormat
  baseUrl: string
  model: string
  verbosity: Verbosity
  /** Окно контекста модели в токенах — для «Своего» поставщика (у пресета — из AI_PRESETS). */
  contextWindow: number
  /** Целевой размер запроса в токенах: больше — старая часть ленты сжимается в сводку. */
  targetTokens: number
  /** Модель для сжатия памяти (может быть дешевле); пусто — та же, что у ведущего. */
  compactModel: string
}

/** Окно контекста «Своего» поставщика по умолчанию и пределы настроек бюджета. */
export const DEFAULT_CONTEXT_WINDOW = 32_000
export const DEFAULT_TARGET_TOKENS = 20_000
export const MIN_CONTEXT_WINDOW = 4_000
export const MAX_CONTEXT_WINDOW = 2_000_000
export const MIN_TARGET_TOKENS = 3_000

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'deepseek',
  format: 'openai-chat',
  baseUrl: '',
  model: '',
  verbosity: 'normal',
  contextWindow: DEFAULT_CONTEXT_WINDOW,
  targetTokens: DEFAULT_TARGET_TOKENS,
  compactModel: '',
}

/** Окно контекста модели по настройкам: у пресета — из конфига, у «Своего» — как указал игрок. */
export const contextWindowOf = (settings: AiSettings) =>
  settings.provider === 'custom' ? settings.contextWindow : AI_PRESETS[settings.provider].contextWindow

/** Бюджет памяти ведущего: окно контекста, целевой размер запроса (не больше окна) и лимит ответа. */
export interface ContextBudget {
  contextWindow: number
  targetTokens: number
  maxResponseTokens: number
}

export function contextBudget(settings: AiSettings): ContextBudget {
  const contextWindow = contextWindowOf(settings)
  return {
    contextWindow,
    targetTokens: Math.min(settings.targetTokens, contextWindow),
    maxResponseTokens: VERBOSITY[settings.verbosity].maxTokens,
  }
}

/** Подключение для сжатия памяти: та же учётная запись, своя модель (если задана). */
export function compactConnection(settings: AiSettings, apiKey: string): AiConnection {
  const conn = aiConnection(settings, apiKey)
  const model = settings.compactModel.trim()
  return model ? { ...conn, model } : conn
}

/** Подключение по настройкам и ключу: у пресета адрес и модель свои. */
export function aiConnection(settings: AiSettings, apiKey: string): AiConnection {
  if (settings.provider !== 'custom') {
    const p = AI_PRESETS[settings.provider]
    return { format: p.format, baseUrl: p.baseUrl, model: p.model, apiKey: apiKey.trim() }
  }
  return { format: settings.format, baseUrl: settings.baseUrl.trim(), model: settings.model.trim(), apiKey: apiKey.trim() }
}

/** Проблема с адресом API или null. Ключ уходит по этому адресу — только https (http — лишь для localhost). */
export function baseUrlProblem(value: string): string | null {
  const v = value.trim()
  if (!v) return 'Укажите адрес API.'
  let url: URL
  try {
    url = new URL(v)
  } catch {
    return 'Адрес API должен начинаться с https://'
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    return 'Адрес API должен начинаться с https:// — иначе ключ уйдёт по сети открытым.'
  if (url.username || url.password) return 'Адрес API не должен содержать логин и пароль.'
  if (url.search || url.hash) return 'Адрес API — без параметров (?…) и якоря (#…).'
  return null
}

/** Чего не хватает для работы ведущего (пусто — всё готово). */
export function settingsProblems(settings: AiSettings, apiKey: string): string[] {
  const problems: string[] = []
  if (settings.provider === 'custom') {
    const url = baseUrlProblem(settings.baseUrl)
    if (url) problems.push(url)
    if (!settings.model.trim()) problems.push('Укажите название модели.')
  }
  if (!apiKey.trim()) problems.push('Введите ключ API.')
  const window = contextWindowOf(settings)
  if (settings.provider === 'custom' && !(window >= MIN_CONTEXT_WINDOW && window <= MAX_CONTEXT_WINDOW))
    problems.push(`Окно контекста — от ${MIN_CONTEXT_WINDOW} до ${MAX_CONTEXT_WINDOW} токенов.`)
  if (!(settings.targetTokens >= MIN_TARGET_TOKENS)) problems.push(`Размер запроса — не меньше ${MIN_TARGET_TOKENS} токенов.`)
  return problems
}

/** Настройки из хранилища: неизвестные значения заменяются стандартными. */
export function parseAiSettings(raw: string | null): AiSettings {
  let src: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}')
    if (parsed && typeof parsed === 'object') src = parsed as Record<string, unknown>
  } catch {
    // испорченные настройки — стандартные
  }
  const d = DEFAULT_AI_SETTINGS
  const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback)
  const int = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : fallback)
  return {
    provider:
      src.provider === 'custom' || (typeof src.provider === 'string' && src.provider in AI_PRESETS) ? (src.provider as AiProvider) : d.provider,
    format: typeof src.format === 'string' && src.format in AI_FORMATS ? (src.format as AiFormat) : d.format,
    baseUrl: str(src.baseUrl, d.baseUrl),
    model: str(src.model, d.model),
    verbosity: typeof src.verbosity === 'string' && src.verbosity in VERBOSITY ? (src.verbosity as Verbosity) : d.verbosity,
    contextWindow: int(src.contextWindow, d.contextWindow),
    targetTokens: int(src.targetTokens, d.targetTokens),
    compactModel: str(src.compactModel, d.compactModel),
  }
}
