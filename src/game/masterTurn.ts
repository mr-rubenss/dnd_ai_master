// Ход ведущего через общий интерфейс src/ai/: ответ модели → выполнение инструментов → результаты обратно модели →
// финальный текст. ИИ меняет игру только инструментами (masterTools.ts): каждый вызов проверяет движок, недопустимый —
// отклоняется, и модель получает причину. Принятые действия записываются в историю через `commit` по одному.
import { AiError } from '../ai/errors'
import { VERBOSITY, type ContextBudget, type Verbosity } from '../ai/settings'
import type { AiMaster, AiMessage, AiRequest, AiResponse, AiToolCall, AiUsage } from '../ai/types'
import type { ActionAuthor, StoryEvent, StoryState } from '../types/story'
import { buildMasterRequest, type PromptPart } from './masterPrompt'
import { rewritableMessageId, splitSuggestions } from './masterSuggestions'
import type { MasterStateContext } from './masterState'
import { executeTool, MASTER_TOOLS, type ToolContext, type ToolOutcome } from './masterTools'
import { MASTER } from './storyActions'

/** Сколько раундов «вызовы инструментов → результаты» за один ход; последний раунд — уже без инструментов. */
export const MAX_TOOL_ROUNDS = 4

export interface MasterToolRuntime {
  /** Текущее состояние истории (после уже записанных действий). */
  getStory: () => StoryState
  /** Записать действие в историю; причина отказа или null. */
  commit: (event: StoryEvent, author: ActionAuthor) => Promise<string | null> | string | null
  /** Справочник, генератор бросков, время, id. */
  tools: ToolContext
  /** После каждого вызова инструмента (для интерфейса). */
  onTool?: (call: AiToolCall, outcome: ToolOutcome) => void
  /** Текст ответа записан, дальше — инструменты и новый ответ модели: интерфейс сбрасывает текущий поток текста. */
  onRound?: () => void
}

/** Отчёт о запросе к модели — для журнала разработчика и уточнения подсчёта токенов. */
export interface RequestReport {
  purpose: 'turn' | 'rewrite' | 'compact' | 'resummarize' | 'merge-facts' | 'epilogue'
  parts: { label: string; tokens: number }[]
  rawTokens: number
  estimatedTokens: number
  dropped: number
  usage: AiUsage | null
}

export const partsReport = (parts: PromptPart[]) => parts.map((p) => ({ label: p.id, tokens: p.tokens }))

export interface MasterTurnOptions {
  verbosity: Verbosity
  /** Бюджет контекста; без него — запрос без обрезки. */
  budget?: ContextBudget
  /** Поправочный коэффициент подсчёта токенов (читается перед каждым запросом — он уточняется по ходу). */
  factor?: () => number
  /** После каждого запроса к модели. */
  onRequest?: (report: RequestReport) => void
  /** Справочник предметов и правила — для листа персонажа и инвентаря в запросе. */
  context: MasterStateContext
  /** Инструменты ведущего; без них — только текст. */
  runtime?: MasterToolRuntime
  onText?: AiRequest['onText']
  onRetry?: AiRequest['onRetry']
  signal?: AbortSignal
}

export interface MasterTurnResult {
  /** Финальный текст (записать действием masterNarrated); пустой — если весь рассказ уже записан по ходу. */
  text: string
  /** Подсказки действий из конца ответа (строка «Варианты: …» — из текста вырезана). */
  suggestions: string[]
  truncated: boolean
  /** Все вызовы инструментов за ход и их итог. */
  toolCalls: { call: AiToolCall; outcome: ToolOutcome }[]
}

function emptyAnswer(response: AiResponse): never {
  if (response.reasoning)
    throw new AiError('bad-response', {
      message:
        'Ведущий не успел ответить: модель «размышляла», и ответ не поместился в лимит длины. Выберите «Подробно» в «Настройки» → «Ведущий» или нерассуждающую модель.',
    })
  throw new AiError('bad-response', { message: 'Ведущий прислал пустой ответ. Попробуйте ещё раз.' })
}

export async function runMasterTurn(master: AiMaster, story: StoryState, options: MasterTurnOptions): Promise<MasterTurnResult> {
  const { runtime } = options
  const current = () => runtime?.getStory() ?? story
  const historyEnd = story.messages.length
  const turn: AiMessage[] = []
  const toolCalls: MasterTurnResult['toolCalls'] = []
  let narrated = false

  for (let round = 0; ; round++) {
    const toolsAllowed = !!runtime && round < MAX_TOOL_ROUNDS
    // Запрос собирается заново на каждый раунд: состояние и факты — свежие (после уже выполненных инструментов),
    // лента — на начало хода, дальше — сообщения этого хода.
    const plan = buildMasterRequest(current(), {
      verbosity: options.verbosity,
      context: options.context,
      tools: runtime ? MASTER_TOOLS : undefined,
      budget: options.budget,
      factor: options.factor?.(),
      historyEnd,
      turn,
    })
    const response = await master.complete({
      messages: plan.messages,
      ...(runtime ? { tools: MASTER_TOOLS, toolChoice: toolsAllowed ? ('auto' as const) : ('none' as const) } : {}),
      maxTokens: VERBOSITY[options.verbosity].maxTokens,
      temperature: 0.9,
      onText: options.onText,
      onRetry: options.onRetry,
      signal: options.signal,
    })
    options.onRequest?.({ purpose: 'turn', parts: partsReport(plan.parts), rawTokens: plan.rawTokens, estimatedTokens: plan.estimatedTokens, dropped: plan.dropped, usage: response.usage })
    const { text, suggestions } = splitSuggestions(response.text)
    const calls = toolsAllowed ? response.toolCalls : []

    if (calls.length === 0) {
      if (!text && !narrated) emptyAnswer(response)
      return { text, suggestions, truncated: response.finishReason === 'length', toolCalls }
    }

    // Текст перед вызовами («Ты пытаешься…») — в ленту сразу, перед карточками бросков.
    if (text) {
      const reason = await runtime!.commit({ type: 'masterNarrated', messageId: runtime!.tools.newId(), text }, MASTER)
      if (!reason) narrated = true
    }
    turn.push({ role: 'assistant', content: response.text || null, toolCalls: calls })
    runtime!.onRound?.()
    for (const call of calls) {
      let outcome = executeTool(current(), call, runtime!.tools)
      for (const { event, author } of outcome.events) {
        const reason = await runtime!.commit(event, author)
        if (reason) {
          outcome = { ok: false, result: { ok: false, error: reason }, events: [] }
          break
        }
      }
      toolCalls.push({ call, outcome })
      runtime!.onTool?.(call, outcome)
      turn.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(outcome.result) })
    }
  }
}

/** Просьба переписать ответ — служебное сообщение модели (после её последнего ответа). */
export const REWRITE_REQUEST =
  '[Код игры] Игрок попросил переписать твой последний ответ. Напиши его заново, по-другому: другие детали, слова ' +
  'и реплики НПС. Всё, что уже случилось по правилам (броски и их итоги, предметы, урон, перемещения), остаётся ' +
  'как есть — не противоречь этому и ничего не меняй. Не упоминай, что ответ переписан.'

export interface MasterRewriteResult {
  messageId: string
  text: string
  suggestions: string[]
  truncated: boolean
}

/**
 * «Переписать ответ»: новый текст последнего ответа ведущего — без инструментов, чтобы переписывание
 * не меняло игру и не позволяло перебросить кубики. null — переписывать нечего (последнее в ленте — не ответ ведущего).
 */
export async function runMasterRewrite(
  master: AiMaster,
  story: StoryState,
  options: Omit<MasterTurnOptions, 'runtime'>,
): Promise<MasterRewriteResult | null> {
  const messageId = rewritableMessageId(story.messages)
  if (!messageId) return null
  const plan = buildMasterRequest(story, {
    verbosity: options.verbosity,
    context: options.context,
    budget: options.budget,
    factor: options.factor?.(),
    trailing: [{ role: 'user', content: REWRITE_REQUEST }],
  })
  const response = await master.complete({
    messages: plan.messages,
    maxTokens: VERBOSITY[options.verbosity].maxTokens,
    temperature: 1,
    onText: options.onText,
    onRetry: options.onRetry,
    signal: options.signal,
  })
  options.onRequest?.({ purpose: 'rewrite', parts: partsReport(plan.parts), rawTokens: plan.rawTokens, estimatedTokens: plan.estimatedTokens, dropped: plan.dropped, usage: response.usage })
  const { text, suggestions } = splitSuggestions(response.text)
  if (!text) emptyAnswer(response)
  return { messageId, text, suggestions, truncated: response.finishReason === 'length' }
}
