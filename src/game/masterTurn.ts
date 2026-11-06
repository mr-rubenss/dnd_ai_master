// Ход ведущего через общий интерфейс src/ai/: ответ модели → выполнение инструментов → результаты обратно модели →
// финальный текст. ИИ меняет игру только инструментами (masterTools.ts): каждый вызов проверяет движок, недопустимый —
// отклоняется, и модель получает причину. Принятые действия записываются в историю через `commit` по одному.
import { AiError } from '../ai/errors'
import { VERBOSITY, type ContextBudget, type Verbosity } from '../ai/settings'
import type { AiMaster, AiMessage, AiRequest, AiResponse, AiToolCall, AiUsage } from '../ai/types'
import type { TurnChange } from '../types/game'
import type { ActionAuthor, StoryEvent, StoryState } from '../types/story'
import { buildMasterRequest, type PromptPart } from './masterPrompt'
import { rewritableMessageId, splitSuggestions } from './masterSuggestions'
import type { MasterStateContext } from './masterState'
import { executeTool, TURN_TOOLS, type ToolContext, type ToolOutcome } from './masterTools'
import { changeList, END_TURN, ledgerOf, turnDelta, verifyEndTurn } from './turnChanges'
import { isObject } from './validation'
import { MASTER } from './storyActions'
import { changeNames } from './rest'

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
  /** Что изменилось в листах за ход — для строки изменений в ленте (turnSummarized). */
  changes: TurnChange[]
  /** Сверка end_turn: сошлось, исправлено довызовом, не исправлено или не проводилась. */
  verification: TurnVerification
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

/** Напоминание, если модель закончила ответ без end_turn (один раз за ход). */
export const END_TURN_REMINDER =
  '[Код игры] Ты не вызвал end_turn. Если по твоему рассказу изменились деньги, предметы, хиты или состояния героя — ' +
  'сначала вызови нужные инструменты (change_gold, use_item, remove_item, give_item, change_hp, add_condition…), ' +
  'затем end_turn со списком изменений (или пустым списком). Новый текст не пиши.'

/** Итог сверки end_turn за ход — для журнала разработчика и тестов. */
export type TurnVerification =
  | { status: 'ok' }
  | { status: 'fixed'; problems: string[] }
  | { status: 'unresolved'; problems: string[] }
  | { status: 'skipped' }

export async function runMasterTurn(master: AiMaster, story: StoryState, options: MasterTurnOptions): Promise<MasterTurnResult> {
  const { runtime } = options
  const current = () => runtime?.getStory() ?? story
  const historyEnd = story.messages.length
  const turn: AiMessage[] = []
  const toolCalls: MasterTurnResult['toolCalls'] = []
  const catalog = runtime?.tools.catalog
  const ledger = runtime ? ledgerOf(story, runtime.tools.catalog) : null
  const reasons = new Map<string, string[]>()
  let narrated = false
  /** Один повтор за ход: ведущий не вызвал end_turn или заявил то, чего не сделал. */
  let retried: string[] | null = null
  let verification: TurnVerification = { status: 'skipped' }
  /** Следующий раунд — повтор: инструменты разрешены даже после лимита раундов. */
  let retryPending = false
  /** Раунд после напоминания про end_turn: рассказ уже в ленте — новый текст не дописываем (без повторов). */
  let afterReminder = false
  /** Вопрос вне игры: не ход — инструменты движок отклонит, сверки end_turn и напоминаний нет, подсказок тоже. */
  const outOfGame = Boolean(story.outOfGame)

  const finish = (text: string, suggestions: string[], response: AiResponse): MasterTurnResult => {
    if (!text && !narrated) emptyAnswer(response)
    const delta = ledger ? turnDelta(ledger, ledgerOf(current(), catalog!)) : null
    const names = runtime?.tools.rules ? changeNames(runtime.tools.rules) : undefined
    const changes = delta ? changeList(delta, current(), catalog!, reasons, names?.spells, names?.features) : []
    return { text, suggestions, truncated: response.finishReason === 'length', toolCalls, changes, verification }
  }

  /** Текст ответа — в ленту сразу (перед карточками бросков и повтором проверки). */
  const narrate = async (text: string, suggestions: string[]) => {
    if (!text) return
    const reason = await runtime!.commit(
      outOfGame
        ? { type: 'masterNarrated', messageId: runtime!.tools.newId(), text, ooc: true }
        : { type: 'masterNarrated', messageId: runtime!.tools.newId(), text, ...(suggestions.length ? { suggestions } : {}) },
      MASTER,
    )
    if (!reason) narrated = true
  }

  for (let round = 0; ; round++) {
    // Раунд повтора (довызов инструментов) разрешает инструменты даже после лимита раундов.
    const toolsAllowed = !!runtime && (round < MAX_TOOL_ROUNDS || retryPending)
    retryPending = false
    // Запрос собирается заново на каждый раунд: состояние и факты — свежие (после уже выполненных инструментов),
    // лента — на начало хода, дальше — сообщения этого хода.
    const plan = buildMasterRequest(current(), {
      verbosity: options.verbosity,
      context: options.context,
      tools: runtime ? TURN_TOOLS : undefined,
      budget: options.budget,
      factor: options.factor?.(),
      historyEnd,
      turn,
    })
    const response = await master.complete({
      messages: plan.messages,
      ...(runtime ? { tools: TURN_TOOLS, toolChoice: toolsAllowed ? ('auto' as const) : ('none' as const) } : {}),
      maxTokens: VERBOSITY[options.verbosity].maxTokens,
      temperature: 0.9,
      onText: options.onText,
      onRetry: options.onRetry,
      signal: options.signal,
    })
    options.onRequest?.({ purpose: 'turn', parts: partsReport(plan.parts), rawTokens: plan.rawTokens, estimatedTokens: plan.estimatedTokens, dropped: plan.dropped, usage: response.usage })
    const split = splitSuggestions(response.text)
    const suggestions = outOfGame ? [] : split.suggestions
    const text = afterReminder ? '' : split.text
    afterReminder = false
    const calls = toolsAllowed ? response.toolCalls : []
    if (!runtime) return finish(text, suggestions, response)

    const endCall = calls.find((c) => c.name === END_TURN)
    const others = calls.filter((c) => c.name !== END_TURN)

    if (others.length > 0) {
      // Текст перед вызовами («Ты пытаешься…») — в ленту сразу, перед карточками бросков.
      await narrate(text, suggestions)
      runtime.onRound?.()
    }
    const results: AiMessage[] = []
    for (const call of others) {
      let outcome = executeTool(current(), call, runtime.tools)
      for (const { event, author } of outcome.events) {
        const reason = await runtime.commit(event, author)
        if (reason) {
          outcome = { ok: false, result: { ok: false, error: reason }, events: [] }
          break
        }
      }
      if (outcome.ok && call.name === 'change_gold') {
        const money = outcome.events.find((e) => e.event.type === 'moneyChanged')?.event
        const why = isObject(call.arguments) && typeof call.arguments.reason === 'string' ? call.arguments.reason.trim() : ''
        if (money?.type === 'moneyChanged' && why) reasons.set(money.heroId, [...(reasons.get(money.heroId) ?? []), why])
      }
      toolCalls.push({ call, outcome })
      runtime.onTool?.(call, outcome)
      results.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(outcome.result) })
    }

    if (endCall && outOfGame) return finish(others.length ? '' : text, suggestions, response)
    if (endCall) {
      // Сверка: всё ли заявленное в end_turn сделано инструментами.
      const problems = verifyEndTurn(endCall.arguments, turnDelta(ledger!, ledgerOf(current(), catalog!)), current(), catalog!)
      if (problems.length === 0) {
        verification = retried ? { status: 'fixed', problems: retried } : { status: 'ok' }
        return finish(others.length ? '' : text, suggestions, response)
      }
      if (retried) {
        verification = { status: 'unresolved', problems }
        return finish(others.length ? '' : text, suggestions, response)
      }
      retried = problems
      retryPending = true
      if (!others.length) await narrate(text, suggestions)
      runtime.onRound?.()
      turn.push({ role: 'assistant', content: response.text || null, toolCalls: [...others, endCall] })
      turn.push(...results, {
        role: 'tool',
        toolCallId: endCall.id,
        content: JSON.stringify({
          ok: false,
          missing: problems,
          message:
            'В листе не хватает изменений, о которых ты рассказал. Вызови нужные инструменты, затем снова end_turn. ' +
            'Новый текст пиши, только если что-то не вышло (например, денег не хватило) — тогда коротко обыграй это.',
        }),
      })
      continue
    }

    if (others.length > 0) {
      // Обычный раунд инструментов: результаты — модели, дальше её ответ.
      turn.push({ role: 'assistant', content: response.text || null, toolCalls: others }, ...results)
      continue
    }

    // Ответ без вызовов. end_turn нет: один раз напоминаем (если инструменты ещё доступны; вне игры — не нужно).
    if (!toolsAllowed || retried || outOfGame) {
      if (verification.status === 'skipped' && retried) verification = { status: 'unresolved', problems: retried }
      return finish(text, suggestions, response)
    }
    retried = ['Ведущий не вызвал end_turn.']
    retryPending = true
    afterReminder = true
    if (!text && !narrated) emptyAnswer(response)
    await narrate(text, suggestions)
    runtime.onRound?.()
    turn.push({ role: 'assistant', content: response.text || null }, { role: 'user', content: END_TURN_REMINDER })
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
