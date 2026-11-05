// Память ведущего: сжатие старой части ленты в сводку «Что было раньше», объединение разросшегося журнала фактов
// и черновик итога истории. Инструкция для модели — src/ai/compact-prompt.md. Работает через общий интерфейс
// src/ai/ (любой поставщик), обычно в фоне после ответа ведущего; изменения — только действиями истории
// (memoryCompacted, factRecorded/factUpdated через note_fact, factsMerged), которые проверяет движок.
// Полная лента остаётся в истории — сжимается только то, что уходит в запрос.
import compactPrompt from '../ai/compact-prompt.md?raw'
import { AiError } from '../ai/errors'
import type { ContextBudget, Verbosity } from '../ai/settings'
import { estimate, rawMessageTokens, rawTokens } from '../ai/tokens'
import type { AiMaster, AiMessage } from '../ai/types'
import type { ChatMessage } from '../types/game'
import type { ActionAuthor, StoryEvent, StoryState, WorldFact } from '../types/story'
import { factsTooLarge } from './facts'
import { buildMasterRequest, factsText, summaryText } from './masterPrompt'
import type { MasterStateContext } from './masterState'
import { executeTool, MASTER_TOOLS, type ToolContext } from './masterTools'
import type { RequestReport } from './masterTurn'
import { MASTER, MAX_EPILOGUE_LENGTH, MAX_SUMMARY_CHARS, TONE_LABELS } from './storyActions'

/** Сколько последних сообщений ленты всегда идут в запрос как есть (не сжимаются). */
export const KEEP_RECENT = 10
/** После ошибки «слишком длинный контекст» — сжимаем сильнее. */
export const KEEP_RECENT_FORCED = 4
/** Сводка длиннее — пересжимаем её (давнее короче, недавнее подробнее). */
export const SUMMARY_SOFT_CHARS = 3_500
export const RESUMMARY_LINES = 25
export const MERGED_FACTS_COUNT = 40
/** Сколько фрагментов сжать за один раз (каждый — отдельный запрос). */
const MAX_CHUNKS = 4
const COMPACT_MAX_TOKENS = 1_500

// ---------- Инструкция из compact-prompt.md ----------

const PROMPT = compactPrompt.trim()
const TASK_HEADING = '## Задача: '

/** Общие правила сжатия (всё до первой «## Задача: …»). */
export const COMPACT_RULES = PROMPT.slice(0, PROMPT.indexOf(TASK_HEADING)).trim()

/** Текст задачи из compact-prompt.md по названию («сжать фрагмент ленты» и т. д.). */
export function compactTask(name: string, vars: Record<string, string | number> = {}): string {
  const start = PROMPT.indexOf(`${TASK_HEADING}${name}`)
  if (start < 0) throw new Error(`В compact-prompt.md нет задачи «${name}».`)
  const next = PROMPT.indexOf(TASK_HEADING, start + TASK_HEADING.length)
  const body = PROMPT.slice(start, next < 0 ? undefined : next).trim()
  return body.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? `{${key}}`))
}

export const TASKS = {
  compact: 'сжать фрагмент ленты',
  resummarize: 'пересжать сводку',
  mergeFacts: 'объединить факты',
  epilogue: 'итог истории',
} as const

// ---------- Что и когда сжимать ----------

/** Лента для модели сжатия: кто что сказал, одной строкой на сообщение. */
export function transcript(story: StoryState, messages: readonly ChatMessage[]): string {
  const names = new Map(story.party.map((m) => [m.heroId, m.character.name]))
  return messages
    .map((m) => {
      if (m.author === 'master') return `Ведущий: ${m.text}`
      if (m.author === 'player') return `Игрок${m.heroId && names.get(m.heroId) ? ` (${names.get(m.heroId)})` : ''}: ${m.text}`
      return `Код игры: ${m.text}`
    })
    .join('\n')
}

export interface MemoryOptions {
  verbosity: Verbosity
  context: MasterStateContext
  budget: ContextBudget
  /** Поправочный коэффициент токенов. */
  factor?: () => number
}

/** Сколько первых сообщений ленты можно сжать, оставив последние `keep`. */
export const compactableUntil = (story: StoryState, keep = KEEP_RECENT) => Math.max(story.memory?.covered ?? 0, story.messages.length - keep)

/** Размер следующего запроса ведущего (с инструментами) — для решения, пора ли сжимать. */
export function nextRequestPlan(story: StoryState, options: MemoryOptions) {
  return buildMasterRequest(story, {
    verbosity: options.verbosity,
    context: options.context,
    tools: MASTER_TOOLS,
    budget: options.budget,
    factor: options.factor?.(),
  })
}

/** Пора ли сжимать: запрос больше целевого размера (и есть что сжать), разрослись сводка или журнал фактов. */
export function compactionNeeded(story: StoryState, options: MemoryOptions): boolean {
  if (story.status !== 'active') return false
  const covered = story.memory?.covered ?? 0
  if (nextRequestPlan(story, options).overBudget && compactableUntil(story) > covered) return true
  return (story.memory?.summary.length ?? 0) > SUMMARY_SOFT_CHARS || factsTooLarge(story.world.facts)
}

// ---------- Сжатие ----------

export interface CompactRuntime {
  /** Текущее состояние истории (после уже записанных действий). */
  getStory: () => StoryState
  /** Записать действие; причина отказа или null. */
  commit: (event: StoryEvent, author: ActionAuthor) => Promise<string | null> | string | null
  /** Для note_fact: время и id. */
  tools: ToolContext
  now: () => number
}

export interface CompactOptions extends MemoryOptions {
  /** Сжать, даже если запрос в бюджете (после ошибки «слишком длинный контекст»): оставить меньше сообщений. */
  force?: boolean
  signal?: AbortSignal
  onRequest?: (report: RequestReport) => void
  /** Поправочный коэффициент модели сжатия — для оценки её собственных запросов (`factor` — у модели ведущего). */
  requestFactor?: () => number
}

export interface CompactReport {
  /** Сколько сообщений ленты вошло в сводку за этот раз. */
  compacted: number
  /** Размер запроса ведущего до и после (оценка токенов). */
  tokensBefore: number
  tokensAfter: number
  summaryChars: number
  factsAdded: number
  resummarized: boolean
  factsMerged: boolean
}

const NOTE_FACT = MASTER_TOOLS.filter((t) => t.name === 'note_fact')

/** Строки ответа модели → строки сводки/фактов: «- » в начале, без пустых и заголовков. */
export function noteLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim().replace(/^([-*•–—]|\d+[.)])\s*/, '').trim())
    .filter((l) => l && !l.startsWith('#'))
}

const asSummary = (lines: string[]) => lines.map((l) => `- ${l}`).join('\n')

/** Если сводка всё-таки длиннее предела движка — убираем самые давние строки. */
export function clampSummary(summary: string, max = MAX_SUMMARY_CHARS): string {
  const lines = summary.split('\n')
  while (lines.join('\n').length > max && lines.length > 1) lines.shift()
  return lines.join('\n').slice(-max)
}

const requestFactor = (options: CompactOptions) => options.requestFactor?.() ?? options.factor?.() ?? 1

function report(purpose: RequestReport['purpose'], messages: AiMessage[], factor: number, usage: RequestReport['usage'], labels: [string, string][]) {
  const raw = messages.reduce((n, m) => n + rawMessageTokens(m), 0)
  return {
    purpose,
    parts: labels.map(([label, text]) => ({ label, tokens: estimate(rawTokens(text), factor) })),
    rawTokens: raw,
    estimatedTokens: estimate(raw, factor),
    dropped: 0,
    usage,
  }
}

/**
 * Сжать память: старая часть ленты (кроме последних KEEP_RECENT сообщений) — в сводку, по фрагментам, пока следующий
 * запрос не войдёт в бюджет; перед каждым фрагментом модель записывает недостающие факты (note_fact). Затем —
 * пересжатие разросшейся сводки и объединение разросшегося журнала фактов. Ошибки модели — исключения AiError;
 * то, что уже записано, остаётся (сжатие продолжится в следующий раз).
 */
export async function compactMemory(master: AiMaster, runtime: CompactRuntime, options: CompactOptions): Promise<CompactReport> {
  const factor = () => options.factor?.() ?? 1
  const keep = options.force ? KEEP_RECENT_FORCED : KEEP_RECENT
  const before = nextRequestPlan(runtime.getStory(), options).estimatedTokens
  const result: CompactReport = { compacted: 0, tokensBefore: before, tokensAfter: before, summaryChars: 0, factsAdded: 0, resummarized: false, factsMerged: false }
  // Фрагмент для одного запроса сжатия — не больше половины целевого размера.
  const chunkLimit = Math.max(1_500, Math.floor(options.budget.targetTokens / 2))

  for (let i = 0; i < MAX_CHUNKS; i++) {
    const story = runtime.getStory()
    const from = story.memory?.covered ?? 0
    const until = compactableUntil(story, keep)
    if (until <= from) break
    if (i > 0 && !nextRequestPlan(story, options).overBudget) break
    if (i === 0 && !options.force && !nextRequestPlan(story, options).overBudget) break
    // Сколько сообщений влезает во фрагмент.
    let end = from
    let size = 0
    while (end < until) {
      size += estimate(rawTokens(story.messages[end].text) + 8, factor())
      if (end > from && size > chunkLimit) break
      end++
    }
    const { added } = await compactChunk(master, runtime, story, from, end, options)
    result.compacted += end - from
    result.factsAdded += added
  }

  if ((runtime.getStory().memory?.summary.length ?? 0) > SUMMARY_SOFT_CHARS) result.resummarized = await resummarize(master, runtime, options)
  if (factsTooLarge(runtime.getStory().world.facts)) result.factsMerged = await mergeFacts(master, runtime, options)

  const after = runtime.getStory()
  result.summaryChars = after.memory?.summary.length ?? 0
  result.tokensAfter = nextRequestPlan(after, options).estimatedTokens
  return result
}

/** Один фрагмент: факты (note_fact) → новые строки сводки → действие memoryCompacted. */
async function compactChunk(master: AiMaster, runtime: CompactRuntime, story: StoryState, from: number, end: number, options: CompactOptions) {
  const summary = story.memory?.summary ?? ''
  const system = [
    COMPACT_RULES,
    compactTask(TASKS.compact),
    `## Эта история\n«${story.title}». Тон: ${TONE_LABELS[story.tone]}.`,
    summaryText(summary) || '## Что было раньше\n(пока пусто)',
    factsText(runtime.getStory().world.facts) || '## Журнал фактов\n(пока пусто)',
  ].join('\n\n')
  const fragment = `## Фрагмент ленты для сжатия\n${transcript(story, story.messages.slice(from, end))}`
  const messages: AiMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: fragment },
  ]
  const labels: [string, string][] = [
    ['rules', COMPACT_RULES],
    ['summary', summary],
    ['facts', factsText(story.world.facts)],
    ['fragment', fragment],
  ]
  let added = 0
  let text = ''
  for (let round = 0; round < 2; round++) {
    const response = await master.complete({
      messages,
      tools: NOTE_FACT,
      toolChoice: round === 0 ? 'auto' : 'none',
      maxTokens: COMPACT_MAX_TOKENS,
      temperature: 0.2,
      signal: options.signal,
    })
    options.onRequest?.(report('compact', messages, requestFactor(options), response.usage, labels))
    text = response.text
    if (round === 1 || response.toolCalls.length === 0) break
    messages.push({ role: 'assistant', content: response.text || null, toolCalls: response.toolCalls })
    for (const call of response.toolCalls) {
      let outcome =
        call.name === 'note_fact'
          ? executeTool(runtime.getStory(), call, runtime.tools)
          : { ok: false, result: { ok: false, error: 'Сейчас доступен только note_fact.' }, events: [] }
      for (const { event, author } of outcome.events) {
        const reason = await runtime.commit(event, author)
        if (reason) {
          outcome = { ok: false, result: { ok: false, error: reason }, events: [] }
          break
        }
        if (event.type === 'factRecorded') added++
      }
      messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(outcome.result) })
    }
  }
  const lines = noteLines(text)
  if (lines.length === 0) throw new AiError('bad-response', { message: 'Сжатие памяти: модель не прислала сводку.' })
  const next = clampSummary([summary.trim(), asSummary(lines)].filter(Boolean).join('\n'))
  const reason = await runtime.commit({ type: 'memoryCompacted', summary: next, covered: end, at: runtime.now() }, MASTER)
  if (reason) throw new AiError('bad-response', { message: `Сжатие памяти отклонено: ${reason}` })
  return { added }
}

/** Пересжать разросшуюся сводку: давнее — короче, недавнее — подробнее. */
async function resummarize(master: AiMaster, runtime: CompactRuntime, options: CompactOptions): Promise<boolean> {
  const story = runtime.getStory()
  const summary = story.memory?.summary ?? ''
  const messages: AiMessage[] = [
    { role: 'system', content: [COMPACT_RULES, compactTask(TASKS.resummarize, { lines: RESUMMARY_LINES })].join('\n\n') },
    { role: 'user', content: `${factsText(story.world.facts)}\n\n## Сводка\n${summary}`.trim() },
  ]
  const response = await master.complete({ messages, maxTokens: COMPACT_MAX_TOKENS, temperature: 0.2, signal: options.signal })
  options.onRequest?.(report('resummarize', messages, requestFactor(options), response.usage, [['summary', summary]]))
  const lines = noteLines(response.text)
  const next = clampSummary(asSummary(lines))
  // Пересжатая сводка должна стать короче; иначе оставляем старую (обрезанную до предела движка).
  if (lines.length === 0 || next.length >= summary.length) return false
  const reason = await runtime.commit({ type: 'memoryCompacted', summary: next, covered: story.memory?.covered ?? 0, at: runtime.now() }, MASTER)
  return !reason
}

/** Объединить разросшийся журнал фактов; движок не примет объединение, если потеряно хоть одно имя. */
async function mergeFacts(master: AiMaster, runtime: CompactRuntime, options: CompactOptions): Promise<boolean> {
  const story = runtime.getStory()
  const facts = story.world.facts
  const messages: AiMessage[] = [
    { role: 'system', content: [COMPACT_RULES, compactTask(TASKS.mergeFacts, { count: MERGED_FACTS_COUNT })].join('\n\n') },
    { role: 'user', content: factsText(facts) },
  ]
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await master.complete({ messages, maxTokens: COMPACT_MAX_TOKENS, temperature: 0.2, signal: options.signal })
    options.onRequest?.(report('merge-facts', messages, requestFactor(options), response.usage, [['facts', factsText(facts)]]))
    const lines = noteLines(response.text)
    if (lines.length === 0) return false
    const byText = new Map(facts.map((f) => [f.text.trim(), f]))
    const used = new Set<string>()
    const merged: WorldFact[] = lines.map((text) => {
      const old = byText.get(text)
      if (old && !used.has(old.id)) {
        used.add(old.id)
        return old
      }
      return { id: `fact-${runtime.tools.newId()}`, text, at: runtime.now() }
    })
    const reason = await runtime.commit({ type: 'factsMerged', facts: merged }, MASTER)
    if (!reason) return true
    // Движок отказал (например, потеряны имена) — одна попытка исправить.
    messages.push({ role: 'assistant', content: response.text }, { role: 'user', content: `Движок не принял: ${reason} Исправь список.` })
  }
  return false
}

// ---------- Итог истории ----------

/** Черновик краткого содержания для «Летописи»: ИИ пишет по сводке, журналу фактов и последним сообщениям. */
export async function writeEpilogueSummary(
  master: AiMaster,
  story: StoryState,
  options: { signal?: AbortSignal; factor?: () => number; onRequest?: (report: RequestReport) => void },
): Promise<string> {
  const recent = story.messages.slice(Math.max(story.memory?.covered ?? 0, story.messages.length - KEEP_RECENT))
  const heroes = story.party.map((m) => `${m.character.name}${m.fallen ? ' (погиб)' : ''}`).join(', ')
  const quests = story.world.quests.map((q) => `- ${q.title} — ${q.status === 'completed' ? 'выполнено' : q.status === 'failed' ? 'провалено' : 'не завершено'}`)
  const content = [
    `## История\n«${story.title}». Тон: ${TONE_LABELS[story.tone]}. Герои: ${heroes}.`,
    summaryText(story.memory?.summary ?? ''),
    factsText(story.world.facts),
    quests.length ? `## Задания\n${quests.join('\n')}` : '',
    recent.length ? `## Последние сообщения\n${transcript(story, recent)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  const messages: AiMessage[] = [
    { role: 'system', content: [COMPACT_RULES, compactTask(TASKS.epilogue)].join('\n\n') },
    { role: 'user', content },
  ]
  const response = await master.complete({ messages, maxTokens: 700, temperature: 0.5, signal: options.signal })
  options.onRequest?.(report('epilogue', messages, options.factor?.() ?? 1, response.usage, [['story', content]]))
  const text = response.text.trim().replace(/\s+/g, ' ')
  if (!text) throw new AiError('bad-response', { message: 'Ведущий не прислал итог истории.' })
  return text.length > MAX_EPILOGUE_LENGTH ? `${text.slice(0, MAX_EPILOGUE_LENGTH - 1).replace(/\s+\S*$/, '')}…` : text
}
