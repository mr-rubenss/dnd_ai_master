// Тестовый отчёт («Что-то не так»): один markdown-файл, который можно прочитать глазами. Сведения об игре
// и устройстве, описание от игрока, игровое время и локация; последние REPORT_TURNS ходов — реплика игрока, запросы
// ведущему (без системного промта — только его версия; «Состояние игры» — кратко), сырые ответы модели, вызовы
// инструментов с итогом движка (и отказами), броски (скрытые — с пометкой, кто бросал, ушёл ли итог модели);
// ручные броски с панели кубиков — отдельно; последние записи журнала действий, ошибки консоли, настройки ведущего.
// Размер — не больше REPORT_MAX_BYTES (старое обрезается). Ключ API и адрес API (в том числе прокси) в отчёт
// не попадают: адреса в отчёте нет, а весь текст в конце проходит scrubReport (ключ игрока, Bearer, похожие на ключ
// строки, секреты в адресах, свой адрес API).
// Чистые функции.
import { AI_FORMATS, type AiMessage } from '../ai/types'
import { AI_PRESETS, VERBOSITY, contextWindowOf, type AiSettings } from '../ai/settings'
import { formatD20Test } from '../engine/checks'
import { formatRoll } from '../engine/dice'
import type { RollRecord } from '../types/game'
import type { ItemCatalog } from '../types/items'
import type { StoryAction, StoryState } from '../types/story'
import type { ConsoleEntry } from './consoleCapture'
import { briefState, whereAndWhen } from './reportState'
import { applyAction, TONE_LABELS } from './storyActions'
import type { TraceRound, TraceTool, TurnTrace } from './turnTrace'

export const REPORT_TURNS = 15
export const REPORT_ACTIONS = 30
/** Предел размера файла: 200 КБ. */
export const REPORT_MAX_BYTES = 200 * 1024

/** Пределы длины отдельных кусков (длинное обрезается с пометкой). */
export const REPORT_LIMITS = { message: 6000, reasoning: 1500, toolResult: 3000, action: 400, console: 1500 }

export interface DeviceInfo {
  userAgent: string
  platform: string
  language: string
  screen: string
  viewport: string
  pixelRatio: number
  touch: boolean
}

export interface ReportInput {
  /** Когда составлен (мс). */
  now: number
  /** Версия игры (номер и сборка). */
  version: string
  /** Версия системного промта ведущего (хэш dm-prompt.md) и его длина. */
  prompt: { version: string; chars: number }
  device: DeviceInfo
  description: string
  story: StoryState | null
  /** Журнал действий истории целиком (по порядку). */
  actions: StoryAction[]
  /** Записи ходов этой вкладки (src/game/turnTrace.ts). */
  traces: TurnTrace[]
  consoleErrors: ConsoleEntry[]
  settings: AiSettings
  /** Ключ — только чтобы вычистить его из отчёта (в отчёт он не пишется). */
  apiKey: string
  catalog: ItemCatalog
}

// ---------- Общее ----------

/** Короткий хэш строки (FNV-1a, 32 бита) — версия системного промта. */
export function textVersion(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export const byteSize = (text: string) => new TextEncoder().encode(text).length

const pad = (n: number) => String(n).padStart(2, '0')
/** «2026-11-07 14:05:09» по местному времени. */
export function dateTime(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
const clock = (ms: number) => dateTime(ms).slice(11)

/** Имя файла: ai-master-report-2026-11-07-1405.md. */
export function reportFileName(ms: number): string {
  const d = new Date(ms)
  return `ai-master-report-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.md`
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n… [обрезано: ещё ${text.length - max} симв.]` : text
}

/** Блок кода, который не ломается от ``` внутри текста. */
function code(text: string, lang = ''): string {
  const fence = text.includes('```') ? '````' : '```'
  return `${fence}${lang}\n${text}\n${fence}`
}

const quote = (text: string) =>
  text
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n')

// ---------- Ходы ----------

/** Ход по журналу действий: от реплики игрока до следующей. */
export interface TurnSpan {
  /** Номер реплики игрока в истории (с 1). */
  ordinal: number
  actions: StoryAction[]
  player: Extract<StoryAction, { type: 'playerSpoke' }> | null
  /** Состояние на начало хода (null — не удалось восстановить). */
  before: StoryState | null
}

/** Ручной бросок с панели кубиков (у бросков движка id начинается с «roll-»). */
export const isManualRoll = (roll: RollRecord) => roll.manual === true || (!roll.manual && !roll.label && !roll.id.startsWith('roll-'))

/** Разбить журнал действий на ходы (по репликам игрока); перед репликой может стоять просьба об отдыхе. */
export function splitTurns(actions: readonly StoryAction[]): TurnSpan[] {
  const starts: number[] = []
  actions.forEach((a, i) => {
    if (a.type === 'playerSpoke') starts.push(i > 0 && actions[i - 1].type === 'restRequested' ? i - 1 : i)
  })
  const turns: TurnSpan[] = []
  let state: StoryState | null = null
  let broken = false
  let next = 0
  for (let i = 0; i < actions.length; i++) {
    if (next < starts.length && i === starts[next]) {
      const end = next + 1 < starts.length ? starts[next + 1] : actions.length
      const span = actions.slice(i, end)
      turns.push({ ordinal: next + 1, actions: span, player: (span.find((a) => a.type === 'playerSpoke') as TurnSpan['player']) ?? null, before: broken ? null : state })
      next++
    }
    if (!broken) {
      try {
        state = applyAction(state, actions[i])
      } catch {
        broken = true
        state = null
      }
    }
  }
  return turns
}

interface RollLine {
  at: number
  id: string
  label: string
  text: string
  hidden: boolean
  manual: boolean
}

function rollsOf(actions: readonly StoryAction[]): RollLine[] {
  const out: RollLine[] = []
  for (const a of actions) {
    if (a.type === 'diceRolled')
      out.push({ at: a.at, id: a.roll.id, label: a.roll.label ?? 'Бросок', text: formatRoll(a.roll.result), hidden: false, manual: isManualRoll(a.roll) })
    if (a.type === 'checkRolled')
      out.push({
        at: a.at,
        id: a.roll?.id ?? a.messageId,
        label: `${a.check.heroName}: ${a.check.result.label} (${a.check.reason})`,
        text: formatD20Test(a.check.result),
        hidden: Boolean(a.check.hidden),
        manual: false,
      })
  }
  return out
}

/** Ушёл ли итог броска модели: результат вызова инструмента есть в следующем запросе этого хода. */
function rollDelivery(roll: RollLine, traces: TurnTrace[]): string {
  for (const trace of traces) {
    const tool = trace.tools.find((t) => t.rollIds.includes(roll.id))
    if (!tool) continue
    const nextRound = trace.rounds[tool.round + 1]
    const sent = nextRound?.request.messages.some((m) => m.role === 'tool' && m.toolCallId === tool.callId)
    return sent
      ? `да — результат \`${tool.name}\` ушёл модели в запросе ${tool.round + 2}`
      : `нет — после \`${tool.name}\` запросов к модели в этом ходе не было`
  }
  if (traces.length === 0) return 'неизвестно — запросы этого хода не записаны'
  return 'нет — бросок движка не от инструмента (например, отдых): модель видит только итог в листе'
}

function messageText(m: AiMessage): string {
  if (m.role === 'assistant') {
    const calls = (m.toolCalls ?? []).map((c) => `→ ${c.name}(${c.rawArguments})`)
    return [m.content ?? '', ...calls].filter(Boolean).join('\n')
  }
  return m.content
}

function requestBlock(round: TraceRound, index: number, previous: TraceRound | undefined): string {
  const r = round.request
  // Сообщения хода растут от запроса к запросу — показываем только новые (действие игрока со второго запроса
  // уходит в ленту, поэтому сравниваем по содержимому, а не по счёту).
  const seen = new Set((previous?.request.messages ?? []).map((m) => JSON.stringify(m)))
  const fresh = r.messages.filter((m) => !seen.has(JSON.stringify(m)))
  const lines = [
    `#### Запрос ${index + 1} (${clock(r.at)})`,
    `- Системный промт: см. версию в «Сведениях» (${r.systemChars} симв. вместе со сводкой, фактами и состоянием) — не копируется`,
    `- Сводка памяти: ${r.summaryChars} симв.; фактов: ${r.factCount}; последних сообщений ленты: ${r.recentCount}${r.dropped ? ` (не вошло из-за окна: ${r.dropped})` : ''}`,
    `- Инструментов: ${r.toolCount}${r.toolChoice ? `, tool_choice: ${typeof r.toolChoice === 'string' ? r.toolChoice : r.toolChoice.name}` : ''}; max_tokens: ${r.maxTokens ?? '—'}; temperature: ${r.temperature ?? '—'}; оценка размера: ~${r.estimatedTokens} ток.`,
    '',
    '**Состояние (кратко):**',
    code(r.state),
  ]
  if (fresh.length) {
    lines.push('', `**Новые сообщения запроса (${fresh.length}):**`)
    for (const m of fresh) lines.push(`- \`${m.role}${m.role === 'tool' ? ` ${m.toolCallId}` : ''}\``, code(cut(messageText(m), REPORT_LIMITS.message)))
  }
  return lines.join('\n')
}

function responseBlock(round: TraceRound, index: number): string {
  const r = round.response
  if (!r) return `#### Ответ ${index + 1}\nОтвета нет (ошибка или отмена — см. ниже).`
  const usage = r.usage ? `вход ${r.usage.inputTokens}${r.usage.cachedInputTokens != null ? ` (из кэша ${r.usage.cachedInputTokens})` : ''}, выход ${r.usage.outputTokens}` : 'не сообщён'
  const lines = [`#### Ответ ${index + 1} (${clock(r.at)})`, `- finish_reason: ${r.finishReason}; токены: ${usage}`, '', '**Текст модели (как пришёл):**', code(cut(r.text || '(пусто)', REPORT_LIMITS.message))]
  if (r.toolCalls.length) {
    lines.push('', '**Вызовы инструментов в ответе:**')
    for (const c of r.toolCalls) lines.push(`- \`${c.name}\` (${c.id}) ${c.argumentsError ? `— аргументы не разобраны: ${c.argumentsError}` : ''}`, code(cut(c.rawArguments || '{}', REPORT_LIMITS.message), 'json'))
  }
  if (r.reasoning) lines.push('', '<details><summary>«Размышления» модели</summary>', '', code(cut(r.reasoning, REPORT_LIMITS.reasoning)), '', '</details>')
  return lines.join('\n')
}

function toolBlock(tool: TraceTool): string {
  return [`- \`${tool.name}\` (запрос ${tool.round + 1}) — ${tool.ok ? 'принят' : '**ОТКАЗ движка**'}`, code(`аргументы: ${cut(tool.rawArguments || '{}', REPORT_LIMITS.toolResult)}\nрезультат: ${cut(tool.result, REPORT_LIMITS.toolResult)}`)].join('\n')
}

function traceBlock(trace: TurnTrace, n: number, count: number): string {
  const title = trace.kind === 'rewrite' ? '«Переписать ответ»' : count > 1 ? `Запрос к ведущему, попытка ${n}` : 'Запрос к ведущему'
  const lines = [`#### ${title} — начат ${clock(trace.startedAt)}`]
  if (trace.stub) lines.push('Ведущий не настроен — ответила заглушка, запроса к модели не было.')
  trace.rounds.forEach((round, i) => lines.push('', requestBlock(round, i, trace.rounds[i - 1]), '', responseBlock(round, i)))
  if (trace.tools.length) lines.push('', '#### Инструменты и итог движка', ...trace.tools.map(toolBlock))
  if (trace.verification && trace.verification.status !== 'skipped') {
    const v = trace.verification
    lines.push('', `Сверка end_turn: ${v.status}${'problems' in v && v.problems.length ? ` — ${v.problems.join('; ')}` : ''}`)
  }
  if (trace.claims?.length) lines.push('', `Сверка текста с состоянием — ведущего попросили исправить: ${trace.claims.join('; ')}`)
  if (trace.error) lines.push('', `**Ошибка:** ${trace.error}`)
  return lines.join('\n')
}

/** Что попало в ленту за ход (по журналу действий): ответы ведущего, строки изменений, отказы не видны — они в записи хода. */
function feedBlock(span: TurnSpan): string {
  const lines: string[] = []
  for (const a of span.actions) {
    if (a.type === 'masterNarrated') lines.push(`- Ведущий${a.ooc ? ' (вне игры)' : ''}:`, quote(cut(a.text, REPORT_LIMITS.message)), ...(a.suggestions?.length ? [`  Варианты: ${a.suggestions.join(' | ')}`] : []))
    if (a.type === 'masterRewritten') lines.push('- Ответ переписан:', quote(cut(a.text, REPORT_LIMITS.message)))
    if (a.type === 'turnSummarized') lines.push(`- Строка изменений: ${a.changes.map((c) => c.text).join(', ')}`)
  }
  return lines.length ? ['#### В ленте', ...lines].join('\n') : ''
}

function turnBlock(span: TurnSpan, n: number, traces: TurnTrace[]): string {
  const where = span.before ? ` · ${whereAndWhen(span.before)}` : ''
  const p = span.player
  const lines = [`### Ход ${n}${where}`, `_Реплика игрока №${span.ordinal} в истории, ${clock(span.actions[0].at)}_`, '']
  if (span.actions[0].type === 'restRequested') {
    const rest = span.actions[0]
    lines.push(`Игрок попросил отдых: ${rest.kind === 'long' ? 'долгий' : 'короткий'}.`)
  }
  lines.push(`**Игрок${p?.ooc ? ' (вопрос вне игры)' : ''}:**`, quote(p?.text ?? '—'))
  const mine = traces.filter((t) => p && t.playerMessageId === p.messageId)
  if (mine.length === 0) lines.push('', '_Сырой запрос и ответ модели не записаны: запись ведётся только в памяти вкладки (страница перезагружалась или ход был раньше)._')
  mine.forEach((t, i) => lines.push('', traceBlock(t, i + 1, mine.filter((x) => x.kind === 'turn').length)))
  const rolls = rollsOf(span.actions).filter((r) => !r.manual)
  if (rolls.length) {
    lines.push('', '#### Броски')
    for (const r of rolls) lines.push(`- ${clock(r.at)} · бросал: движок${r.hidden ? ' · **СКРЫТЫЙ** (игрок не видит)' : ''} · ${r.label}: ${r.text} · в следующий запрос ведущему: ${rollDelivery(r, mine)}`)
  }
  const feed = feedBlock(span)
  if (feed) lines.push('', feed)
  return lines.join('\n')
}

// ---------- Прочие разделы ----------

function settingsBlock(s: AiSettings, apiKey: string): string {
  const provider = s.provider === 'custom' ? 'Свой' : AI_PRESETS[s.provider].name
  const model = s.provider === 'custom' ? s.model : s.model.trim() || AI_PRESETS[s.provider].model
  return [
    '## Настройки ведущего',
    `- Поставщик: ${provider}; формат: ${AI_FORMATS[s.format] ?? s.format}`,
    `- Модель: ${model || '—'}; модель сжатия: ${s.compactModel.trim() || 'та же'}`,
    `- Длина ответов: ${VERBOSITY[s.verbosity]?.name ?? s.verbosity}; окно контекста: ${contextWindowOf(s)}; целевой размер запроса: ${s.targetTokens}`,
    `- Ключ API: ${apiKey.trim() ? 'задан' : 'не задан'} (сам ключ и адрес API, в том числе прокси, в отчёт не попадают)`,
  ].join('\n')
}

function actionLine(a: StoryAction): string {
  const author = a.author.kind === 'player' ? `игрок (${a.author.heroId})` : { engine: 'движок', master: 'ведущий', system: 'система' }[a.author.kind]
  const { id: _id, storyId: _story, seq: _seq, at: _at, author: _author, type: _type, ...payload } = a
  const body = a.type === 'storyCreated' ? `«${a.seed.title}», отряд: ${a.seed.party.map((m) => m.character.name).join(', ')}` : JSON.stringify(payload)
  return `- #${a.seq} ${clock(a.at)} · ${author} · \`${a.type}\` ${cut(body, REPORT_LIMITS.action)}`
}

function storyBlock(story: StoryState | null, actions: StoryAction[], catalog: ItemCatalog): string {
  if (!story) return '- История: не открыта'
  return [
    `- История: «${story.title}» (${story.id}), тон: ${TONE_LABELS[story.tone]}, ${story.status === 'completed' ? 'завершена' : 'идёт'}, действий в журнале: ${actions.length}`,
    `- Игровое время и локация: ${whereAndWhen(story)}`,
    '',
    '**Сейчас (кратко):**',
    code(briefState(story, catalog)),
  ].join('\n')
}

// ---------- Сборка ----------

interface RenderOptions {
  turns: number
  actions: number
  consoleErrors: number
}

function render(input: ReportInput, opts: RenderOptions, allTurns: TurnSpan[]): string {
  const { device: d } = input
  const turns = allTurns.slice(-opts.turns)
  const cutTurns = Math.min(allTurns.length, REPORT_TURNS) - turns.length
  const description = input.description.trim()
  const sections = [
    '# Тестовый отчёт ИИ-Мастера',
    `Составлен: ${dateTime(input.now)} (местное время)`,
    '',
    '## Что пошло не так',
    description ? quote(description) : '_Игрок не описал._',
    '',
    '## Сведения',
    `- Версия игры: ${input.version}`,
    `- Системный промт ведущего: версия \`${input.prompt.version}\` (${input.prompt.chars} симв.) — в отчёт не копируется`,
    `- Браузер: ${d.userAgent}`,
    `- Устройство: ${d.platform || '—'}; язык: ${d.language}; экран: ${d.screen}; окно: ${d.viewport}; плотность пикселей: ${d.pixelRatio}; сенсорный экран: ${d.touch ? 'да' : 'нет'}`,
    storyBlock(input.story, input.actions, input.catalog),
    '',
    settingsBlock(input.settings, input.apiKey),
    '',
    `## Ходы (последние ${turns.length})`,
    cutTurns > 0 ? `_Старые ходы (${cutTurns}) не вошли: предел размера отчёта ${REPORT_MAX_BYTES / 1024} КБ._` : '',
    turns.length ? '' : '_Ходов ещё не было._',
    ...turns.map((t, i) => `${turnBlock(t, i + 1 + cutTurns, input.traces)}\n`),
  ]
  // Ручные броски — за то же время, что и ходы отчёта.
  const from = turns[0]?.actions[0]?.seq ?? 0
  const manual = rollsOf(input.actions.filter((a) => a.seq >= from)).filter((r) => r.manual)
  sections.push(
    '## Ручные броски с панели кубиков',
    '_Бросал игрок; ведущему эти броски не передаются (их нет ни в ленте, ни в состоянии игры)._',
    ...(manual.length ? manual.map((r) => `- ${clock(r.at)} · ${r.text}`) : ['_Не было._']),
    '',
    `## Журнал действий (последние ${Math.min(opts.actions, input.actions.length)})`,
    ...(input.actions.length ? input.actions.slice(-opts.actions).map(actionLine) : ['_Пусто._']),
    '',
    `## Ошибки консоли (${input.consoleErrors.length})`,
    ...(input.consoleErrors.length
      ? input.consoleErrors.slice(-opts.consoleErrors).map((e) => `- ${clock(e.at)} · ${e.level}\n${code(cut(e.text, REPORT_LIMITS.console))}`)
      : ['_Нет._']),
    '',
  )
  return sections.filter((s, i, all) => !(s === '' && all[i - 1] === '')).join('\n')
}

const HIDDEN_KEY = '[ключ скрыт]'
const HIDDEN_URL = '[адрес скрыт]'

/**
 * Убрать секреты: ключ игрока (и его хвост), «Bearer …», похожие на ключи строки, секреты в адресах
 * (?key=, ?token=), свой адрес API/прокси и его хост. Звёздочки markdown не трогаем (в отличие от redactSecrets из src/ai/errors.ts,
 * который прячет «***…» — маски ключей в ответах поставщика).
 */
export function scrubReport(text: string, apiKey: string, baseUrl = ''): string {
  let out = text
  const url = baseUrl.trim()
  if (url) {
    out = out.split(url).join(HIDDEN_URL)
    try {
      const host = new URL(url).host
      if (host) out = out.split(host).join(HIDDEN_URL)
    } catch {
      // Не адрес — достаточно точного совпадения.
    }
  }
  out = out
    .replace(/Bearer\s+[^\s;,"'`]+/gi, `Bearer ${HIDDEN_KEY}`)
    .replace(/\b(sk|key|api)[-_][A-Za-z0-9_-]{6,}/gi, HIDDEN_KEY)
    .replace(/([?&](?:api[_-]?key|key|token|access_token|auth|secret)=)[^&\s"'`)]+/gi, `$1${HIDDEN_KEY}`)
  // Ключ целиком и его хвост (как в redactSecrets) — даже если он не похож на ключ по виду.
  const key = apiKey.trim()
  if (key.length >= 4) {
    out = out.split(key).join(HIDDEN_KEY)
    for (const len of [8, 6, 4]) if (key.length > len) out = out.split(key.slice(-len)).join(HIDDEN_KEY)
  }
  return out
}

/** Собрать отчёт: markdown не больше REPORT_MAX_BYTES, без ключа. */
export function buildTestReport(input: ReportInput): string {
  const turns = splitTurns(input.actions)
  const opts: RenderOptions = { turns: REPORT_TURNS, actions: REPORT_ACTIONS, consoleErrors: input.consoleErrors.length }
  let text = scrubReport(render(input, opts, turns), input.apiKey, input.settings.baseUrl)
  // Не влезает — сначала самые старые ходы, потом журнал действий и ошибки консоли, в крайнем случае — обрезка.
  while (byteSize(text) > REPORT_MAX_BYTES && opts.turns > 1) {
    opts.turns--
    text = scrubReport(render(input, opts, turns), input.apiKey, input.settings.baseUrl)
  }
  while (byteSize(text) > REPORT_MAX_BYTES && (opts.actions > 5 || opts.consoleErrors > 5)) {
    opts.actions = Math.max(5, Math.floor(opts.actions / 2))
    opts.consoleErrors = Math.max(5, Math.floor(opts.consoleErrors / 2))
    text = scrubReport(render(input, opts, turns), input.apiKey, input.settings.baseUrl)
  }
  if (byteSize(text) > REPORT_MAX_BYTES) {
    const note = '\n\n… [отчёт обрезан до 200 КБ]\n'
    let chars = REPORT_MAX_BYTES - byteSize(note)
    while (byteSize(text.slice(0, chars)) > REPORT_MAX_BYTES - byteSize(note)) chars = Math.floor(chars * 0.95)
    text = text.slice(0, chars) + note
  }
  return text
}
