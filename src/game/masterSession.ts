// Ведущий по настройкам игрока: подключения (ведущий и модель сжатия), бюджет контекста, поправка подсчёта
// токенов по usage и запись запросов в журнал разработчика. Связывает src/ai/ (поставщик) и память ведущего.
import { calibrationStore } from '../ai/calibrationStore'
import { createMaster } from '../ai'
import { aiConnection, compactConnection, contextBudget, type AiSettings } from '../ai/settings'
import type { AiMaster } from '../ai/types'
import { devLog } from './devLog'
import type { RequestReport } from './masterTurn'

export interface MasterSession {
  master: AiMaster
  /** Модель для сжатия памяти (та же или более дешёвая). */
  compactor: AiMaster
  model: string
  compactModel: string
  budget: ReturnType<typeof contextBudget>
  /** Для хода ведущего: бюджет, поправка токенов, отчёт о запросе. */
  turn: { budget: ReturnType<typeof contextBudget>; factor: () => number; onRequest: (r: RequestReport) => void }
  /** Для сжатия памяти: размер запроса ведущего (factor — его модели), запросы сжатия — модели сжатия. */
  compact: {
    budget: ReturnType<typeof contextBudget>
    factor: () => number
    requestFactor: () => number
    onRequest: (r: RequestReport) => void
  }
}

/** После ответа: уточнить подсчёт токенов по usage и записать запрос в журнал разработчика. */
export const requestReporter = (model: string) => (report: RequestReport) => {
  if (report.usage && report.usage.inputTokens > 0) calibrationStore.record(model, report.rawTokens, report.usage.inputTokens)
  devLog.add({ kind: 'request', model, ...report })
}

export function masterSession(settings: AiSettings, apiKey: string): MasterSession {
  const conn = aiConnection(settings, apiKey)
  const compactConn = compactConnection(settings, apiKey)
  const master = createMaster(conn)
  const compactor = compactConn.model === conn.model ? master : createMaster(compactConn)
  const budget = contextBudget(settings)
  return {
    master,
    compactor,
    model: conn.model,
    compactModel: compactConn.model,
    budget,
    turn: { budget, factor: () => calibrationStore.factor(conn.model), onRequest: requestReporter(conn.model) },
    compact: {
      budget,
      factor: () => calibrationStore.factor(conn.model),
      requestFactor: () => calibrationStore.factor(compactConn.model),
      onRequest: requestReporter(compactConn.model),
    },
  }
}
