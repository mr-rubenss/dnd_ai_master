// Ход ведущего через общий интерфейс src/ai/: ответ модели → выполнение инструментов → результаты обратно модели →
// финальный текст. ИИ меняет игру только инструментами (masterTools.ts): каждый вызов проверяет движок, недопустимый —
// отклоняется, и модель получает причину. Принятые действия записываются в историю через `commit` по одному.
import { AiError } from '../ai/errors'
import { VERBOSITY, type ContextBudget, type Verbosity } from '../ai/settings'
import type { AiMaster, AiMessage, AiRequest, AiResponse, AiToolCall, AiUsage } from '../ai/types'
import type { TurnChange } from '../types/game'
import type { ActionAuthor, StoryEvent, StoryState } from '../types/story'
import { buildMasterRequest, type MasterRequestPlan, type PromptPart } from './masterPrompt'
import { rewritableMessageId, splitSuggestions } from './masterSuggestions'
import type { MasterStateContext } from './masterState'
import { executeTool, TURN_TOOLS, type ToolContext, type ToolOutcome } from './masterTools'
import { changeList, END_TURN, ledgerOf, turnDelta, verifyEndTurn } from './turnChanges'
import { isObject } from './validation'
import { MASTER } from './storyActions'
import { changeNames } from './rest'
import { mapProblems } from './mapClaims'
import { castProblems, claimProblems, claimReminder } from './claimCheck'
import { knownSpells } from './magic'

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
  /** Запись хода для тестового отчёта (src/game/turnTrace.ts): каждый запрос к модели и её сырой ответ. */
  trace?: MasterTraceHooks
}

/** Сырой обмен с моделью — для тестового отчёта: запрос (до отправки) и ответ. */
export interface MasterTraceHooks {
  request: (story: StoryState, plan: MasterRequestPlan, request: Pick<AiRequest, 'toolChoice' | 'maxTokens' | 'temperature'> & { toolCount: number }) => void
  response: (response: AiResponse) => void
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
  /** Сверка текста с состоянием: что рассказ утверждал без изменений в игре (ведущего попросили исправить). */
  claims?: string[]
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

/** Инструменты нового места: их отказ в ответе с end_turn не завершает ход. */
const PLACE_TOOLS = ['create_location', 'travel']
export const PLACE_RETRY_MESSAGE =
  '[Код игры] Новое место не готово: вызов отклонён (ошибки — в результатах выше). Исправь и вызови снова: ' +
  'create_location (если карты ещё нет), затем travel. Не описывай место, пока travel не прошёл.'
export const PLACE_CONTINUE_MESSAGE =
  '[Код игры] Переход не завершён: нужна карта места (create_location, если её ещё нет) и travel. Вызови недостающее; описывай место только после travel.'
/** Сколько раундов после сверки даётся на создание места и переход. */
const MAX_PLACE_FOLLOWUPS = 3
export const ARRIVAL_MESSAGE = '[Код игры] Отряд на новой карте (она в состоянии игры). Опиши новое место по её карте: что видно, кто здесь. Затем end_turn.'

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
  /** Рассказ, уже записанный в ленту за ход, и id последнего такого сообщения (для исправления после сверки текста). */
  const narratedTexts: string[] = []
  let lastNarratedId: string | null = null
  /** Сверка текста с состоянием — один раз за ход; следующий раунд — ответ на просьбу привести их в соответствие. */
  let claimChecked = false
  /** Сколько дополнительных раундов уже дано на создание места и переход после сверки. */
  let placeFollowups = 0
  let claimRound = false
  let claims: string[] | undefined
  let pending: { text: string; suggestions: string[] } = { text: '', suggestions: [] }

  const finish = (text: string, suggestions: string[], response: AiResponse): MasterTurnResult => {
    if (!text && !narrated) emptyAnswer(response)
    const delta = ledger ? turnDelta(ledger, ledgerOf(current(), catalog!)) : null
    const names = runtime?.tools.rules ? changeNames(runtime.tools.rules) : undefined
    const changes = delta ? changeList(delta, current(), catalog!, reasons, names?.spells, names?.features) : []
    return { text, suggestions, truncated: response.finishReason === 'length', toolCalls, changes, verification, ...(claims ? { claims } : {}) }
  }

  /** Текст ответа — в ленту сразу (перед карточками бросков и повтором проверки). */
  const narrate = async (text: string, suggestions: string[]) => {
    if (!text) return
    const messageId = runtime!.tools.newId()
    const reason = await runtime!.commit(
      outOfGame
        ? { type: 'masterNarrated', messageId, text, ooc: true }
        : { type: 'masterNarrated', messageId, text, ...(suggestions.length ? { suggestions } : {}) },
      MASTER,
    )
    if (!reason) {
      narrated = true
      narratedTexts.push(text)
      lastNarratedId = messageId
    }
  }

  /** Выполнить вызов инструмента: проверка движком, запись действий, результат для модели. */
  const runCall = async (call: AiToolCall): Promise<AiMessage> => {
    let outcome = executeTool(current(), call, runtime!.tools)
    for (const { event, author } of outcome.events) {
      const reason = await runtime!.commit(event, author)
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
    runtime!.onTool?.(call, outcome)
    return { role: 'tool', toolCallId: call.id, content: JSON.stringify(outcome.result) }
  }

  /** Реплика игрока, с которой начался ход (а не событие карты: старую реплику не перепроверяем). */
  const turnPlayerMessage = () => {
    const last = [...story.messages].reverse().find((m) => !m.changes)
    return last?.author === 'player' ? last : undefined
  }
  /** Игрок заявил каст заклинания своего героя, а cast_spell не вызывался — просьба вызвать (часть сверки текста). */
  const spellClaims = (): string[] => {
    const rules = runtime?.tools.rules
    const said = turnPlayerMessage()
    if (!rules || !said || said.ooc) return []
    const hero = story.party.find((m) => m.heroId === said.heroId) ?? story.party[0]
    if (!hero) return []
    return castProblems(said.text, knownSpells(hero.character, rules).map((k) => k.spell), toolCalls)
  }

  /**
   * Конец хода — сначала сверка текста с состоянием (один раз): если рассказ утверждает то, чего нет в игре
   * (герой получил, победил, ранен), модель получает короткую просьбу — довызвать инструмент или переписать ответ.
   * null — просьба отправлена, нужен ещё раунд.
   */
  const settle = (text: string, suggestions: string[], response: AiResponse, calls: AiToolCall[], results: AiMessage[]): MasterTurnResult | null => {
    if (!runtime || outOfGame || claimChecked) return finish(text, suggestions, response)
    claimChecked = true
    const narrated = [...narratedTexts, text].join('\n')
    const problems = [
      ...claimProblems(narrated, turnDelta(ledger!, ledgerOf(current(), catalog!)), toolCalls),
      ...spellClaims(),
      ...mapProblems(narrated, story, current(), toolCalls, turnPlayerMessage()),
    ]
    if (problems.length === 0) return finish(text, suggestions, response)
    claims = problems
    pending = { text, suggestions }
    const end = calls.find((c) => c.name === END_TURN)
    turn.push({ role: 'assistant', content: response.text || null, ...(calls.length ? { toolCalls: calls } : {}) }, ...results)
    if (end) turn.push({ role: 'tool', toolCallId: end.id, content: JSON.stringify({ ok: true }) })
    turn.push({ role: 'user', content: claimReminder(problems) })
    claimRound = true
    retryPending = true
    runtime.onRound?.()
    return null
  }

  for (let round = 0; ; round++) {
    // Раунд повтора (довызов инструментов) разрешает инструменты даже после лимита раундов.
    // Начато создание нового места, а перехода ещё нет — ещё до MAX_PLACE_FOLLOWUPS раундов сверх лимита.
    const placePending =
      toolCalls.some((t) => PLACE_TOOLS.includes(t.call.name)) && !toolCalls.some((t) => t.call.name === 'travel' && t.outcome.ok)
    const toolsAllowed = !!runtime && (round < MAX_TOOL_ROUNDS || retryPending || (placePending && round < MAX_TOOL_ROUNDS + MAX_PLACE_FOLLOWUPS))
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
    const toolChoice = runtime ? (toolsAllowed ? ('auto' as const) : ('none' as const)) : undefined
    options.trace?.request(current(), plan, { toolChoice, maxTokens: VERBOSITY[options.verbosity].maxTokens, temperature: 0.9, toolCount: runtime ? TURN_TOOLS.length : 0 })
    const response = await master.complete({
      messages: plan.messages,
      ...(runtime ? { tools: TURN_TOOLS, toolChoice } : {}),
      maxTokens: VERBOSITY[options.verbosity].maxTokens,
      temperature: 0.9,
      onText: options.onText,
      onRetry: options.onRetry,
      signal: options.signal,
    })
    options.trace?.response(response)
    options.onRequest?.({ purpose: 'turn', parts: partsReport(plan.parts), rawTokens: plan.rawTokens, estimatedTokens: plan.estimatedTokens, dropped: plan.dropped, usage: response.usage })
    const split = splitSuggestions(response.text)
    const suggestions = outOfGame ? [] : split.suggestions
    const text = afterReminder ? '' : split.text
    afterReminder = false
    const calls = toolsAllowed ? response.toolCalls : []
    if (!runtime) return finish(text, suggestions, response)

    if (claimRound) {
      // Ответ на просьбу сверки: довызванные инструменты исполняются; новый текст заменяет ответ, пустой — ответ прежний.
      claimRound = false
      const from = toolCalls.length
      const claimResults: AiMessage[] = []
      for (const call of calls.filter((c) => c.name !== END_TURN)) claimResults.push(await runCall(call))
      // Довызов нового места: создание карты и переход — по шагам, пока travel не пройдёт и место не описано.
      const placeCalls = toolCalls.slice(from).filter((t) => PLACE_TOOLS.includes(t.call.name))
      const traveled = toolCalls.some((t) => t.call.name === 'travel' && t.outcome.ok)
      if (placeCalls.length > 0 && placeFollowups < MAX_PLACE_FOLLOWUPS && (!traveled || !text)) {
        placeFollowups++
        const end = calls.find((c) => c.name === END_TURN)
        turn.push({ role: 'assistant', content: response.text || null, toolCalls: calls }, ...claimResults)
        if (end) turn.push({ role: 'tool', toolCallId: end.id, content: JSON.stringify({ ok: true }) })
        turn.push({ role: 'user', content: traveled ? ARRIVAL_MESSAGE : PLACE_CONTINUE_MESSAGE })
        claimRound = true
        retryPending = true
        runtime.onRound?.()
        continue
      }
      if (!text) return finish(pending.text, pending.suggestions, response)
      if (pending.text || !lastNarratedId) return finish(text, suggestions, response)
      const reason = await runtime.commit({ type: 'masterRewritten', messageId: lastNarratedId, text, ...(suggestions.length ? { suggestions } : {}) }, MASTER)
      return reason ? finish(text, suggestions, response) : finish('', [], response)
    }

    const endCall = calls.find((c) => c.name === END_TURN)
    const others = calls.filter((c) => c.name !== END_TURN)

    if (others.length > 0) {
      // Текст перед вызовами («Ты пытаешься…») — в ленту сразу, перед карточками бросков.
      await narrate(text, suggestions)
      runtime.onRound?.()
    }
    const results: AiMessage[] = []
    for (const call of others) results.push(await runCall(call))
    const outcomes = toolCalls.slice(toolCalls.length - others.length)

    if (endCall && outOfGame) return finish(others.length ? '' : text, suggestions, response)
    // Новое место: отказ create_location/travel в одном ответе с end_turn — модель должна увидеть ошибки и исправить;
    // удачный travel без рассказа — модель должна описать новое место (его карта — в состоянии следующего запроса).
    const placeFailed = outcomes.some((t) => PLACE_TOOLS.includes(t.call.name) && !t.outcome.ok)
    const arrivedSilently = outcomes.some((t) => t.call.name === 'travel' && t.outcome.ok) && !text && narratedTexts.length === 0
    if (endCall && round < MAX_TOOL_ROUNDS && (placeFailed || arrivedSilently)) {
      runtime.onRound?.()
      turn.push({ role: 'assistant', content: response.text || null, toolCalls: [...others, endCall] }, ...results, {
        role: 'tool',
        toolCallId: endCall.id,
        content: JSON.stringify({ ok: false, message: placeFailed ? PLACE_RETRY_MESSAGE : ARRIVAL_MESSAGE }),
      })
      continue
    }
    if (endCall) {
      // Сверка: всё ли заявленное в end_turn сделано инструментами.
      const problems = verifyEndTurn(endCall.arguments, turnDelta(ledger!, ledgerOf(current(), catalog!)), current(), catalog!)
      if (problems.length === 0) {
        verification = retried ? { status: 'fixed', problems: retried } : { status: 'ok' }
        const done = settle(others.length ? '' : text, suggestions, response, [...others, endCall], results)
        if (done) return done
        continue
      }
      if (retried) {
        verification = { status: 'unresolved', problems }
        const done = settle(others.length ? '' : text, suggestions, response, [...others, endCall], results)
        if (done) return done
        continue
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
      const done = settle(text, suggestions, response, [], [])
      if (done) return done
      continue
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
  options.trace?.request(story, plan, { maxTokens: VERBOSITY[options.verbosity].maxTokens, temperature: 1, toolCount: 0 })
  const response = await master.complete({
    messages: plan.messages,
    maxTokens: VERBOSITY[options.verbosity].maxTokens,
    temperature: 1,
    onText: options.onText,
    onRetry: options.onRetry,
    signal: options.signal,
  })
  options.trace?.response(response)
  options.onRequest?.({ purpose: 'rewrite', parts: partsReport(plan.parts), rawTokens: plan.rawTokens, estimatedTokens: plan.estimatedTokens, dropped: plan.dropped, usage: response.usage })
  const { text, suggestions } = splitSuggestions(response.text)
  if (!text) emptyAnswer(response)
  return { messageId, text, suggestions, truncated: response.finishReason === 'length' }
}
