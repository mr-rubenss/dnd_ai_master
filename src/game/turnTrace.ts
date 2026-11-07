// Запись ходов ведущего для тестового отчёта («Что-то не так»): по каждому запросу к модели — сообщения запроса
// после ленты (действие игрока и сообщения хода; системный промт и «Последние сообщения» не копируются — только
// их размер), краткое состояние, сырой ответ модели; по каждому вызову инструмента — аргументы и итог движка
// (в том числе отказ) и какие броски он сделал. Только в памяти вкладки (до перезагрузки) и без ключа: в запросах
// к модели его нет. Сам отчёт собирает src/game/testReport.ts.
import type { AiMessage, AiRequest, AiResponse, AiToolCall, AiUsage } from '../ai/types'
import type { ItemCatalog } from '../types/items'
import type { StoryState } from '../types/story'
import type { MasterRequestPlan } from './masterPrompt'
import type { MasterTraceHooks, TurnVerification } from './masterTurn'
import type { ToolOutcome } from './masterTools'
import { briefState } from './reportState'

export interface TraceRequest {
  at: number
  /** Сообщения после системного и ленты: действие игрока, ответы модели с вызовами и результаты инструментов. */
  messages: AiMessage[]
  /** Сколько сообщений ленты ушло в запрос (их тексты — в ходах отчёта). */
  recentCount: number
  /** Сколько старых сообщений не вошло из-за окна контекста. */
  dropped: number
  systemChars: number
  summaryChars: number
  factCount: number
  /** Раздел «Состояние игры» — кратко. */
  state: string
  estimatedTokens: number
  toolCount: number
  toolChoice?: AiRequest['toolChoice']
  maxTokens?: number
  temperature?: number
}

export interface TraceResponse {
  at: number
  text: string
  reasoning: string
  toolCalls: Pick<AiToolCall, 'id' | 'name' | 'rawArguments' | 'argumentsError'>[]
  finishReason: AiResponse['finishReason']
  usage: AiUsage | null
}

export interface TraceRound {
  request: TraceRequest
  response?: TraceResponse
}

export interface TraceTool {
  /** Номер раунда (с 0), в ответе которого был вызов. */
  round: number
  callId: string
  name: string
  rawArguments: string
  ok: boolean
  /** Что движок вернул модели (JSON). */
  result: string
  /** Броски этого вызова: id записей бросков (diceRolled) и карточек проверок (checkRolled). */
  rollIds: string[]
}

export interface TurnTrace {
  id: number
  storyId: string
  kind: 'turn' | 'rewrite'
  /** Последняя реплика игрока на начало хода — по ней ход связывается с журналом действий. */
  playerMessageId: string | null
  startedAt: number
  rounds: TraceRound[]
  tools: TraceTool[]
  verification?: TurnVerification
  /** Сверка текста с состоянием: что рассказ утверждал без изменений в игре. */
  claims?: string[]
  /** Ошибка запроса (текст уже без ключа — тексты ошибок свои). */
  error?: string
  /** Заглушка: ведущий не настроен, запроса не было. */
  stub?: boolean
}

/** Сколько ходов держать в памяти (в отчёт идут последние 15, плюс повторы и переписывания). */
export const TRACE_LIMIT = 40

/** id бросков из действий инструмента. */
export function rollIdsOf(outcome: ToolOutcome): string[] {
  const ids: string[] = []
  for (const { event } of outcome.events) {
    if (event.type === 'diceRolled') ids.push(event.roll.id)
    if (event.type === 'checkRolled') ids.push(event.roll?.id ?? event.messageId)
  }
  return ids
}

export function createTraceStore(now: () => number = Date.now) {
  let traces: TurnTrace[] = []
  let nextId = 1

  const store = {
    get: () => traces,
    of: (storyId: string) => traces.filter((t) => t.storyId === storyId),
    clear() {
      traces = []
    },
    /** Начать запись хода. Возвращает крючки для runMasterTurn и запись инструментов/ошибки/итога. */
    start(story: StoryState, kind: TurnTrace['kind'], catalog: ItemCatalog) {
      const lastPlayer = [...story.messages].reverse().find((m) => m.author === 'player')
      const trace: TurnTrace = { id: nextId++, storyId: story.id, kind, playerMessageId: lastPlayer?.id ?? null, startedAt: now(), rounds: [], tools: [] }
      traces = [...traces, trace].slice(-TRACE_LIMIT)
      const hooks: MasterTraceHooks = {
        request(state: StoryState, plan: MasterRequestPlan, request) {
          const system = plan.messages[0]?.role === 'system' ? plan.messages[0].content : ''
          trace.rounds.push({
            request: {
              at: now(),
              messages: plan.messages.slice(1 + plan.recentCount),
              recentCount: plan.recentCount,
              dropped: plan.dropped,
              systemChars: system.length,
              summaryChars: state.memory?.summary.length ?? 0,
              factCount: state.world.facts.length,
              state: briefState(state, catalog),
              estimatedTokens: plan.estimatedTokens,
              toolCount: request.toolCount,
              toolChoice: request.toolChoice,
              maxTokens: request.maxTokens,
              temperature: request.temperature,
            },
          })
        },
        response(response: AiResponse) {
          const round = trace.rounds.at(-1)
          if (!round) return
          round.response = {
            at: now(),
            text: response.text,
            reasoning: response.reasoning,
            toolCalls: response.toolCalls.map(({ id, name, rawArguments, argumentsError }) => ({ id, name, rawArguments, ...(argumentsError ? { argumentsError } : {}) })),
            finishReason: response.finishReason,
            usage: response.usage,
          }
        },
      }
      return {
        trace,
        hooks,
        tool(call: AiToolCall, outcome: ToolOutcome) {
          trace.tools.push({
            round: Math.max(0, trace.rounds.length - 1),
            callId: call.id,
            name: call.name,
            rawArguments: call.rawArguments,
            ok: outcome.ok,
            result: JSON.stringify(outcome.result),
            rollIds: rollIdsOf(outcome),
          })
        },
        fail(error: string) {
          trace.error = error
        },
        finish(verification: TurnVerification, claims?: string[]) {
          trace.verification = verification
          if (claims?.length) trace.claims = claims
        },
        stub() {
          trace.stub = true
        },
      }
    },
  }
  return store
}

export type TraceStore = ReturnType<typeof createTraceStore>
export type TraceRecorder = ReturnType<TraceStore['start']>

/** Записи ходов этой вкладки. */
export const traceStore = createTraceStore()
