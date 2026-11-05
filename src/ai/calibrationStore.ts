// Поправочные коэффициенты подсчёта токенов по моделям (см. tokens.ts): уточняются по usage из ответов API
// и хранятся в localStorage браузера (`ai-master:token-calibration`) — настройка устройства, не истории.
import { calibrated, MAX_FACTOR, MIN_FACTOR } from './tokens.ts'

export const CALIBRATION_KEY = 'ai-master:token-calibration'

function load(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(CALIBRATION_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, number> = {}
    for (const [model, f] of Object.entries(parsed))
      if (typeof f === 'number' && f >= MIN_FACTOR && f <= MAX_FACTOR) out[model] = f
    return out
  } catch {
    return {}
  }
}

let factors: Record<string, number> | null = null

export const calibrationStore = {
  /** Коэффициент для модели (1 — пока нет данных). */
  factor(model: string): number {
    factors ??= load()
    return factors[model] ?? 1
  },
  /** Уточнить по usage: сырая оценка запроса и сколько насчитал поставщик. */
  record(model: string, raw: number, actual: number) {
    factors ??= load()
    factors = { ...factors, [model]: calibrated(this.factor(model), raw, actual) }
    try {
      window.localStorage.setItem(CALIBRATION_KEY, JSON.stringify(factors))
    } catch {
      // приватный режим — коэффициент живёт до перезагрузки
    }
  },
  /** Модель сказала «слишком длинно» — оценка занижена: поднимаем коэффициент. */
  underestimated(model: string) {
    factors ??= load()
    const f = Math.min(MAX_FACTOR, this.factor(model) * 1.25)
    factors = { ...factors, [model]: f }
    try {
      window.localStorage.setItem(CALIBRATION_KEY, JSON.stringify(factors))
    } catch {
      // см. выше
    }
  },
}
