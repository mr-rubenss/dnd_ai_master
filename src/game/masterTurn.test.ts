import { describe, expect, it } from 'vitest'
import { aiResponse, fakeMaster } from '../ai/testing'
import type { AiRequest } from '../ai/types'
import { itemCatalog, rulesData } from '../data'
import adventureJson from '../data/adventures/drunken-griffin.json'
import fighterJson from '../data/characters/fighter-ratibor.json'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import type { ActionAuthor, StoryEvent, StoryState } from '../types/story'
import { parseAdventure } from './adventure'
import { parseCharacterSheet } from './character'
import { parseLocation } from './location'
import { DM_PROMPT, masterMessages, masterSystemPrompt } from './masterPrompt'
import { gameStateText } from './masterState'
import { MAX_TOOL_ROUNDS, runMasterTurn } from './masterTurn'
import { applyAction, checkAction, ENGINE, makeAction, MASTER, newStorySeed, player } from './storyActions'

const context = { catalog: itemCatalog, rules: rulesData }
const location = parseLocation(drunkenGriffinJson)
const locations = { [location.id]: location }
const adventure = parseAdventure(adventureJson, locations)
const ratibor = parseCharacterSheet(fighterJson, itemCatalog)

function story(extra: [StoryEvent, ActionAuthor][] = []): StoryState {
  let state = newStorySeed({ id: 's1', title: 'Тень над трактом', tone: 'detective', adventure, locations, party: [ratibor], now: 1 })
  const events: [StoryEvent, ActionAuthor][] = [
    [{ type: 'masterNarrated', messageId: 'm1', text: 'Таверна шумит.' }, MASTER],
    [{ type: 'playerSpoke', heroId: 'ratibor', messageId: 'p1', text: 'Подхожу к стойке.' }, player('ratibor')],
    ...extra,
  ]
  events.forEach(([event, author], i) => (state = applyAction(state, makeAction('s1', i + 1, event, author, 2 + i, `a${i}`))))
  return state
}

describe('системный промт ведущего (src/ai/dm-prompt.md)', () => {
  it('роль: опытный справедливый мастер D&D 2024, по-русски, во втором лице', () => {
    expect(DM_PROMPT).toContain('опытный и справедливый мастер')
    expect(DM_PROMPT).toContain('D&D 2024')
    expect(DM_PROMPT).toContain('на русском языке')
    expect(DM_PROMPT).toContain('во втором лице')
    expect(DM_PROMPT).toContain('«ты входишь в таверну»')
  })

  it('стиль, свобода, честность, решения игрока, конец ответа', () => {
    expect(DM_PROMPT).toContain('3–6 предложений')
    expect(DM_PROMPT).toContain('свой голос, манера речи и мотивы')
    expect(DM_PROMPT).toContain('реагирует на поступки игрока')
    expect(DM_PROMPT).toContain('никогда не говоришь «нельзя»')
    expect(DM_PROMPT).toContain('назначаешь проверку')
    expect(DM_PROMPT).toContain('решает **только бросок кубика, и бросает его код игры**')
    expect(DM_PROMPT).toContain('Не подыгрывай')
    expect(DM_PROMPT).toContain('Злодеи и упрямые НПС не сдаются от одного слова')
    expect(DM_PROMPT).toContain('Провал имеет последствия')
    expect(DM_PROMPT).toContain('**никогда не решаешь за игрока**')
    expect(DM_PROMPT).toContain('ситуацией, на которую игрок может отреагировать')
  })

  it('в запросе: промт, эта история, длина ответа и состояние игры', () => {
    const prompt = masterSystemPrompt(story(), 'short', context)
    expect(prompt.startsWith(DM_PROMPT)).toBe(true)
    expect(prompt).toContain('«Тень над трактом». Тон: Детектив')
    expect(prompt).toContain('Отвечай коротко: 2–3 предложения')
    expect(prompt).toContain('## Состояние игры')
  })
})

describe('актуальное состояние игры в каждом запросе', () => {
  it('лист персонажа: класс, хиты, КД, характеристики, спасброски, навыки, атаки', () => {
    const text = gameStateText(story(), context)
    expect(text).toContain('### Ратибор')
    expect(text).toMatch(/Воин 1 ур\., предыстория: /)
    expect(text).toMatch(/Хиты \d+\/\d+, КД \d+, скорость 30 фт\., бонус мастерства \+2, пассивная Внимательность \d+\./)
    expect(text).toMatch(/Характеристики: СИЛ \d+ \([+-]\d\)/)
    expect(text).toContain('Спасброски (* — владение): СИЛ +')
    expect(text).toMatch(/Навыки с владением: .*Атлетика \+\d/)
    expect(text).toMatch(/Атаки: .+: атака \+\d+, урон \d+d\d+/)
    expect(text).toContain('Состояния: нет.')
  })

  it('инвентарь: экипировка, предметы с количеством, золото', () => {
    const text = gameStateText(story(), context)
    const inv = ratibor.inventory
    expect(text).toContain(`основная рука — ${itemCatalog[inv.equipped.mainHand!].name}`)
    expect(text).toContain(`доспех — ${itemCatalog[inv.equipped.armor!].name}`)
    expect(text).toContain(`золото: ${inv.gold} зм`)
    for (const e of inv.items) expect(text).toContain(itemCatalog[e.itemId].name)
  })

  it('текущая локация: описание, помещения, объекты, двери, НПС с отношением и положением, герой на карте', () => {
    const text = gameStateText(story(), context)
    expect(text).toContain('### Таверна «Пьяный грифон»')
    expect(text).toContain(location.description)
    expect(text).toContain('Помещения: У стойки')
    expect(text).toContain('- Барная стойка (3, 2): Длинная стойка')
    expect(text).toMatch(/- Стул ×\d+/)
    expect(text).toContain('- Входная дверь — закрыта')
    expect(text).toContain('- Дверь в кладовую — заперта')
    for (const n of location.npcs) expect(text).toContain(`- ${n.name} (${n.x}, ${n.y})`)
    expect(text).toMatch(/Гуннар \(\d+, \d+\), отношение: (дружелюбное|нейтральное|враждебное)/)
    expect(text).toContain(`Положение на карте: клетка (${location.playerStart.x}, ${location.playerStart.y})`)
  })

  it('состояние собирается заново: двери, состояния, предметы, НПС, задания и факты — как сейчас в истории', () => {
    const gunnar = location.npcs.find((n) => n.name === 'Гуннар')!
    const after = story([
      [{ type: 'doorChanged', locationId: location.id, doorId: 'entrance', state: 'open' }, MASTER],
      [{ type: 'conditionsChanged', heroId: 'ratibor', conditions: [{ id: 'poisoned' }] }, ENGINE],
      [{ type: 'itemsGranted', heroId: 'ratibor', items: [{ itemId: 'dagger', quantity: 2 }] }, MASTER],
      [{ type: 'npcMoved', locationId: location.id, npcId: gunnar.id, to: { x: 5, y: 3 } }, MASTER],
      [{ type: 'questUpdated', quest: { id: 'q1', title: 'Вернуть кошелёк', status: 'active', notes: '' } }, MASTER],
      [{ type: 'factRecorded', fact: { id: 'f1', text: 'Тобиас работает на гильдию воров', at: 1 } }, MASTER],
    ])
    const text = masterMessages(after, 'normal', context)[0].content as string
    expect(text).toContain('- Входная дверь — открыта')
    expect(text).toContain('Состояния: Отравлен.')
    expect(text).toMatch(/Кинжал ×\d/)
    expect(text).toContain('- Гуннар (5, 3)')
    expect(text).toContain('- Вернуть кошелёк — в работе')
    expect(text).toContain('- Тобиас работает на гильдию воров')
  })

  it('лента: ведущий — assistant, игрок — user, после системного промта', () => {
    const messages = masterMessages(story(), 'normal', context)
    expect(messages[0].role).toBe('system')
    expect(messages.slice(-2)).toEqual([
      { role: 'assistant', content: 'Таверна шумит.' },
      { role: 'user', content: 'Подхожу к стойке.' },
    ])
  })
})

describe('ход ведущего', () => {
  it('через общий интерфейс: состояние в системном сообщении, поток текста, лимит длины, итоговый текст', async () => {
    const requests: AiRequest[] = []
    const parts: string[] = []
    const { master } = fakeMaster([
      (req) => {
        requests.push(req)
        req.onText?.('Гуннар ')
        req.onText?.('кивает.')
        return aiResponse({ text: ' Гуннар кивает. ', streamed: true })
      },
    ])
    const result = await runMasterTurn(master, story(), { verbosity: 'detailed', context, onText: (d) => parts.push(d) })
    expect(result).toEqual({ text: 'Гуннар кивает.', truncated: false, toolCalls: [] })
    expect(parts).toEqual(['Гуннар ', 'кивает.'])
    expect(requests[0].maxTokens).toBe(1600)
    expect(requests[0].messages[0].content).toContain('## Отряд (лист персонажа и инвентарь)')
    expect(requests[0].tools).toBeUndefined()
  })

  it('пустой ответ — понятная ошибка', async () => {
    const { master } = fakeMaster([() => aiResponse({ text: '  ' })])
    await expect(runMasterTurn(master, story(), { verbosity: 'normal', context })).rejects.toThrow('Ведущий прислал пустой ответ')
  })

  it('рассуждающая модель не успела ответить — объяснение, что делать', async () => {
    const { master } = fakeMaster([() => aiResponse({ reasoning: 'Игрок подходит к стойке, значит…', finishReason: 'length' })])
    await expect(runMasterTurn(master, story(), { verbosity: 'normal', context })).rejects.toThrow('модель «размышляла»')
  })
})

describe('цикл с инструментами: ответ модели → инструменты → результаты модели → финальный текст', () => {
  /** Среда хода: история в памяти, действия проверяются checkAction и применяются по одному. */
  function runtimeFor(initial: StoryState, rolls: number[] = []) {
    let state = initial
    let seq = 100
    const committed: string[] = []
    let n = 0
    const runtime = {
      getStory: () => state,
      commit: (event: StoryEvent, author: ActionAuthor) => {
        const action = makeAction(state.id, seq++, event, author, 5, `x${seq}`)
        const reason = checkAction(state, action, { catalog: itemCatalog })
        if (reason) return reason
        state = applyAction(state, action)
        committed.push(event.type)
        return null
      },
      tools: { catalog: itemCatalog, rng: () => rolls.shift() ?? 0.5, now: () => 7, newId: () => `t${++n}` },
    }
    return { runtime, committed, current: () => state }
  }
  const toolCall = (name: string, args: unknown, id = name) => ({ id, name, arguments: args, rawArguments: JSON.stringify(args) })

  it('проверка и недопустимый вызов в одном ответе: бросок движка, отказ с причиной, затем финальный рассказ', async () => {
    const env = runtimeFor(story(), [(15 - 0.5) / 20])
    const { master, requests } = fakeMaster([
      () =>
        aiResponse({
          text: 'Ты наваливаешься плечом на дверь кладовой.',
          toolCalls: [
            toolCall('request_check', { skill: 'athletics', dc: 15, reason: 'выбить дверь кладовой' }),
            toolCall('remove_item', { item: 'dagger' }),
          ],
          finishReason: 'tool_calls',
        }),
      () => aiResponse({ text: 'Замок с треском вылетает — дверь распахивается.' }),
    ])
    const result = await runMasterTurn(master, story(), { verbosity: 'normal', context, runtime: env.runtime })

    expect(result.text).toBe('Замок с треском вылетает — дверь распахивается.')
    expect(result.toolCalls.map((t) => [t.call.name, t.outcome.ok])).toEqual([
      ['request_check', true],
      ['remove_item', false],
    ])
    // Рассказ перед вызовом — в ленту сразу, затем карточка броска; недопустимый вызов ничего не записал.
    expect(env.committed).toEqual(['masterNarrated', 'checkRolled'])
    const feed = env.current().messages.slice(-2)
    expect(feed[0]).toMatchObject({ author: 'master', text: 'Ты наваливаешься плечом на дверь кладовой.' })
    expect(feed[1]).toMatchObject({ author: 'system', check: { reason: 'выбить дверь кладовой', result: { total: 20, success: true } } })

    // Первый запрос — с инструментами; второй — с историей вызовов и их результатами.
    expect(requests[0].tools?.map((t) => t.name)).toContain('request_check')
    expect(requests[0].toolChoice).toBe('auto')
    const second = requests[1].messages
    expect(second.at(-3)).toMatchObject({ role: 'assistant', toolCalls: [{ name: 'request_check' }, { name: 'remove_item' }] })
    expect(JSON.parse((second.at(-2) as { content: string }).content)).toMatchObject({ ok: true, success: true, total: 20 })
    expect(JSON.parse((second.at(-1) as { content: string }).content)).toEqual({ ok: false, error: 'У героя нет предмета «Кинжал».' })
  })

  it('несколько изменений игры за ход: предметы, золото, обстановка; состояние в промте обновляется', async () => {
    const env = runtimeFor(story())
    const { master, requests } = fakeMaster([
      () =>
        aiResponse({
          toolCalls: [
            toolCall('change_gold', { amount: -3 }, 'a'),
            toolCall('give_item', { item: 'Кинжал' }, 'b'),
            toolCall('update_object', { object: 'table-2', name: 'Опрокинутый стол' }, 'c'),
          ],
        }),
      () => aiResponse({ text: 'Гуннар протягивает кинжал и сгребает монеты.' }),
    ])
    const result = await runMasterTurn(master, story(), { verbosity: 'normal', context, runtime: env.runtime })
    expect(result.toolCalls.every((t) => t.outcome.ok)).toBe(true)
    expect(env.current().party[0].inventory.gold).toBe(15)
    expect(requests[1].messages[0].content).toContain('золото: 15 зм')
    expect(requests[1].messages[0].content).toContain('- Опрокинутый стол (9, 7)')
  })

  it('движок отклонил запись — модель получает причину', async () => {
    const env = runtimeFor(story())
    const runtime = { ...env.runtime, commit: () => 'Хранилище недоступно.' }
    const { master } = fakeMaster([() => aiResponse({ toolCalls: [toolCall('note_fact', { text: 'Факт' })] }), () => aiResponse({ text: 'Дальше.' })])
    const result = await runMasterTurn(master, story(), { verbosity: 'normal', context, runtime })
    expect(result.toolCalls[0].outcome).toEqual({ ok: false, result: { ok: false, error: 'Хранилище недоступно.' }, events: [] })
  })

  it('модель не останавливается — после лимита раундов инструменты отключаются и нужен текст', async () => {
    const env = runtimeFor(story())
    const steps = Array.from({ length: MAX_TOOL_ROUNDS }, (_, i) => () => aiResponse({ toolCalls: [toolCall('note_fact', { text: `Факт ${i}` })] }))
    const { master, requests } = fakeMaster([...steps, () => aiResponse({ text: 'Итог.', toolCalls: [toolCall('note_fact', { text: 'лишний' })] })])
    const result = await runMasterTurn(master, story(), { verbosity: 'normal', context, runtime: env.runtime })
    expect(result.text).toBe('Итог.')
    expect(requests.at(-1)!.toolChoice).toBe('none')
    expect(env.current().world.facts.map((f) => f.text)).toEqual(['Факт 0', 'Факт 1', 'Факт 2', 'Факт 3'])
  })

  it('весь рассказ уже записан по ходу, финал пустой — не ошибка', async () => {
    const env = runtimeFor(story())
    const { master } = fakeMaster([
      () => aiResponse({ text: 'Брам хохочет.', toolCalls: [toolCall('note_fact', { text: 'Брам весел' })] }),
      () => aiResponse({}),
    ])
    const result = await runMasterTurn(master, story(), { verbosity: 'normal', context, runtime: env.runtime })
    expect(result.text).toBe('')
    expect(env.committed).toEqual(['masterNarrated', 'factRecorded'])
  })
})
