// Запрос к ИИ-ведущему по истории — собирается из частей в постоянном порядке, неизменная часть первой
// (так у поставщика работает кэш префикса):
//   правила (dm-prompt.md, эта история, длина ответа) → описания инструментов (поле tools запроса) →
//   «Что было раньше» (сводка памяти) → журнал фактов → состояние игры (герои, карта) → последние сообщения →
//   действие игрока.
// Перед запросом размер каждой части оценивается (src/ai/tokens.ts). Если запрос рискует не влезть в окно
// контекста модели — самые старые сообщения из него убираются (в истории они остаются). Чистые функции:
// только общий интерфейс src/ai/, никакого знания о поставщике модели.
import dmPrompt from '../ai/dm-prompt.md?raw'
import { VERBOSITY, type ContextBudget, type Verbosity } from '../ai/settings'
import { estimate, MESSAGE_OVERHEAD, rawMessageTokens, rawTokens, rawToolsTokens } from '../ai/tokens'
import type { AiMessage, AiTool } from '../ai/types'
import type { ChatMessage } from '../types/game'
import type { StoryState } from '../types/story'
import { gameStateText, type MasterStateContext } from './masterState'
import { pricesText, type PriceList } from './prices'
import { TONE_LABELS } from './storyActions'

/** Системный промт ведущего (текст из dm-prompt.md). */
export const DM_PROMPT = dmPrompt.trim()

/** Части запроса в порядке сборки. */
export const PROMPT_PARTS = {
  rules: 'Правила и промт',
  tools: 'Инструменты',
  summary: 'Что было раньше',
  facts: 'Журнал фактов',
  state: 'Состояние игры',
  recent: 'Последние сообщения',
  action: 'Действие игрока',
} as const
export type PromptPartId = keyof typeof PROMPT_PARTS

export interface PromptPart {
  id: PromptPartId
  /** Оценка токенов с поправкой на модель. */
  tokens: number
}

/** Неизменная часть системного промта: правила, эта история, длина ответа. */
export function rulesText(story: StoryState, verbosity: Verbosity, prices?: PriceList): string {
  return [
    DM_PROMPT,
    prices ? pricesText(prices) : '',
    `## Эта история\n«${story.title}». Тон: ${TONE_LABELS[story.tone]} — держи его в описаниях и в поведении НПС.`,
    `## Длина ответа\n${VERBOSITY[verbosity].instruction}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

export const summaryText = (summary: string) => (summary.trim() ? `## Что было раньше (сводка памяти ведущего)\n${summary.trim()}` : '')
export const factsText = (facts: readonly { text: string }[]) =>
  facts.length ? `## Журнал фактов (помни всегда)\n${facts.map((f) => `- ${f.text}`).join('\n')}` : ''

/** Системный промт целиком (без обрезки): правила, сводка, факты, состояние игры. */
export function masterSystemPrompt(story: StoryState, verbosity: Verbosity, ctx: MasterStateContext): string {
  return [rulesText(story, verbosity, ctx.prices), summaryText(story.memory?.summary ?? ''), factsText(story.world.facts), gameStateText(story, ctx)]
    .filter(Boolean)
    .join('\n\n')
}

/** Пометки вопроса и ответа вне игры в запросе к модели. */
export const OOC_QUESTION_MARK = '[Вопрос вне игры]'
export const OOC_ANSWER_MARK = '[Ответ вне игры]'
/** Перемещения героя по карте до реплики игрока (склеенные мелкие). */
export const MOVE_MARK = '[Перемещение на карте]'
/** Значимое перемещение без реплики игрока: ведущий коротко реагирует. */
export const MAP_EVENT_MARK =
  '[Событие на карте — игрок ничего не писал; коротко (1–3 предложения) опиши, что герой видит и как реагирует мир, не решай за героя]'

/** Сообщение ленты для модели: ведущий — assistant (с подсказками, как он их писал), игрок — user, броски — заметки. */
export function chatToAi(story: StoryState, m: ChatMessage): AiMessage {
  if (m.author === 'master') {
    if (m.ooc) return { role: 'assistant', content: `${OOC_ANSWER_MARK} ${m.text}` }
    return { role: 'assistant', content: m.suggestions?.length ? `${m.text}\n\nВарианты: ${m.suggestions.join(' | ')}` : m.text }
  }
  if (m.author === 'player') {
    const multi = story.party.length > 1
    const name = story.party.find((p) => p.heroId === m.heroId)?.character.name ?? 'Игрок'
    const text = multi && m.heroId ? `${name}: ${m.text}` : m.text
    if (m.ooc) return { role: 'user', content: `${OOC_QUESTION_MARK} ${text}` }
    return { role: 'user', content: m.move ? `${MOVE_MARK} ${m.move}\n${text}` : text }
  }
  if (m.mapEvent) return { role: 'user', content: `${MAP_EVENT_MARK} ${m.mapEvent.note}` }
  return { role: 'user', content: `[Код игры] ${m.text}` }
}

export interface MasterRequestOptions {
  verbosity: Verbosity
  context: MasterStateContext
  /** Описания инструментов (идут в запрос отдельным полем, но место в окне занимают). */
  tools?: readonly AiTool[]
  /** Бюджет; без него — без обрезки. */
  budget?: ContextBudget
  /** Поправочный коэффициент токенов для модели (по usage прошлых ответов). */
  factor?: number
  /** Лента берётся до этого сообщения (ход ведущего: лента на начало хода, дальше — `turn`). */
  historyEnd?: number
  /** Сообщения текущего хода (ответы модели с вызовами инструментов и результаты) — никогда не убираются. */
  turn?: AiMessage[]
  /** Служебные сообщения в самом конце (например, просьба переписать ответ). */
  trailing?: AiMessage[]
}

export interface MasterRequestPlan {
  messages: AiMessage[]
  parts: PromptPart[]
  /** Сырая оценка всего запроса (без поправки) — для уточнения коэффициента по usage. */
  rawTokens: number
  /** Оценка с поправкой. */
  estimatedTokens: number
  /** Сколько старых сообщений не вошло в запрос, чтобы не превысить окно контекста. */
  dropped: number
  /** Сколько сообщений ленты («Последние сообщения») после системного — дальше действие игрока и сообщения хода. */
  recentCount: number
  /** Запрос больше целевого размера — пора сжимать память. */
  overBudget: boolean
  /** Предел запроса: окно контекста минус ответ и запас. */
  hardLimit: number | null
}

/** Предел запроса: окно контекста минус ответ модели и запас на неточность оценки. */
export const hardLimitOf = (budget: ContextBudget) =>
  budget.contextWindow - budget.maxResponseTokens - Math.max(256, Math.ceil(budget.contextWindow * 0.05))

/** Собрать запрос ведущему: части в постоянном порядке, оценка размера, при риске превысить окно — обрезка. */
export function buildMasterRequest(story: StoryState, options: MasterRequestOptions): MasterRequestPlan {
  const factor = options.factor ?? 1
  const covered = Math.min(story.memory?.covered ?? 0, story.messages.length)
  const end = Math.max(covered, Math.min(options.historyEnd ?? story.messages.length, story.messages.length))
  const feed = story.messages.slice(covered, end)
  // Действие игрока — последняя реплика игрока в конце ленты (если ход начался с неё).
  const actionMsg = feed.at(-1)?.author === 'player' && !options.turn?.length ? feed.at(-1) : undefined
  let recent = (actionMsg ? feed.slice(0, -1) : feed).map((m) => chatToAi(story, m))
  const action = actionMsg ? [chatToAi(story, actionMsg)] : []
  const tail = [...(options.turn ?? []), ...(options.trailing ?? [])]

  const rules = rulesText(story, options.verbosity, options.context.prices)
  let summary = summaryText(story.memory?.summary ?? '')
  let factList = story.world.facts.map((f) => f.text)
  const state = gameStateText(story, options.context)
  const toolsRaw = rawToolsTokens(options.tools)

  const measure = () => {
    const facts = factsText(factList.map((text) => ({ text })))
    const raw: Record<PromptPartId, number> = {
      rules: rawTokens(rules) + MESSAGE_OVERHEAD,
      tools: toolsRaw,
      summary: rawTokens(summary),
      facts: rawTokens(facts),
      state: rawTokens(state),
      recent: recent.reduce((n, m) => n + rawMessageTokens(m), 0),
      action: [...action, ...tail].reduce((n, m) => n + rawMessageTokens(m), 0),
    }
    const total = Object.values(raw).reduce((a, b) => a + b, 0)
    return { raw, total, facts }
  }

  let m = measure()
  let dropped = 0
  const hardLimit = options.budget ? hardLimitOf(options.budget) : null
  const fits = () => hardLimit === null || estimate(m.total, factor) <= hardLimit
  const overBudget = !!options.budget && estimate(m.total, factor) > options.budget.targetTokens

  // Защита окна: сначала самые старые сообщения, потом начало сводки, потом самые старые факты.
  while (!fits() && recent.length > 0) {
    // Ответ на вызовы инструментов без самих вызовов модель не примет — такие сообщения в ленте не хранятся,
    // поэтому убирать по одному безопасно.
    recent = recent.slice(1)
    dropped++
    m = measure()
  }
  while (!fits() && summary) {
    const lines = summary.split('\n')
    summary = lines.length > 2 ? [lines[0], ...lines.slice(2)].join('\n') : ''
    m = measure()
  }
  while (!fits() && factList.length > 0) {
    factList = factList.slice(1)
    m = measure()
  }

  const system = [rules, summary, m.facts, state].filter(Boolean).join('\n\n')
  const parts = (Object.keys(PROMPT_PARTS) as PromptPartId[]).map((id) => ({ id, tokens: estimate(m.raw[id], factor) }))
  return {
    messages: [{ role: 'system', content: system }, ...recent, ...action, ...tail],
    parts,
    rawTokens: m.total,
    estimatedTokens: estimate(m.total, factor),
    dropped,
    recentCount: recent.length,
    overBudget,
    hardLimit,
  }
}

/** Сообщения для модели без бюджета: системный промт и вся несжатая лента. */
export function masterMessages(story: StoryState, verbosity: Verbosity, ctx: MasterStateContext): AiMessage[] {
  return buildMasterRequest(story, { verbosity, context: ctx }).messages
}
