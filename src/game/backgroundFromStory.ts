// «По моей истории»: ИИ читает «Историю героя» и предлагает механику предыстории по шаблону 2024 — через инструмент
// с JSON-схемой. Предложение проверяет та же функция шаблона (validateBackgroundTemplate); при ошибках модель получает
// их списком и исправляет (несколько попыток). Дописанные ИИ детали истории — отдельно: их принимает или отклоняет игрок.
// Инструкция модели — src/ai/background-prompt.md. Работает через общий интерфейс src/ai/ (любой поставщик).
import backgroundPrompt from '../ai/background-prompt.md?raw'
import { AiError } from '../ai/errors'
import type { AiMaster, AiMessage, AiProgress, AiTool, AiToolCall } from '../ai/types'
import { ABILITIES, ABILITY_NAMES, type Ability } from '../engine/abilities'
import { SKILL_DEFINITIONS, SKILLS, type SkillId } from '../engine/skills'
import type { RulesData } from '../types/rules'
import {
  BACKGROUND_TEMPLATE,
  buildCustomBackground,
  formatGold,
  purchasableItems,
  validateBackgroundTemplate,
  type CustomBackgroundInput,
} from './backgroundTemplate'
import { isObject } from './validation'

export const BACKGROUND_PROMPT = backgroundPrompt.trim()
export const PROPOSE_TOOL = 'propose_background'
/** Сколько раз модель может исправить предложение по ошибкам шаблона. */
export const MAX_PROPOSAL_ATTEMPTS = 3
export const MIN_BACKSTORY_LENGTH = 15
export const MAX_EXPLANATION_LENGTH = 200
export const MAX_DETAILS = 3
export const MAX_DETAIL_LENGTH = 200

/** За что отвечает каждое объяснение. */
export const EXPLANATION_KEYS = ['name', 'abilities', 'skills', 'tool', 'feat', 'equipment'] as const
export type ExplanationKey = (typeof EXPLANATION_KEYS)[number]
export const EXPLANATION_LABELS: Record<ExplanationKey, string> = {
  name: 'Название',
  abilities: 'Характеристики',
  skills: 'Навыки',
  tool: 'Инструмент',
  feat: 'Черта',
  equipment: 'Снаряжение',
}

export interface ProposalDetail {
  text: string
  /** pending — ждёт решения игрока; accepted — дописана в «Историю героя»; rejected — отклонена. */
  status: 'pending' | 'accepted' | 'rejected'
}

/** Предложение ИИ: поля своей предыстории, объяснения выбора, дописанные детали. */
export interface BackgroundProposal {
  input: CustomBackgroundInput
  explanations: Record<ExplanationKey, string>
  details: ProposalDetail[]
}

/** Проблема с «Историей героя» для варианта «По моей истории» или null. */
export function backstoryProblem(text: string): string | null {
  const t = text.trim()
  if (!t) return 'Напишите «Историю героя» — по ней ИИ подберёт предысторию.'
  if (t.length < MIN_BACKSTORY_LENGTH) return 'История слишком короткая: добавьте хотя бы пару деталей о прошлом героя.'
  return null
}

const toolIds = (data: RulesData) => Object.values(data.catalog).filter((i) => i.toolKind !== undefined).map((i) => i.id)
const originFeats = (data: RulesData) => Object.values(data.feats).filter((f) => f.category === 'origin')
const str = (description: string, maxLength?: number) => ({ type: 'string', description, ...(maxLength ? { maxLength } : {}) })

/** Описание инструмента с JSON-схемой: варианты — только из данных игры. */
export function proposeTool(data: RulesData): AiTool {
  const explanation = str(`Почему так — одно предложение по словам игрока, до ${MAX_EXPLANATION_LENGTH} символов.`, MAX_EXPLANATION_LENGTH)
  return {
    name: PROPOSE_TOOL,
    description: 'Предложить механику предыстории по шаблону 2024 с объяснением каждого выбора и (если нужно) 2–3 дописанными деталями истории.',
    parameters: {
      type: 'object',
      properties: {
        name: str('Название предыстории, 1–3 слова.', BACKGROUND_TEMPLATE.maxNameLength),
        description: str('Кем был герой — одно-два предложения.', BACKGROUND_TEMPLATE.maxDescriptionLength),
        abilities: { type: 'array', items: { type: 'string', enum: [...ABILITIES] }, minItems: 3, maxItems: 3, uniqueItems: true },
        skills: { type: 'array', items: { type: 'string', enum: [...SKILLS] }, minItems: 2, maxItems: 2, uniqueItems: true },
        tool: { type: 'string', enum: toolIds(data), description: 'Инструмент (id).' },
        feat: { type: 'string', enum: originFeats(data).map((f) => f.id), description: 'Черта происхождения (id).' },
        equipment: {
          type: 'array',
          description: `Снаряжение на сумму не больше ${BACKGROUND_TEMPLATE.budget} зм; остаток станет золотом.`,
          items: {
            type: 'object',
            properties: {
              item: { type: 'string', description: 'id предмета из списка «Предметы для снаряжения».' },
              quantity: { type: 'integer', minimum: 1 },
            },
            required: ['item', 'quantity'],
          },
        },
        explanations: {
          type: 'object',
          properties: Object.fromEntries(EXPLANATION_KEYS.map((k) => [k, explanation])),
          required: [...EXPLANATION_KEYS],
        },
        extra_details: {
          type: 'array',
          description: 'Только если в истории пропущено важное: 2–3 короткие детали (откуда родом, что умеет). Иначе пусто.',
          items: str('Одна деталь — одно предложение.', MAX_DETAIL_LENGTH),
          maxItems: MAX_DETAILS,
        },
      },
      required: ['name', 'abilities', 'skills', 'tool', 'feat', 'equipment', 'explanations'],
    },
  }
}

const shorten = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : text)

/** Предметы, которые можно взять на 50 зм предыстории (без доспехов и того, что дороже бюджета). */
export const backgroundShopItems = (data: RulesData) =>
  purchasableItems(data.catalog).filter((i) => i.cost! <= BACKGROUND_TEMPLATE.budget && i.category !== 'armor')

/** Справочник для модели: id и названия того, из чего можно выбирать. */
export function choicesText(data: RulesData): string {
  const tools = toolIds(data).map((id) => `${id} — ${data.catalog[id].name}`)
  const feats = originFeats(data).map((f) => `${f.id} — ${f.name}: ${shorten(f.description, 90)}`)
  // Только то, что влезает в бюджет 50 зм (доспехи и дорогое — мимо), коротко: «id — название, цена».
  const items = backgroundShopItems(data)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    .map((i) => `${i.id} — ${i.name}, ${formatGold(i.cost!)}`)
  return [
    `## Характеристики\n${ABILITIES.map((a) => `${a} — ${ABILITY_NAMES[a]}`).join('\n')}`,
    `## Навыки\n${SKILLS.map((s) => `${s} — ${SKILL_DEFINITIONS[s].name}`).join('\n')}`,
    `## Инструменты\n${tools.join('\n')}`,
    `## Черты происхождения\n${feats.join('\n')}`,
    `## Предметы для снаряжения (id — название, цена в зм)\n${items.join('\n')}`,
  ].join('\n\n')
}

/** Разбор и проверка предложения: то же правило шаблона, что у своей предыстории игрока. */
export function parseProposal(raw: unknown, data: RulesData): { proposal: BackgroundProposal } | { problems: string[] } {
  if (!isObject(raw)) return { problems: ['Аргументы — не объект.'] }
  const problems: string[] = []
  const list = (v: unknown) => (Array.isArray(v) ? v : [])
  const equipment = list(raw.equipment)
  const items = equipment.map((line) => ({
    itemId: isObject(line) && typeof line.item === 'string' ? line.item : '',
    quantity: isObject(line) && typeof line.quantity === 'number' ? line.quantity : 0,
  }))
  const input: CustomBackgroundInput = {
    name: typeof raw.name === 'string' ? raw.name.trim() : '',
    description: typeof raw.description === 'string' ? raw.description.trim() : '',
    abilities: list(raw.abilities) as Ability[],
    skills: list(raw.skills) as SkillId[],
    tool: typeof raw.tool === 'string' ? raw.tool : null,
    feat: typeof raw.feat === 'string' ? raw.feat : null,
    items,
  }
  if (items.some((i) => !i.itemId)) problems.push('Снаряжение: у каждой строки нужны item и quantity.')
  // Те же правила шаблона, что и для своей предыстории игрока.
  problems.push(...validateBackgroundTemplate(buildCustomBackground(input, data.catalog), { feats: data.feats, catalog: data.catalog }))

  const rawExplanations = isObject(raw.explanations) ? raw.explanations : {}
  const explanations = {} as Record<ExplanationKey, string>
  for (const key of EXPLANATION_KEYS) {
    const text = typeof rawExplanations[key] === 'string' ? (rawExplanations[key] as string).trim() : ''
    if (!text) problems.push(`Нет объяснения: ${EXPLANATION_LABELS[key]}.`)
    else if (text.length > MAX_EXPLANATION_LENGTH) problems.push(`Объяснение «${EXPLANATION_LABELS[key]}» — не длиннее ${MAX_EXPLANATION_LENGTH} символов.`)
    explanations[key] = text
  }
  const details = list(raw.extra_details).filter((d): d is string => typeof d === 'string' && d.trim() !== '')
  if (details.length > MAX_DETAILS) problems.push(`Дописанных деталей — не больше ${MAX_DETAILS}.`)
  if (details.some((d) => d.length > MAX_DETAIL_LENGTH)) problems.push(`Каждая деталь — не длиннее ${MAX_DETAIL_LENGTH} символов.`)

  if (problems.length) return { problems: [...new Set(problems)] }
  return { proposal: { input, explanations, details: details.map((text) => ({ text: text.trim(), status: 'pending' })) } }
}

/** Аргументы из ответа модели: вызов инструмента или (если сервис не умеет вызывать) JSON в тексте. */
function argumentsOf(call: AiToolCall | undefined, text: string): { args: unknown; error?: string } {
  if (call) return call.argumentsError ? { args: null, error: call.argumentsError } : { args: call.arguments }
  const json = text.match(/\{[\s\S]*\}/)?.[0]
  if (!json) return { args: null, error: `Ответь вызовом инструмента ${PROPOSE_TOOL}.` }
  try {
    return { args: JSON.parse(json) }
  } catch {
    return { args: null, error: `Ответ — некорректный JSON. Ответь вызовом инструмента ${PROPOSE_TOOL}.` }
  }
}

/** Этапы подбора — для индикатора: отправка, модель пишет, проверка по правилам, исправление (попытка n из N). */
export type SuggestStage = 'sending' | 'reading' | 'checking' | 'fixing'

export interface SuggestOptions {
  /** Прошлое предложение — для «Предложить иначе». */
  previous?: BackgroundProposal | null
  signal?: AbortSignal
  onStage?: (stage: SuggestStage, attempt: number) => void
  /** Куски ответа по мере генерации (для индикатора и показа названия до конца ответа). */
  onProgress?: (progress: AiProgress) => void
}

/** Название предыстории из недописанных аргументов (поток) — чтобы показать его до конца ответа. */
export const partialName = (toolArgs: string) => toolArgs.match(/"name"\s*:\s*"((?:[^"\\]|\\.)*)/)?.[1] ?? null

/** Предложить предысторию по «Истории героя». Ошибка — AiError с понятным текстом (в т. ч. какие правила нарушены). */
export async function suggestBackground(master: AiMaster, backstory: string, data: RulesData, options: SuggestOptions = {}): Promise<BackgroundProposal> {
  const problem = backstoryProblem(backstory)
  if (problem) throw new AiError('bad-request', { message: problem })
  const tool = proposeTool(data)
  const previous = options.previous
    ? `\n\n## Прошлое предложение (игрок просит предложить иначе — выбери заметно другое)\n${JSON.stringify({
        name: options.previous.input.name,
        abilities: options.previous.input.abilities,
        skills: options.previous.input.skills,
        tool: options.previous.input.tool,
        feat: options.previous.input.feat,
      })}`
    : ''
  const messages: AiMessage[] = [
    { role: 'system', content: `${BACKGROUND_PROMPT}\n\n${choicesText(data)}` },
    { role: 'user', content: `## История героя (слова игрока)\n${backstory.trim()}${previous}` },
  ]
  let last: string[] = []
  for (let attempt = 0; attempt < MAX_PROPOSAL_ATTEMPTS; attempt++) {
    options.onStage?.(attempt === 0 ? 'sending' : 'fixing', attempt + 1)
    let reading = false
    const response = await master.complete({
      onProgress: (p) => {
        if (!reading && attempt === 0) options.onStage?.('reading', 1)
        reading = true
        options.onProgress?.(p)
      },
      messages,
      tools: [tool],
      toolChoice: { name: PROPOSE_TOOL },
      maxTokens: 1500,
      temperature: options.previous ? 1 : 0.7,
      signal: options.signal,
    })
    options.onStage?.('checking', attempt + 1)
    const call = response.toolCalls.find((c) => c.name === PROPOSE_TOOL) ?? response.toolCalls[0]
    const { args, error } = argumentsOf(call, response.text)
    const parsed = error ? { problems: [error] } : parseProposal(args, data)
    if ('proposal' in parsed) return parsed.proposal
    last = parsed.problems
    // Ошибки шаблона — модели, чтобы исправила.
    if (call) {
      messages.push({ role: 'assistant', content: response.text || null, toolCalls: [call] })
      messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify({ ok: false, errors: parsed.problems }) })
    } else {
      messages.push({ role: 'assistant', content: response.text || '' })
      messages.push({ role: 'user', content: `Код игры не принял ответ: ${parsed.problems.join(' ')}` })
    }
  }
  throw new AiError('bad-response', { message: `ИИ не смог предложить предысторию по шаблону: ${last.join(' ')} Попробуйте ещё раз или заполните вручную.` })
}
