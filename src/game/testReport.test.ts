import { describe, expect, it } from 'vitest'
import { aiResponse, fakeMaster } from '../ai/testing'
import { DEFAULT_AI_SETTINGS, type AiSettings } from '../ai/settings'
import { itemCatalog, priceList, rulesData } from '../data'
import { roll } from '../engine/dice'
import adventureJson from '../data/adventures/drunken-griffin.json'
import fighterJson from '../data/characters/fighter-ratibor.json'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import type { ActionAuthor, StoryAction, StoryEvent, StoryState } from '../types/story'
import { parseAdventure } from './adventure'
import { parseCharacterSheet } from './character'
import { createConsoleCapture, CONSOLE_LIMIT } from './consoleCapture'
import { parseLocation } from './location'
import { DM_PROMPT } from './masterPrompt'
import { runMasterTurn } from './masterTurn'
import { applyAction, checkAction, ENGINE, makeAction, MASTER, newStorySeed, player, SYSTEM } from './storyActions'
import { buildTestReport, byteSize, isManualRoll, reportFileName, REPORT_MAX_BYTES, splitTurns, textVersion, type ReportInput } from './testReport'
import { createTraceStore, type TraceStore } from './turnTrace'

const location = parseLocation(drunkenGriffinJson)
const locations = { [location.id]: location }
const adventure = parseAdventure(adventureJson, locations)
const ratibor = parseCharacterSheet(fighterJson, itemCatalog)
const context = { catalog: itemCatalog, rules: rulesData, prices: priceList }

/** История с настоящим журналом действий: каждое изменение — проверенное действие. */
function game() {
  const seed = newStorySeed({ id: 's1', title: 'Тень над трактом', tone: 'detective', adventure, locations, party: [ratibor], now: 1 })
  const actions: StoryAction[] = []
  let state: StoryState | null = null
  let n = 0
  const commit = (event: StoryEvent, author: ActionAuthor): string | null => {
    const action = makeAction('s1', actions.length, event, author, 1000 + actions.length * 1000, `a${actions.length}`)
    const reason = checkAction(state, action, { catalog: itemCatalog, rules: rulesData })
    if (reason) return reason
    state = applyAction(state, action)
    actions.push(action)
    return null
  }
  commit({ type: 'storyCreated', seed }, SYSTEM)
  const traces: TraceStore = createTraceStore(() => 5000)
  const say = (text: string, id = `p${++n}`) => commit({ type: 'playerSpoke', heroId: 'ratibor', messageId: id, text }, player('ratibor'))
  /** Ход ведущего с записью для отчёта. */
  const turn = async (steps: Parameters<typeof fakeMaster>[0], rolls: number[] = []) => {
    const recorder = traces.start(state!, 'turn', itemCatalog)
    const { master } = fakeMaster(steps)
    const result = await runMasterTurn(master, state!, {
      verbosity: 'normal',
      context,
      trace: recorder.hooks,
      runtime: {
        getStory: () => state!,
        commit,
        tools: { ...context, rng: () => rolls.shift() ?? 0.5, now: () => 7, newId: () => `t${++n}` },
        onTool: recorder.tool,
      },
    })
    if (result.text) commit({ type: 'masterNarrated', messageId: `m${++n}`, text: result.text }, MASTER)
    recorder.finish(result.verification)
    return result
  }
  return { commit, say, turn, traces, actions, state: () => state! }
}

const call = (name: string, args: unknown, id = name) => ({ id, name, arguments: args, rawArguments: JSON.stringify(args) })
const endTurn = (id = 'end') => call('end_turn', { changes: [] }, id)

const device = { userAgent: 'Mozilla/5.0 (Test)', platform: 'Linux', language: 'ru-RU', screen: '1440×900', viewport: '1440×900', pixelRatio: 1, touch: false }

function input(g: ReturnType<typeof game>, extra: Partial<ReportInput> = {}): ReportInput {
  return {
    now: Date.UTC(2026, 10, 7, 12, 0),
    version: '0.0.0 (abc1234)',
    prompt: { version: textVersion(DM_PROMPT), chars: DM_PROMPT.length },
    device,
    description: 'Ведущий забыл про скрытую проверку.',
    story: g.state(),
    actions: g.actions,
    traces: g.traces.get(),
    consoleErrors: [],
    settings: DEFAULT_AI_SETTINGS,
    apiKey: '',
    catalog: itemCatalog,
    ...extra,
  }
}

/** Ход: скрытая проверка + отказ движка (денег не хватает) → результаты модели → рассказ и end_turn. */
async function playHiddenCheckTurn(g: ReturnType<typeof game>) {
  g.say('Осматриваюсь: нет ли за мной слежки?')
  await g.turn(
    [
      () =>
        aiResponse({
          text: 'Ты окидываешь зал взглядом.',
          toolCalls: [call('request_check', { skill: 'perception', dc: 14, reason: 'вор крадётся следом', hidden: true }, 'c1'), call('change_gold', { amount: -1000, reason: 'взятка' }, 'c2')],
          finishReason: 'tool_calls',
          usage: { inputTokens: 900, outputTokens: 40, totalTokens: 940, cachedInputTokens: 800 },
        }),
      () => aiResponse({ text: 'В углу шевельнулась тень.', toolCalls: [endTurn()] }),
    ],
    [0.7],
  )
}

describe('тестовый отчёт: ход по разделам', () => {
  it('реплика, запросы без системного промта, сырые ответы, инструменты с отказом, скрытый бросок и куда ушёл итог', async () => {
    const g = game()
    await playHiddenCheckTurn(g)
    const report = buildTestReport(input(g))

    expect(report).toContain('# Тестовый отчёт ИИ-Мастера')
    expect(report).toContain('## Что пошло не так\n> Ведущий забыл про скрытую проверку.')
    expect(report).toContain('- Версия игры: 0.0.0 (abc1234)')
    expect(report).toContain(`- Системный промт ведущего: версия \`${textVersion(DM_PROMPT)}\``)
    expect(report).toContain('- Браузер: Mozilla/5.0 (Test)')
    expect(report).toContain('- Игровое время и локация: День 1, 19:00 (вечер) · «')
    // Системный промт не повторяется — только его версия и размер.
    expect(report).not.toContain(DM_PROMPT.slice(0, 200))
    expect(report).not.toContain('## Живые НПС')
    expect(report).not.toContain('## Состояние игры')

    expect(report).toContain('### Ход 1 · День 1, 19:00 (вечер)')
    expect(report).toContain('**Игрок:**\n> Осматриваюсь: нет ли за мной слежки?')
    expect(report).toContain('#### Запрос 1')
    expect(report).toContain('**Состояние (кратко):**')
    expect(report).toMatch(/Ратибор \(Воин 1 ур\.\): хиты \d+\/\d+, КД \d+/)
    expect(report).toContain('#### Ответ 1')
    expect(report).toContain('Ты окидываешь зал взглядом.')
    expect(report).toContain('токены: вход 900 (из кэша 800), выход 40')
    expect(report).toContain('"hidden":true')
    // Второй запрос: только новые сообщения — ответ модели с вызовами и результаты инструментов.
    expect(report).toContain('#### Запрос 2')
    expect(report).toContain('**Новые сообщения запроса (3):**\n- `assistant`')
    expect(report).toContain('→ request_check({"skill":"perception"')
    expect(report).toContain('`tool c1`')
    expect(report).toContain('#### Ответ 2')
    expect(report).toContain('В углу шевельнулась тень.')
    // Инструменты: принят и отказ движка с причиной.
    expect(report).toContain('- `request_check` (запрос 1) — принят')
    expect(report).toContain('- `change_gold` (запрос 1) — **ОТКАЗ движка**')
    expect(report).toContain('Денег не хватает')
    expect(report).toContain('Сверка end_turn: ok')
    // Бросок: скрытый, движок, итог ушёл модели во втором запросе.
    expect(report).toMatch(/бросал: движок · \*\*СКРЫТЫЙ\*\* \(игрок не видит\) · Ратибор: .*Внимательность.* · в следующий запрос ведущему: да — результат `request_check` ушёл модели в запросе 2/)
    expect(report).toContain('#### В ленте\n- Ведущий:\n> Ты окидываешь зал взглядом.')
  })

  it('итог инструмента не ушёл модели, если ход закончился в том же ответе', async () => {
    const g = game()
    g.say('Пью эль.')
    await g.turn([() => aiResponse({ text: 'Эль горчит.', toolCalls: [call('request_check', { ability: 'con', dc: 10, reason: 'крепкий эль' }, 'c1'), endTurn()] })])
    expect(buildTestReport(input(g))).toContain('в следующий запрос ведущему: нет — после `request_check` запросов к модели в этом ходе не было')
  })

  it('ручные броски с панели кубиков — отдельным разделом, бросал игрок, ведущему не передаются', async () => {
    const g = game()
    await playHiddenCheckTurn(g)
    expect(g.commit({ type: 'diceRolled', roll: { id: 'tray-1', timestamp: 9, result: roll('1d6', { rng: () => 0.5 }), manual: true } }, ENGINE)).toBeNull()
    const report = buildTestReport(input(g))
    const section = report.slice(report.indexOf('## Ручные броски с панели кубиков'))
    expect(section).toContain('Бросал игрок; ведущему эти броски не передаются')
    expect(section).toContain('1к6: [4] = 4')
    // В бросках хода ручного нет.
    expect(report.slice(0, report.indexOf('## Ручные броски')).match(/1к6/g)).toBeNull()
  })

  it('без записи хода (страница перезагружалась) — только журнал действий и пометка', async () => {
    const g = game()
    await playHiddenCheckTurn(g)
    const report = buildTestReport(input(g, { traces: [] }))
    expect(report).toContain('_Сырой запрос и ответ модели не записаны')
    expect(report).toContain('в следующий запрос ведущему: неизвестно')
    expect(report).toContain('#### В ленте')
  })

  it('журнал действий — последние 30, настройки ведущего — модель без адреса, ошибки консоли', async () => {
    const g = game()
    for (let i = 0; i < 40; i++) g.say(`Реплика ${i}`)
    const report = buildTestReport(input(g, { consoleErrors: [{ at: 1, level: 'error', text: 'TypeError: x is undefined' }] }))
    const log = report.slice(report.indexOf('## Журнал действий (последние 30)'))
    expect(log.match(/^- #\d+ /gm)).toHaveLength(30)
    expect(log).toContain('`playerSpoke`')
    expect(log).toContain('Реплика 39')
    expect(log).not.toContain('Реплика 9"')
    expect(report).toContain('- Поставщик: DeepSeek; формат: OpenAI Chat Completions')
    expect(report).toContain('- Модель: deepseek-chat; модель сжатия: та же')
    expect(report).not.toContain('api.deepseek.com')
    expect(report).toContain('## Ошибки консоли (1)')
    expect(report).toContain('TypeError: x is undefined')
  })

  it('последние 15 ходов, нумерация «Ход 1…»', async () => {
    const g = game()
    for (let i = 1; i <= 20; i++) g.say(`Шаг ${i}`)
    const report = buildTestReport(input(g))
    expect(report).toContain('## Ходы (последние 15)')
    expect(report.match(/^### Ход \d+/gm)).toHaveLength(15)
    expect(report).toContain('### Ход 1 ·')
    expect(report).toContain('### Ход 15 ·')
    expect(report).toContain('_Реплика игрока №6 в истории')
    expect(report).toContain('> Шаг 20')
    expect(report).not.toContain('> Шаг 5\n')
  })
})

describe('тестовый отчёт: размер', () => {
  it('не больше 200 КБ: старые ходы обрезаются, последние и разделы остаются', async () => {
    const g = game()
    const huge = 'Очень длинное описание таверны. '.repeat(400)
    for (let i = 1; i <= 15; i++) {
      g.say(`Ход ${i}: ${huge.slice(0, 3000)}`)
      await g.turn([() => aiResponse({ text: `Ответ ${i}. ${huge}`, toolCalls: [endTurn()], reasoning: huge })])
    }
    const report = buildTestReport(input(g, { consoleErrors: Array.from({ length: 50 }, (_, i) => ({ at: i, level: 'warn' as const, text: huge.slice(0, 1500) })) }))
    expect(byteSize(report)).toBeLessThanOrEqual(REPORT_MAX_BYTES)
    expect(report).toContain('не вошли: предел размера отчёта 200 КБ')
    expect(report).toContain('Ответ 15.')
    expect(report).toContain('## Журнал действий')
    expect(report).toContain('## Ошибки консоли')
  })
})

describe('тестовый отчёт: ключ и секреты в отчёт не попадают', () => {
  const KEY = 'sk-test-SECRET1234567890abcdef'
  const PROXY = 'https://my-proxy.example.org/v1?token=hush-hush-777'
  const custom: AiSettings = { ...DEFAULT_AI_SETTINGS, provider: 'custom', baseUrl: PROXY, model: 'my-model' }

  it('ключ, его хвост, Bearer и адрес прокси вычищены отовсюду: описание, ход, ответ модели, инструменты, консоль', async () => {
    const g = game()
    g.say(`Мой ключ ${KEY}, запомни`)
    await g.turn([
      () => aiResponse({ text: `Повторяю ключ: ${KEY}`, toolCalls: [call('note_fact', { text: `Ключ игрока ${KEY}` }, 'c1')], reasoning: `Authorization: Bearer ${KEY}` }),
      () => aiResponse({ text: 'Ладно.', toolCalls: [endTurn()] }),
    ])
    const report = buildTestReport(
      input(g, {
        description: `Вот ключ: ${KEY}`,
        settings: custom,
        apiKey: KEY,
        consoleErrors: [{ at: 1, level: 'error', text: `fetch failed: Authorization: Bearer ${KEY} at ${PROXY}` }],
      }),
    )
    expect(report).not.toContain(KEY)
    expect(report).not.toContain(KEY.slice(-8))
    expect(report).not.toContain('SECRET')
    expect(report).not.toContain('my-proxy.example.org')
    expect(report).not.toContain('hush-hush')
    expect(report).toContain('[ключ скрыт]')
    expect(report).toContain('- Модель: my-model')
    expect(report).toContain('- Ключ API: задан (сам ключ и адрес API, в том числе прокси, в отчёт не попадают)')
  })

  it('без ключа в настройках похожие на ключ строки тоже скрыты', () => {
    const g = game()
    g.say('sk-abcdefghijklmnop — это ключ?')
    const report = buildTestReport(input(g))
    expect(report).not.toContain('sk-abcdefghijklmnop')
    expect(report).toContain('- Ключ API: не задан')
  })
})

describe('тестовый отчёт: вспомогательное', () => {
  it('ходы — по репликам игрока; просьба об отдыхе — начало хода', () => {
    const g = game()
    g.say('Привет')
    g.commit({ type: 'restRequested', kind: 'short', hitDice: {} }, player('ratibor'))
    g.say('Отдыхаем')
    const turns = splitTurns(g.actions)
    expect(turns.map((t) => t.actions[0].type)).toEqual(['playerSpoke', 'restRequested'])
    expect(turns[1].player?.text).toBe('Отдыхаем')
    expect(turns[1].before?.messages.at(-1)?.text).toBe('Привет')
  })

  it('ручной бросок: пометка manual или старый бросок панели без подписи', () => {
    const result = roll('1d20', { rng: () => 0.5 })
    expect(isManualRoll({ id: 'x', timestamp: 1, result, manual: true })).toBe(true)
    expect(isManualRoll({ id: '0b6e-uuid', timestamp: 1, result })).toBe(true)
    expect(isManualRoll({ id: 'roll-t1', timestamp: 1, result })).toBe(false)
    expect(isManualRoll({ id: 'x', label: 'Кость хитов', timestamp: 1, result })).toBe(false)
  })

  it('версия промта — короткий хэш; имя файла', () => {
    expect(textVersion('abc')).toMatch(/^[0-9a-f]{8}$/)
    expect(textVersion('abc')).toBe(textVersion('abc'))
    expect(textVersion('abc')).not.toBe(textVersion('abd'))
    expect(reportFileName(new Date(2026, 10, 7, 9, 5).getTime())).toBe('ai-master-report-2026-11-07-0905.md')
  })

  it('запись хода хранит не больше 40 ходов', () => {
    const g = game()
    for (let i = 0; i < 45; i++) g.traces.start(g.state(), 'turn', itemCatalog)
    expect(g.traces.get()).toHaveLength(40)
  })
})

describe('ошибки консоли', () => {
  it('последние 50 записей; исключение и отклонённый промис — сбой для предложения отчёта', () => {
    const capture = createConsoleCapture(() => 1)
    const crashes: string[] = []
    capture.onCrash((e) => crashes.push(e.text))
    for (let i = 0; i < 60; i++) capture.add('warn', [`w${i}`])
    expect(capture.get()).toHaveLength(CONSOLE_LIMIT)
    expect(capture.get()[0].text).toBe('w10')
    capture.add('error', ['Ошибка', new Error('плохо')])
    capture.add('exception', [new TypeError('x is undefined')])
    capture.add('rejection', [{ reason: 'нет сети' }])
    expect(capture.get().at(-3)?.text).toContain('Ошибка Error: плохо')
    expect(crashes).toEqual([expect.stringContaining('TypeError: x is undefined'), '{"reason":"нет сети"}'])
  })
})
