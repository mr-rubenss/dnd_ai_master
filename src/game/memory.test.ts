// Память ведущего: сборка запроса по частям, бюджет и окно контекста, сжатие (с подменённым ответом ИИ).
import { describe, expect, it } from 'vitest'
import compactPromptText from '../ai/compact-prompt.md?raw'
import { AiError } from '../ai/errors'
import type { ContextBudget } from '../ai/settings'
import { aiResponse } from '../ai/testing'
import type { AiMaster, AiRequest, AiResponse } from '../ai/types'
import { itemCatalog, rulesData } from '../data'
import adventureJson from '../data/adventures/drunken-griffin.json'
import fighterJson from '../data/characters/fighter-ratibor.json'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import type { ActionAuthor, StoryEvent, StoryState } from '../types/story'
import { parseAdventure } from './adventure'
import { parseCharacterSheet } from './character'
import { lostNames, namesIn } from './facts'
import { parseLocation } from './location'
import { buildMasterRequest, DM_PROMPT, hardLimitOf, PROMPT_PARTS } from './masterPrompt'
import { MASTER_TOOLS } from './masterTools'
import { runMasterTurn } from './masterTurn'
import {
  COMPACT_RULES,
  compactionNeeded,
  compactMemory,
  compactTask,
  KEEP_RECENT,
  nextRequestPlan,
  SUMMARY_SOFT_CHARS,
  TASKS,
  writeEpilogueSummary,
} from './memory'
import { applyAction, checkAction, makeAction, MASTER, newStorySeed, player } from './storyActions'

const context = { catalog: itemCatalog, rules: rulesData }
const location = parseLocation(drunkenGriffinJson)
const locations = { [location.id]: location }
const adventure = parseAdventure(adventureJson, locations)
const ratibor = parseCharacterSheet(fighterJson, itemCatalog)

const LINE = 'Гуннар ставит кружку на стойку, оглядывается на дверь и негромко говорит о человеке в капюшоне у камина. '

/** История с длинной лентой: ход за ходом игрок и ведущий (последнее — реплика игрока). */
function longStory(turns: number, extra: [StoryEvent, ActionAuthor][] = []): StoryState {
  let state = newStorySeed({ id: 's1', title: 'Тень над трактом', tone: 'detective', adventure, locations, party: [ratibor], now: 1 })
  const events: [StoryEvent, ActionAuthor][] = [...extra]
  for (let i = 0; i < turns; i++) {
    events.push([{ type: 'playerSpoke', heroId: 'ratibor', messageId: `p${i}`, text: `Ход ${i}: спрашиваю про капюшон.` }, player('ratibor')])
    events.push([{ type: 'masterNarrated', messageId: `m${i}`, text: `Ответ ${i}. ${LINE.repeat(2)}` }, MASTER])
  }
  events.push([{ type: 'playerSpoke', heroId: 'ratibor', messageId: 'last', text: 'Подсаживаюсь к человеку в капюшоне.' }, player('ratibor')])
  events.forEach(([event, author], i) => (state = applyAction(state, makeAction('s1', i + 1, event, author, 2 + i, `a${i}`))))
  return state
}

/** Среда памяти: история в памяти, действия проверяются checkAction и применяются по одному. */
function runtimeFor(initial: StoryState) {
  let state = initial
  let seq = 1000
  let n = 0
  const committed: string[] = []
  return {
    current: () => state,
    committed,
    runtime: {
      getStory: () => state,
      commit: (event: StoryEvent, author: ActionAuthor) => {
        const action = makeAction(state.id, seq++, event, author, 5, `x${seq}`)
        const reason = checkAction(state, action, { catalog: itemCatalog })
        if (reason) return reason
        state = applyAction(state, action)
        committed.push(event.type)
        return null
      },
      tools: { catalog: itemCatalog, now: () => 9, newId: () => `n${++n}` },
      now: () => 9,
    },
  }
}

/** ИИ-заглушка по содержимому запроса (а не по очереди): сжатие, пересжатие, факты, итог, ход. */
function scriptedMaster(handle: (req: AiRequest, index: number) => AiResponse | Promise<AiResponse>) {
  const requests: AiRequest[] = []
  const master: AiMaster = {
    format: 'openai-chat',
    async complete(req) {
      requests.push(req)
      return handle(req, requests.length - 1)
    },
    diagnose: async () => ({ url: '', request: '', status: null, statusText: '', headers: [], lines: [] }),
  }
  return { master, requests }
}

const system = (req: AiRequest) => req.messages[0].content ?? ''
const isTask = (req: AiRequest, task: string) => system(req).includes(`## Задача: ${task}`)
const call = (name: string, args: unknown, id = name) => ({ id, name, arguments: args, rawArguments: JSON.stringify(args) })

/** Модель сжатия: в первом раунде фрагмента — факт инструментом, потом строки сводки. */
const compactor = () =>
  scriptedMaster((req) => {
    if (isTask(req, TASKS.compact)) {
      const fragment = req.messages[1].content ?? ''
      const first = fragment.match(/Ход (\d+)/)?.[1] ?? '?'
      if (req.toolChoice === 'auto' && !req.messages.some((m) => m.role === 'tool'))
        return aiResponse({ toolCalls: [call('note_fact', { text: `Человек в капюшоне — у камина; ход ${first}` }, `f${first}`)], finishReason: 'tool_calls' })
      return aiResponse({ text: `- Герой расспрашивал Гуннара о человеке в капюшоне (ходы с ${first})\n- Гуннар насторожен` })
    }
    if (isTask(req, TASKS.resummarize)) return aiResponse({ text: '- Давнее: герой пришёл в «Пьяный грифон»\n- Недавнее: следит за человеком в капюшоне' })
    throw new Error('неожиданный запрос')
  })

/** Бюджет: окно и целевой размер отсчитываются от размера запроса без ленты (правила, инструменты, состояние). */
function budgetAround(story: StoryState, extraTarget: number, window = 64_000): ContextBudget {
  const base = buildMasterRequest({ ...story, messages: [] }, { verbosity: 'normal', context, tools: MASTER_TOOLS }).estimatedTokens
  return { contextWindow: window, targetTokens: base + extraTarget, maxResponseTokens: 800 }
}

describe('запрос ведущему: части в постоянном порядке', () => {
  it('правила → (инструменты) → что было раньше → журнал фактов → состояние → последние сообщения → действие игрока', () => {
    let story = longStory(3, [[{ type: 'factRecorded', fact: { id: 'f1', text: 'Тобиас — вор бочек; должен гильдии 30 зм', at: 1 } }, MASTER]])
    story = applyAction(story, makeAction('s1', 99, { type: 'memoryCompacted', summary: '- Герой пришёл в таверну', covered: 2, at: 5 }, MASTER, 5, 'mc'))
    const plan = buildMasterRequest(story, { verbosity: 'normal', context, tools: MASTER_TOOLS })
    const text = plan.messages[0].content!
    const order = [DM_PROMPT.slice(0, 40), '## Что было раньше', '- Герой пришёл в таверну', '## Журнал фактов', '- Тобиас — вор бочек', '## Состояние игры']
    const positions = order.map((s) => text.indexOf(s))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(plan.parts.map((p) => p.id)).toEqual(Object.keys(PROMPT_PARTS))
    // Лента — после сводки (первые 2 сообщения сжаты), действие игрока — последним.
    expect(plan.messages[1].content).toBe(story.messages[2].text)
    expect(plan.messages.slice(1).some((m) => m.content === story.messages[1].text)).toBe(false)
    expect(plan.messages.at(-1)).toEqual({ role: 'user', content: 'Подсаживаюсь к человеку в капюшоне.' })
    expect(plan.parts.find((p) => p.id === 'tools')!.tokens).toBeGreaterThan(0)
    expect(plan.parts.find((p) => p.id === 'action')!.tokens).toBeGreaterThan(0)
  })

  it('неизменная часть — первая: у двух соседних запросов общий префикс системного промта', () => {
    const a = buildMasterRequest(longStory(2), { verbosity: 'normal', context }).messages[0].content!
    const b = buildMasterRequest(longStory(3), { verbosity: 'normal', context }).messages[0].content!
    expect(a.slice(0, DM_PROMPT.length)).toBe(b.slice(0, DM_PROMPT.length))
  })
})

describe('бюджет и окно контекста', () => {
  it('сжатие нужно, только когда запрос больше целевого размера', () => {
    const story = longStory(20)
    expect(compactionNeeded(story, { verbosity: 'normal', context, budget: budgetAround(story, 100_000) })).toBe(false)
    expect(compactionNeeded(story, { verbosity: 'normal', context, budget: budgetAround(story, 1_000) })).toBe(true)
    // Короткая история — сжимать нечего, даже если бюджет мал.
    const short = longStory(3)
    expect(compactionNeeded(short, { verbosity: 'normal', context, budget: budgetAround(short, 10) })).toBe(false)
  })

  it('запрос никогда не превышает окно: старые сообщения убираются, действие игрока остаётся', () => {
    const story = longStory(150)
    for (const extra of [500, 3_000, 10_000]) {
      const base = budgetAround(story, 0).targetTokens
      const budget = { contextWindow: base + 800 + extra + 1_000, targetTokens: base, maxResponseTokens: 800 }
      const plan = buildMasterRequest(story, { verbosity: 'normal', context, tools: MASTER_TOOLS, budget })
      expect(plan.estimatedTokens).toBeLessThanOrEqual(hardLimitOf(budget))
      expect(plan.estimatedTokens + budget.maxResponseTokens).toBeLessThan(budget.contextWindow)
      expect(plan.dropped).toBeGreaterThan(0)
      expect(plan.messages.at(-1)).toEqual({ role: 'user', content: 'Подсаживаюсь к человеку в капюшоне.' })
      // Убираются самые старые: последний ответ ведущего на месте.
      expect(plan.messages.at(-2)?.content).toContain('Ответ 149.')
    }
  })

  it('в крайнем случае обрезаются начало сводки и самые старые факты — но окно не превышается', () => {
    const facts: [StoryEvent, ActionAuthor][] = Array.from({ length: 50 }, (_, i) => [
      { type: 'factRecorded', fact: { id: `f${i}`, text: `Факт номер ${i}: житель Брам${i} должен герою ${i} зм`, at: 1 } },
      MASTER,
    ])
    let story = longStory(5, facts)
    const summary = Array.from({ length: 60 }, (_, i) => `- Событие ${i}: герой обошёл ${i} домов`).join('\n')
    story = applyAction(story, makeAction('s1', 999, { type: 'memoryCompacted', summary, covered: 4, at: 5 }, MASTER, 5, 'mc'))
    const base = budgetAround({ ...story, world: { ...story.world, facts: [] }, memory: undefined }, 0).targetTokens
    const budget = { contextWindow: base + 800 + 1_000, targetTokens: base, maxResponseTokens: 800 }
    const plan = buildMasterRequest(story, { verbosity: 'normal', context, tools: MASTER_TOOLS, budget })
    expect(plan.estimatedTokens).toBeLessThanOrEqual(hardLimitOf(budget))
    // Самые свежие факты остаются дольше всего.
    expect(plan.messages[0].content).toContain('Факт номер 49:')
    const text = plan.messages[0].content!
    expect(text).not.toContain('Событие 0:')
    expect(text).not.toContain('Факт номер 0:')
    expect(plan.messages.at(-1)?.content).toBe('Подсаживаюсь к человеку в капюшоне.')
  })

  it('поправочный коэффициент увеличивает оценку', () => {
    const story = longStory(2)
    const one = buildMasterRequest(story, { verbosity: 'normal', context }).estimatedTokens
    const more = buildMasterRequest(story, { verbosity: 'normal', context, factor: 1.5 }).estimatedTokens
    expect(more).toBeGreaterThan(one * 1.4)
  })
})

describe('сжатие памяти (подменённый ответ ИИ)', () => {
  it('при превышении бюджета: сначала факты, потом сводка; последние сообщения и журнал фактов не теряются', async () => {
    const story = longStory(30, [[{ type: 'factRecorded', fact: { id: 'f-old', text: 'Тобиас — вор бочек; должен гильдии 30 зм', at: 1 } }, MASTER]])
    const budget = budgetAround(story, 1_500)
    const options = { verbosity: 'normal' as const, context, budget }
    expect(compactionNeeded(story, options)).toBe(true)
    const env = runtimeFor(story)
    const { master, requests } = compactor()
    const reports: string[] = []
    const result = await compactMemory(master, env.runtime, { ...options, onRequest: (r) => reports.push(r.purpose) })
    const after = env.current()

    // Факты — до сводки (модель проверяет, не потеряно ли важное).
    expect(env.committed.indexOf('factRecorded')).toBeLessThan(env.committed.indexOf('memoryCompacted'))
    expect(requests[0].tools?.map((t) => t.name)).toEqual(['note_fact'])
    expect(system(requests[0])).toContain(COMPACT_RULES)
    expect(requests[0].messages[1].content).toContain('Игрок (Ратибор): Ход 0: спрашиваю про капюшон.')

    // Последние KEEP_RECENT сообщений не сжаты, лента в истории целиком.
    expect(after.messages).toHaveLength(story.messages.length)
    expect(after.memory!.covered).toBeLessThanOrEqual(story.messages.length - KEEP_RECENT)
    expect(result.compacted).toBe(after.memory!.covered)
    expect(after.memory!.summary).toContain('- Герой расспрашивал Гуннара о человеке в капюшоне (ходы с 0)')

    // Следующий запрос: сводка и все факты, последние сообщения как есть, в бюджете.
    const plan = nextRequestPlan(after, options)
    const text = plan.messages[0].content!
    expect(text).toContain('## Что было раньше')
    expect(text).toContain('- Тобиас — вор бочек; должен гильдии 30 зм')
    expect(text).toContain('- Человек в капюшоне — у камина; ход 0')
    for (const m of story.messages.slice(-KEEP_RECENT)) expect(plan.messages.some((x) => x.content?.startsWith(m.text))).toBe(true)
    expect(plan.messages.some((x) => x.content === 'Ход 0: спрашиваю про капюшон.')).toBe(false)
    expect(plan.overBudget).toBe(false)
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore)
    expect(reports.every((r) => r === 'compact')).toBe(true)
    expect(compactionNeeded(after, options)).toBe(false)
  })

  it('принудительное сжатие (после «слишком длинный контекст») оставляет меньше сообщений даже в бюджете', async () => {
    const story = longStory(12)
    const env = runtimeFor(story)
    await compactMemory(compactor().master, env.runtime, { verbosity: 'normal', context, budget: budgetAround(story, 100_000), force: true })
    expect(env.current().memory!.covered).toBe(story.messages.length - 4)
  })

  it('ошибка сжатия не ломает ход: история не меняется, ход уходит с обрезанным запросом', async () => {
    const story = longStory(150)
    const env = runtimeFor(story)
    const failing = scriptedMaster(() => {
      throw new AiError('server')
    })
    const base = budgetAround(story, 0).targetTokens
    const budget = { contextWindow: base + 800 + 4_000, targetTokens: base + 1_000, maxResponseTokens: 800 }
    await expect(compactMemory(failing.master, env.runtime, { verbosity: 'normal', context, budget })).rejects.toThrow(AiError)
    expect(env.current()).toBe(story)

    const turn = scriptedMaster(() => aiResponse({ text: 'Человек в капюшоне поднимает взгляд.' }))
    const sizes: number[] = []
    const result = await runMasterTurn(turn.master, story, {
      verbosity: 'normal',
      context,
      budget,
      runtime: { getStory: env.current, commit: env.runtime.commit, tools: env.runtime.tools },
      onRequest: (r) => sizes.push(r.estimatedTokens),
    })
    expect(result.text).toBe('Человек в капюшоне поднимает взгляд.')
    expect(sizes[0]).toBeLessThanOrEqual(hardLimitOf(budget))
    expect(turn.requests[0].messages.at(-1)?.content).toBe('Подсаживаюсь к человеку в капюшоне.')
  })

  it('ошибка на втором фрагменте: уже сжатое остаётся', async () => {
    const story = longStory(60)
    const env = runtimeFor(story)
    let fragments = 0
    const flaky = scriptedMaster((req) => {
      if (req.toolChoice === 'auto' && ++fragments > 1) throw new AiError('server')
      return aiResponse({ text: '- Герой расспрашивал Гуннара' })
    })
    await expect(compactMemory(flaky.master, env.runtime, { verbosity: 'normal', context, budget: budgetAround(story, 500) })).rejects.toThrow()
    expect(env.current().memory?.covered).toBeGreaterThan(0)
  })

  it('сводка разрослась — пересжимается (давнее короче, недавнее подробнее); лента не трогается', async () => {
    const big = Array.from({ length: 120 }, (_, i) => `- Событие ${i}: герой обошёл дом ${i} и расспросил жильцов`).join('\n')
    expect(big.length).toBeGreaterThan(SUMMARY_SOFT_CHARS)
    let story = longStory(3)
    story = applyAction(story, makeAction('s1', 999, { type: 'memoryCompacted', summary: big, covered: 2, at: 5 }, MASTER, 5, 'mc'))
    const options = { verbosity: 'normal' as const, context, budget: budgetAround(story, 100_000) }
    expect(compactionNeeded(story, options)).toBe(true)
    const env = runtimeFor(story)
    const { master, requests } = compactor()
    const result = await compactMemory(master, env.runtime, options)
    expect(result.resummarized).toBe(true)
    expect(system(requests[0])).toContain('давние события — короче')
    expect(env.current().memory).toMatchObject({ summary: '- Давнее: герой пришёл в «Пьяный грифон»\n- Недавнее: следит за человеком в капюшоне', covered: 2 })
  })

  it('журнал фактов разросся — объединение; потерянное имя движок не принимает, вторая попытка', async () => {
    const facts: [StoryEvent, ActionAuthor][] = Array.from({ length: 62 }, (_, i) => [
      { type: 'factRecorded', fact: { id: `f${i}`, text: i % 2 ? `Тобиас — должен гильдии ${i} зм` : `Лиара — ищет брата, попытка ${i}`, at: 1 } },
      MASTER,
    ])
    const story = longStory(2, [...facts, [{ type: 'factRecorded', fact: { id: 'fb', text: 'Брам — охраняет погреб «Серая крыса»', at: 1 } }, MASTER]])
    const env = runtimeFor(story)
    const answers = ['- Тобиас — должен гильдии 61 зм\n- Лиара — ищет брата', '- Тобиас — должен гильдии 61 зм\n- Лиара — ищет брата\n- Брам — охраняет погреб «Серая крыса»']
    const merger = scriptedMaster(() => aiResponse({ text: answers.shift()! }))
    const result = await compactMemory(merger.master, env.runtime, { verbosity: 'normal', context, budget: budgetAround(story, 100_000) })
    expect(result.factsMerged).toBe(true)
    expect(merger.requests[1].messages.at(-1)?.content).toBe('Движок не принял: При объединении потеряны имена: Серая крыса, Брам. Исправь список.')
    expect(env.current().world.facts.map((f) => f.text)).toEqual([
      'Тобиас — должен гильдии 61 зм',
      'Лиара — ищет брата',
      'Брам — охраняет погреб «Серая крыса»',
    ])
  })
})

describe('журнал фактов и сводка в действиях истории', () => {
  it('имена в фактах: «Имя — …», имена внутри строки, названия в кавычках; окончания не считаются потерей', () => {
    expect(namesIn(['Тобиас — вор; знает Лиару', 'Должен гильдии «Чёрный ключ» 30 зм']).sort()).toEqual(['Лиару', 'Тобиас', 'Чёрный ключ'])
    expect(lostNames(['Брам — охранник'], ['Лиара — ищет брата'])).toEqual(['Брам'])
    expect(lostNames(['Тобиас — вор'], ['Вор Тобиаса поймали'])).toEqual([])
    expect(lostNames(['Тобиас — вор', 'Брам — охранник'], ['Тобиас — вор'])).toEqual(['Брам'])
  })

  it('memoryCompacted: только ведущий, сводка — от начала ленты и не больше, чем в ней есть', () => {
    const story = longStory(3)
    const check = (event: StoryEvent, author: ActionAuthor = MASTER) => checkAction(story, makeAction('s1', 50, event, author, 5, 'c'), { catalog: itemCatalog })
    expect(check({ type: 'memoryCompacted', summary: '- x', covered: 2, at: 1 })).toBeNull()
    expect(check({ type: 'memoryCompacted', summary: '- x', covered: 99, at: 1 })).toBe('Сводка должна охватывать начало ленты и не больше, чем в ней есть.')
    expect(check({ type: 'memoryCompacted', summary: ' ', covered: 2, at: 1 })).toBe('Пустая сводка.')
    expect(check({ type: 'memoryCompacted', summary: 'x'.repeat(9_000), covered: 2, at: 1 })).toBe('Сводка — не длиннее 8000 символов.')
    expect(check({ type: 'memoryCompacted', summary: '- x', covered: 2, at: 1 }, player('ratibor'))).toBe('Сжимает память только ведущий.')
  })
})

describe('инструкции памяти', () => {
  it('compact-prompt.md: что сохранить, что выбросить, краткость, все задачи', () => {
    for (const s of ['Текущую ситуацию и цель героя', 'Обещания, сделки, долги, угрозы, нерешённые загадки', 'Отношение НПС к герою', 'Тон истории'])
      expect(compactPromptText).toContain(s)
    expect(compactPromptText).toContain('хиты, инвентарь, деньги, положение на карте')
    expect(compactPromptText).toContain('Один факт — одна строка до ~20 слов')
    expect(compactPromptText).toContain('«Тобиас — вор бочек; знает, что герой его подозревает; должен гильдии 30 зм»')
    for (const task of Object.values(TASKS)) expect(compactTask(task)).toMatch(new RegExp(`^## Задача: ${task}`))
    expect(compactTask(TASKS.resummarize, { lines: 25 })).toContain('не больше 25 строк')
    expect(COMPACT_RULES).not.toContain('## Задача')
  })

  it('правило краткости — и в dm-prompt.md, и в описании note_fact', () => {
    expect(DM_PROMPT).toContain('одна строка до ~20 слов')
    expect(MASTER_TOOLS.find((t) => t.name === 'note_fact')!.description).toContain('одна строка до ~20 слов')
  })
})

describe('итог истории пишет ИИ', () => {
  it('по сводке, журналу фактов и последним сообщениям', async () => {
    let story = longStory(3, [[{ type: 'factRecorded', fact: { id: 'f1', text: 'Тобиас — вор бочек', at: 1 } }, MASTER]])
    story = applyAction(story, makeAction('s1', 99, { type: 'memoryCompacted', summary: '- Герой пришёл в таверну', covered: 2, at: 5 }, MASTER, 5, 'mc'))
    const { master, requests } = scriptedMaster(() => aiResponse({ text: 'Ратибор пришёл в «Пьяный грифон».\nОн разоблачил Тобиаса. ' }))
    expect(await writeEpilogueSummary(master, story, {})).toBe('Ратибор пришёл в «Пьяный грифон». Он разоблачил Тобиаса.')
    expect(system(requests[0])).toContain('## Задача: итог истории')
    const content = requests[0].messages[1].content!
    expect(content).toContain('- Герой пришёл в таверну')
    expect(content).toContain('- Тобиас — вор бочек')
    expect(content).toContain('Игрок (Ратибор): Подсаживаюсь к человеку в капюшоне.')
  })
})
