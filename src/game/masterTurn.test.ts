import { describe, expect, it } from 'vitest'
import { aiResponse, fakeMaster } from '../ai/testing'
import type { AiRequest } from '../ai/types'
import { itemCatalog, priceList, rulesData } from '../data'
import adventureJson from '../data/adventures/drunken-griffin.json'
import fighterJson from '../data/characters/fighter-ratibor.json'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import type { ActionAuthor, StoryEvent, StoryState } from '../types/story'
import { parseAdventure } from './adventure'
import { parseCharacterSheet } from './character'
import { parseLocation } from './location'
import { DM_PROMPT, masterMessages, masterSystemPrompt } from './masterPrompt'
import { gameStateText } from './masterState'
import { END_TURN_REMINDER, MAX_TOOL_ROUNDS, REWRITE_REQUEST, runMasterRewrite, runMasterTurn } from './masterTurn'
import { applyAction, checkAction, ENGINE, makeAction, MASTER, newStorySeed, OUT_OF_GAME_REFUSAL, player } from './storyActions'
import { transcript } from './memory'

const context = { catalog: itemCatalog, rules: rulesData }
const location = parseLocation(drunkenGriffinJson)
const locations = { [location.id]: location }
const adventure = parseAdventure(adventureJson, locations)
const ratibor = parseCharacterSheet(fighterJson, itemCatalog)

function story(extra: [StoryEvent, ActionAuthor][] = []): StoryState {
  let state = newStorySeed({ id: 's1', title: 'Тень над трактом', tone: 'detective', adventure, locations, party: [ratibor], now: 1 })
  const events: [StoryEvent, ActionAuthor][] = [
    [{ type: 'masterNarrated', messageId: 'm1', text: 'Таверна шумит.' }, MASTER],
    [{ type: 'playerSpoke', heroId: 'ratibor', messageId: 'p1', text: 'Облокачиваюсь на стойку.' }, player('ratibor')],
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

  it('живые НПС: не как справочник, по крупицам, из цели и манеры речи; примеры «плоско» и «живо»', () => {
    expect(DM_PROMPT).toContain('## Живые НПС')
    expect(DM_PROMPT).toContain('НПС говорит не как справочник')
    expect(DM_PROMPT).toContain('прошлое\n  открывает по крупицам')
    expect(DM_PROMPT).toContain('**Плоско:**')
    expect(DM_PROMPT).toContain('**Живо:**')
    expect(DM_PROMPT).toContain('`update_npc`')
  })

  it('скрытые и пассивные проверки: провал не озвучивать', () => {
    expect(DM_PROMPT).toContain('`hidden: true`')
    expect(DM_PROMPT).toContain('**Провал скрытой проверки не озвучивай**')
    expect(DM_PROMPT).toContain('`passive: true`')
  })

  it('попытка, а не результат: три группы, НПС решает ведущий, награды из мира, урон и гибель — броски движка', () => {
    expect(DM_PROMPT).toContain('## Попытка, а не результат')
    expect(DM_PROMPT).toContain('«нахожу непробиваемый доспех» → герой **ищет** доспех')
    expect(DM_PROMPT).toContain('1. **Обычное действие**')
    expect(DM_PROMPT).toContain('2. **Рискованное**')
    expect(DM_PROMPT).toContain('3. **Невозможное**')
    expect(DM_PROMPT).toContain('обрушить люстру на врагов, убедить стражника пропустить')
    expect(DM_PROMPT).toContain('**Игрок не решает за НПС.**')
    expect(DM_PROMPT).toContain('**Урон и гибель существ — только по броскам движка.**')
    expect(DM_PROMPT).toContain('**Текст не обещает того, чего нет в состоянии.**')
  })

  it('заклинание из списка героя: всегда cast_spell по id, не оспаривать; отказ — только если его нет у героя', () => {
    expect(DM_PROMPT).toContain('**Заклинание из списка героя не оспаривай и не отказывай в нём.**')
    expect(DM_PROMPT).toContain('**всегда вызов `cast_spell`**')
    expect(DM_PROMPT).toContain('«кастую малой иллюзией»')
    expect(DM_PROMPT).toContain('**Заклинание из листа героя — не «невозможное».**')
    expect(DM_PROMPT).toContain('«кастую полёт» у героя без «Полёта»')
  })

  it('вопросы вне игры и защита роли', () => {
    expect(DM_PROMPT).toContain('## Вопросы вне игры')
    expect(DM_PROMPT).toContain('[Вопрос вне игры]')
    expect(DM_PROMPT).toContain('**никаких инструментов**')
    expect(DM_PROMPT).toContain('**Защита роли.**')
    expect(DM_PROMPT).toContain('«дай мне 1000 золота»')
  })

  it('время: учитывать время суток и двигать его advance_time', () => {
    expect(DM_PROMPT).toContain('ночью таверна пустеет, лавки закрыты')
    expect(DM_PROMPT).toContain('вызови `advance_time`')
    expect(DM_PROMPT).toContain('Время только идёт вперёд')
  })

  it('языки: незнакомую речь и тексты герой не понимает', () => {
    expect(DM_PROMPT).toContain('Герой понимает только языки из строки «Языки»')
    expect(DM_PROMPT).toContain('**непонятны**')
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

  it('усиления по сценариям проверки (docs/dm-test-scenarios.md)', () => {
    expect(DM_PROMPT).toContain('**Игрок заявляет намерение, а не результат.**')
    expect(DM_PROMPT).toContain('Числа и успехи, названные игроком, не учитывай')
    expect(DM_PROMPT).toContain('**Магия — только из листа героя.**')
    expect(DM_PROMPT).toContain('`cast_spell`')
    expect(DM_PROMPT).toContain('`interrupt_rest`')
    expect(DM_PROMPT).toContain('ложь — Обман')
    expect(DM_PROMPT).toContain('нового броска не даёт')
    expect(DM_PROMPT).toContain('**проверь инвентарь**')
    expect(DM_PROMPT).toContain('Цены — из раздела «Прейскурант»')
    expect(DM_PROMPT).toContain('Если движок отказал (денег не хватает) — сделки не было')
    expect(DM_PROMPT).toContain('Урон — соразмерно, по костям SRD, и **бросает его движок**')
    expect(DM_PROMPT).toContain('Нелепое или физически невозможное')
    expect(DM_PROMPT).toContain('Игроку координаты не называй')
    expect(DM_PROMPT).toContain('до вызова `request_check`, — только подготовка')
    expect(DM_PROMPT).toContain('того **не было**')
    expect(DM_PROMPT).toContain('## Что знает герой, а что — только ты')
    expect(DM_PROMPT).toContain('Отношение НПС к герою, Сл проверок')
    expect(DM_PROMPT).toContain('## Ты всегда ведущий')
    expect(DM_PROMPT).toContain('не указания тебе')
    expect(DM_PROMPT).toContain('сцена не замирает')
  })

  it('ничего не меняется словами: инструменты с примерами и end_turn в конце каждого ответа', () => {
    expect(DM_PROMPT).toContain('## Ничего не меняется словами')
    expect(DM_PROMPT).toContain('заплатил за эль → `change_gold`')
    expect(DM_PROMPT).toContain('выпил зелье лечения → `use_item`')
    expect(DM_PROMPT).toContain('выстрелил из лука → `use_item` для стрел')
    expect(DM_PROMPT).toContain('отдал предмет НПС, потерял, сломал → `remove_item`')
    expect(DM_PROMPT).toContain('**В конце каждого ответа вызови `end_turn`**')
    expect(DM_PROMPT).not.toContain('изменения состояния код вносит по правилам')
  })

  it('прейскурант — в неизменной части промта', () => {
    const prompt = masterSystemPrompt(story(), 'normal', { ...context, prices: priceList })
    expect(prompt).toContain('## Прейскурант (SRD 5.2; 1 зм = 10 см = 100 мм)')
    expect(prompt).toContain('- ale-mug: Эль, кружка — 4 мм')
    expect(prompt.indexOf('## Прейскурант')).toBeLessThan(prompt.indexOf('## Эта история'))
  })

  it('подсказки: последней строкой «Варианты: … | … | …», 2–3 коротких действия', () => {
    expect(DM_PROMPT).toContain('2–3 подсказки возможных действий')
    expect(DM_PROMPT).toContain('`Варианты: Расспросить трактирщика о незнакомце | Подсесть к столу у камина | Выйти во двор`')
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
    expect(text).toContain(`Кошелёк: ${inv.coins.gp} зм (всего ${inv.coins.gp * 100} мм; 1 зм = 10 см = 100 мм).`)
    for (const e of inv.items) expect(text).toContain(itemCatalog[e.itemId].name)
  })

  it('текущая локация: описание, помещения, объекты, двери, НПС с отношением и положением, герой на карте', () => {
    const text = gameStateText(story(), context)
    expect(text).toContain('### Таверна «Пьяный грифон»')
    expect(text).toContain(location.description)
    expect(text).toContain('Помещения: У стойки')
    expect(text).toContain('- Барная стойка [bar] (3, 2): Длинная стойка')
    expect(text).toMatch(/- Стул ×\d+/)
    expect(text).toContain('- Входная дверь [entrance] — закрыта')
    expect(text).toContain('- Дверь в кладовую [storage-door] — заперта')
    for (const n of location.npcs) expect(text).toContain(`- ${n.name} [${n.id}] (${n.x}, ${n.y})`)
    expect(text).toMatch(/Гуннар \[gunnar\] \(\d+, \d+\), отношение: (дружелюбное|нейтральное|враждебное)/)
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
    expect(text).toContain('- Входная дверь [entrance] — открыта')
    expect(text).toContain('Состояния: Отравлен.')
    expect(text).toMatch(/Кинжал ×\d/)
    expect(text).toContain('- Гуннар [gunnar] (5, 3)')
    expect(text).toContain('- Вернуть кошелёк — в работе')
    expect(text).toContain('- Тобиас работает на гильдию воров')
  })

  it('лента: ведущий — assistant, игрок — user, после системного промта', () => {
    const messages = masterMessages(story(), 'normal', context)
    expect(messages[0].role).toBe('system')
    expect(messages.slice(-2)).toEqual([
      { role: 'assistant', content: 'Таверна шумит.' },
      { role: 'user', content: 'Облокачиваюсь на стойку.' },
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
    expect(result).toEqual({ text: 'Гуннар кивает.', suggestions: [], truncated: false, toolCalls: [], changes: [], verification: { status: 'skipped' } })
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

describe('подсказки и «Переписать ответ»', () => {
  it('строка «Варианты: …» вырезается из рассказа и возвращается подсказками', async () => {
    const { master } = fakeMaster([
      () => aiResponse({ text: 'Гуннар хмурится.\n— Чего тебе?\n\nВарианты: Заказать эль | Спросить о незнакомце | Уйти' }),
    ])
    const result = await runMasterTurn(master, story(), { verbosity: 'normal', context })
    expect(result.text).toBe('Гуннар хмурится.\n— Чего тебе?')
    expect(result.suggestions).toEqual(['Заказать эль', 'Спросить о незнакомце', 'Уйти'])
  })

  it('подсказки возвращаются модели в ленте в том же виде', () => {
    const s = story([[{ type: 'masterNarrated', messageId: 'm2', text: 'Гуннар хмурится.', suggestions: ['Заказать эль', 'Уйти'] }, MASTER]])
    expect(masterMessages(s, 'normal', context).at(-1)).toEqual({ role: 'assistant', content: 'Гуннар хмурится.\n\nВарианты: Заказать эль | Уйти' })
  })

  it('переписать: тот же контекст плюс просьба, без инструментов; новый текст и подсказки', async () => {
    const s = story([[{ type: 'masterNarrated', messageId: 'm2', text: 'Гуннар хмурится.' }, MASTER]])
    const parts: string[] = []
    const { master, requests } = fakeMaster([
      (req) => {
        req.onText?.('Гуннар ')
        return aiResponse({ text: 'Гуннар молча протирает кружку.\nВарианты: Положить монету на стойку | Окликнуть его', streamed: true })
      },
    ])
    const result = await runMasterRewrite(master, s, { verbosity: 'normal', context, onText: (d) => parts.push(d) })
    expect(result).toEqual({ messageId: 'm2', text: 'Гуннар молча протирает кружку.', suggestions: ['Положить монету на стойку', 'Окликнуть его'], truncated: false })
    expect(parts).toEqual(['Гуннар '])
    const messages = requests[0].messages
    expect(messages.at(-2)).toEqual({ role: 'assistant', content: 'Гуннар хмурится.' })
    expect(messages.at(-1)).toEqual({ role: 'user', content: REWRITE_REQUEST })
    expect(requests[0].tools).toBeUndefined()
    expect(requests[0].toolChoice).toBeUndefined()
  })

  it('переписать нечего — последним в ленте игрок или карточка броска', async () => {
    const { master, requests } = fakeMaster([])
    expect(await runMasterRewrite(master, story(), { verbosity: 'normal', context })).toBeNull()
    expect(requests).toHaveLength(0)
  })

  it('пустой переписанный ответ — понятная ошибка', async () => {
    const s = story([[{ type: 'masterNarrated', messageId: 'm2', text: 'Гуннар хмурится.' }, MASTER]])
    const { master } = fakeMaster([() => aiResponse({ text: 'Варианты: Уйти' })])
    await expect(runMasterRewrite(master, s, { verbosity: 'normal', context })).rejects.toThrow('Ведущий прислал пустой ответ')
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
  /** Служебный end_turn: изменения за ход по рассказу ведущего. */
  const endTurn = (changes: unknown[] = [], id = 'end') => toolCall('end_turn', { changes }, id)

  /** История, где последняя реплика игрока — вопрос вне игры. */
  const asked = (text = 'Как работает преимущество?') =>
    story([[{ type: 'playerSpoke', heroId: 'ratibor', messageId: 'q1', text, ooc: true }, player('ratibor')]])

  it('вопрос вне игры: инструменты (время, отдых, броски) отклонены, время не идёт, ответ — вне игры, без сверки end_turn', async () => {
    const before = asked()
    expect(before.outOfGame).toBe(true)
    const env = runtimeFor(before)
    const { master, requests } = fakeMaster([
      () =>
        aiResponse({
          text: 'Пока объясню, пусть пройдёт часок.',
          toolCalls: [
            toolCall('advance_time', { minutes: 60, reason: 'объяснение' }),
            toolCall('rest', { kind: 'short' }),
            toolCall('request_check', { skill: 'perception', dc: 10, reason: 'x' }),
          ],
        }),
      () => aiResponse({ text: 'Преимущество — бросаешь два к20 и берёшь больший.\nВарианты: Спросить ещё | Вернуться в игру' }),
    ])
    const result = await runMasterTurn(master, before, { verbosity: 'normal', context, runtime: env.runtime })
    expect(result.toolCalls.map((t) => [t.call.name, t.outcome.ok, t.outcome.result.error])).toEqual([
      ['advance_time', false, OUT_OF_GAME_REFUSAL],
      ['rest', false, OUT_OF_GAME_REFUSAL],
      ['request_check', false, OUT_OF_GAME_REFUSAL],
    ])
    expect(result.verification).toEqual({ status: 'skipped' })
    expect(result.suggestions).toEqual([])
    expect(result.changes).toEqual([])
    expect(result.text).toBe('Преимущество — бросаешь два к20 и берёшь больший.')
    // Текст перед вызовами записан как ответ вне игры; время и лист — прежние.
    expect(env.committed).toEqual(['masterNarrated'])
    expect(env.current().messages.at(-1)).toMatchObject({ author: 'master', ooc: true })
    expect(env.current().time).toBe(before.time)
    expect(env.current().party).toEqual(before.party)
    // В запросе: пометка вопроса и раздел «Сейчас вопрос вне игры»; без напоминания про end_turn.
    expect(requests[0].messages.at(-1)?.content).toBe('[Вопрос вне игры] Как работает преимущество?')
    expect(requests[0].messages[0].content).toContain('## Сейчас вопрос вне игры')
    expect(requests.flatMap((r) => r.messages).some((m) => m.content === END_TURN_REMINDER)).toBe(false)
  })

  it('движок: пока вопрос вне игры — ведущий и движок не меняют игру; действие героя снимает режим', () => {
    const s = asked()
    const check = (event: StoryEvent, author: ActionAuthor) => checkAction(s, makeAction(s.id, 1, event, author, 1, 'x'), { catalog: itemCatalog })
    expect(check({ type: 'timeAdvanced', minutes: 30, reason: 'x' }, MASTER)).toBe(OUT_OF_GAME_REFUSAL)
    expect(check({ type: 'moneyChanged', heroId: 'ratibor', delta: 100000, coins: { gp: 1000, sp: 0, cp: 0 } }, MASTER)).toBe(OUT_OF_GAME_REFUSAL)
    expect(check({ type: 'restCompleted', messageId: 'r', kind: 'short', heroes: [] }, ENGINE)).toBe(OUT_OF_GAME_REFUSAL)
    expect(check({ type: 'masterNarrated', messageId: 'a', text: 'Ответ', ooc: true }, MASTER)).toBeNull()
    expect(check({ type: 'masterNarrated', messageId: 'a', text: 'Сцена продолжается' }, MASTER)).toBe('Сейчас вопрос вне игры — ответ ведущего тоже вне игры.')
    expect(check({ type: 'masterNarrated', messageId: 'a', text: 'Ответ', ooc: true, suggestions: ['x'] }, MASTER)).toBe('У ответа вне игры нет подсказок действий.')
    // Игрок может ответить в игре — режим снимается.
    const back = applyAction(s, makeAction(s.id, 2, { type: 'playerSpoke', heroId: 'ratibor', messageId: 'p2', text: 'Иду к стойке' }, player('ratibor'), 2, 'y'))
    expect(back.outOfGame).toBeUndefined()
    expect(checkAction(back, makeAction(back.id, 3, { type: 'timeAdvanced', minutes: 30, reason: 'x' }, MASTER, 3, 'z'), { catalog: itemCatalog })).toBeNull()
    // Ответ вне игры без вопроса — нельзя.
    expect(checkAction(back, makeAction(back.id, 3, { type: 'masterNarrated', messageId: 'a', text: 'x', ooc: true }, MASTER, 3, 'z'), { catalog: itemCatalog })).toBe(
      'Ответ вне игры — только на вопрос игрока вне игры.',
    )
  })

  it('вопросы и ответы вне игры не попадают в сводку истории (фрагмент для сжатия)', () => {
    let s = asked('Сколько у меня хитов?')
    s = applyAction(s, makeAction(s.id, 2, { type: 'masterNarrated', messageId: 'a1', text: '12 из 12.', ooc: true }, MASTER, 2, 'y'))
    s = applyAction(s, makeAction(s.id, 3, { type: 'playerSpoke', heroId: 'ratibor', messageId: 'p2', text: 'Заказываю эль' }, player('ratibor'), 3, 'z'))
    const text = transcript(s, s.messages)
    expect(text).toContain('Заказываю эль')
    expect(text).not.toContain('Сколько у меня хитов?')
    expect(text).not.toContain('12 из 12.')
  })

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
      () => aiResponse({ text: 'Замок с треском вылетает — дверь распахивается.', toolCalls: [endTurn()] }),
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
            toolCall('change_gold', { amount: -3, reason: 'кинжал' }, 'a'),
            toolCall('give_item', { item: 'Кинжал', source: 'npc', from: 'Гуннар' }, 'b'),
            toolCall('update_object', { object: 'table-2', name: 'Опрокинутый стол' }, 'c'),
          ],
        }),
      () =>
        aiResponse({
          text: 'Гуннар протягивает кинжал и сгребает монеты.',
          toolCalls: [endTurn([{ kind: 'money', amount: -3, currency: 'gp' }, { kind: 'item', item: 'Кинжал', amount: 1 }])],
        }),
    ])
    const result = await runMasterTurn(master, story(), { verbosity: 'normal', context, runtime: env.runtime })
    expect(result.toolCalls.every((t) => t.outcome.ok)).toBe(true)
    expect(env.current().party[0].inventory.coins).toEqual({ gp: 15, sp: 0, cp: 0 })
    expect(requests[1].messages[0].content).toContain('Кошелёк: 15 зм')
    expect(result.verification).toEqual({ status: 'ok' })
    expect(result.changes.map((c) => c.text)).toEqual(['−3 зм (кинжал)', '+1 кинжал'])
    expect(requests[1].messages[0].content).toMatch(/- Опрокинутый стол \[[^\]]+\] \(9, 7\)/)
  })

  it('движок отклонил запись — модель получает причину', async () => {
    const env = runtimeFor(story())
    const runtime = { ...env.runtime, commit: () => 'Хранилище недоступно.' }
    const { master } = fakeMaster([
      () => aiResponse({ toolCalls: [toolCall('note_fact', { text: 'Факт' })] }),
      () => aiResponse({ text: 'Дальше.', toolCalls: [endTurn()] }),
    ])
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
      () => aiResponse({ toolCalls: [endTurn()] }),
    ])
    const result = await runMasterTurn(master, story(), { verbosity: 'normal', context, runtime: env.runtime })
    expect(result.text).toBe('')
    expect(env.committed).toEqual(['masterNarrated', 'factRecorded'])
  })

  it('ведущий забыл инструмент: заявил оплату эля в end_turn, но не вызвал change_gold — один довызов', async () => {
    const env = runtimeFor(story())
    const { master, requests } = fakeMaster([
      () =>
        aiResponse({
          text: 'Ты кладёшь на стойку медяки, Гуннар наливает пенный эль.',
          toolCalls: [endTurn([{ kind: 'money', amount: -4, currency: 'cp' }])],
        }),
      () => aiResponse({ toolCalls: [toolCall('change_gold', { price: 'ale-mug', reason: 'эль' }, 'pay'), endTurn([{ kind: 'money', amount: -4, currency: 'cp' }], 'end2')] }),
    ])
    const result = await runMasterTurn(master, story(), { verbosity: 'normal', context, runtime: { ...env.runtime, tools: { ...env.runtime.tools, prices: priceList } } })
    // Рассказ — в ленте сразу, затем довызов: деньги списаны, строка изменений готова.
    expect(env.committed).toEqual(['masterNarrated', 'moneyChanged'])
    expect(env.current().party[0].inventory.coins).toEqual({ gp: 17, sp: 9, cp: 6 })
    expect(result.text).toBe('')
    expect(result.verification).toEqual({ status: 'fixed', problems: ['Деньги Ратибор: заявлено −4 мм, а в листе ничего не изменилось — вызови change_gold на разницу (−4 мм).'] })
    expect(result.changes).toEqual([{ heroId: 'ratibor', kind: 'money', text: '−4 мм (эль)', tone: 'loss' }])
    const retry = JSON.parse(requests[1].messages.at(-1)!.content as string) as { ok: boolean; missing: string[] }
    expect(retry.ok).toBe(false)
    expect(retry.missing[0]).toContain('вызови change_gold')
    expect(requests[1].toolChoice).toBe('auto')
  })

  it('ведущий не вызвал end_turn — одно напоминание; рассказ уже в ленте, довызов меняет лист', async () => {
    const env = runtimeFor(story())
    const { master, requests } = fakeMaster([
      () => aiResponse({ text: 'Ты натягиваешь тетиву и пускаешь стрелу в мишень.' }),
      () => aiResponse({ toolCalls: [toolCall('use_item', { item: 'arrow', reason: 'выстрел' }), endTurn([{ kind: 'item', item: 'arrow', amount: -1 }])] }),
    ])
    const result = await runMasterTurn(master, story(), { verbosity: 'normal', context, runtime: env.runtime })
    expect(requests[1].messages.at(-1)).toEqual({ role: 'user', content: END_TURN_REMINDER })
    expect(env.committed).toEqual(['masterNarrated', 'itemsRemoved'])
    expect(result.changes.map((c) => c.text)).toEqual(['−1 стрела'])
    expect(result.verification).toEqual({ status: 'fixed', problems: ['Ведущий не вызвал end_turn.'] })
  })

  it('после напоминания модель повторила рассказ — второй раз в ленту он не попадает', async () => {
    const env = runtimeFor(story())
    const { master } = fakeMaster([() => aiResponse({ text: 'Гуннар кивает.' }), () => aiResponse({ text: 'Гуннар кивает.' })])
    const result = await runMasterTurn(master, story(), { verbosity: 'normal', context, runtime: env.runtime })
    expect(result.text).toBe('')
    expect(env.current().messages.filter((m) => m.text === 'Гуннар кивает.')).toHaveLength(1)
    expect(result.verification).toEqual({ status: 'unresolved', problems: ['Ведущий не вызвал end_turn.'] })
  })

  it('нехватка денег: движок отказывает, ведущий обыгрывает отказ — лист не меняется, повтор только один', async () => {
    const env = runtimeFor(story())
    const { master, requests } = fakeMaster([
      () =>
        aiResponse({
          text: 'Ты просишь лучшие покои на неделю.',
          toolCalls: [toolCall('change_gold', { price: 'inn-aristocratic', quantity: 7, reason: 'покои' }), endTurn([{ kind: 'money', amount: -28, currency: 'gp' }])],
        }),
      () => aiResponse({ text: 'Гуннар пересчитывает твои монеты и качает головой: — Не хватает, приятель.', toolCalls: [endTurn([])] }),
    ])
    const result = await runMasterTurn(master, story(), { verbosity: 'normal', context, runtime: { ...env.runtime, tools: { ...env.runtime.tools, prices: priceList } } })
    expect(result.toolCalls[0].outcome).toMatchObject({ ok: false, result: { error: 'Денег не хватает: у Ратибор 18 зм, а нужно 28 зм. Сделки нет — обыграй это в рассказе.' } })
    expect(env.current().party[0].inventory.coins).toEqual({ gp: 18, sp: 0, cp: 0 })
    // Модель видит и отказ движка, и что заявленное не сделано.
    const retry = requests[1].messages
    expect(JSON.parse(retry.at(-2)!.content as string)).toMatchObject({ ok: false, error: expect.stringContaining('Денег не хватает') })
    expect(result.text).toBe('Гуннар пересчитывает твои монеты и качает головой: — Не хватает, приятель.')
    expect(result.changes).toEqual([])
    expect(result.verification.status).toBe('fixed')
    expect(requests).toHaveLength(2)
  })

  it('довызов не помог — второй раз не просим, ход заканчивается (сверка «не исправлено»)', async () => {
    const env = runtimeFor(story())
    const { master, requests } = fakeMaster([
      () => aiResponse({ text: 'Ты выпиваешь зелье.', toolCalls: [endTurn([{ kind: 'hp', amount: 7 }])] }),
      () => aiResponse({ toolCalls: [endTurn([{ kind: 'hp', amount: 7 }], 'end2')] }),
    ])
    const result = await runMasterTurn(master, story(), { verbosity: 'normal', context, runtime: env.runtime })
    expect(result.verification).toMatchObject({ status: 'unresolved' })
    expect(requests).toHaveLength(2)
  })

  describe('сверка текста с состоянием: текст не обещает того, чего нет в игре', () => {
    const reminderOf = (req: AiRequest) => req.messages.at(-1) as { role: string; content: string }

    it('«трактирщик протягивает тебе золото» без change_gold — просьба; ведущий довызывает инструмент с источником, текст прежний', async () => {
      const env = runtimeFor(story())
      const { master, requests } = fakeMaster([
        () => aiResponse({ text: 'Гуннар протягивает тебе пару монет за помощь.', toolCalls: [endTurn()] }),
        () => aiResponse({ toolCalls: [toolCall('change_gold', { amount: 2, reason: 'за помощь', source: 'npc', from: 'Гуннар' }, 'fix')] }),
      ])
      const result = await runMasterTurn(master, story(), { verbosity: 'normal', context, runtime: env.runtime })
      expect(requests).toHaveLength(2)
      expect(reminderOf(requests[1])).toMatchObject({ role: 'user' })
      expect(reminderOf(requests[1]).content).toMatch(/^\[Код игры\] Текст не совпадает с состоянием игры: в рассказе герой что-то получил/)
      // Перед просьбой — ответ модели с end_turn и результат для него (иначе API не примет историю).
      expect(requests[1].messages.at(-3)).toMatchObject({ role: 'assistant', toolCalls: [{ name: 'end_turn' }] })
      expect(requests[1].messages.at(-2)).toMatchObject({ role: 'tool', toolCallId: 'end' })
      expect(requests[1].toolChoice).toBe('auto')
      expect(env.current().party[0].inventory.coins.gp).toBe(20)
      expect(result.text).toBe('Гуннар протягивает тебе пару монет за помощь.')
      expect(result.claims).toHaveLength(1)
      expect(result.changes.map((c) => c.text)).toEqual(['+2 зм (за помощь)'])
    })

    it('«одним ударом убиваю дракона»: ведущий записал победу без броска — после просьбы переписывает ответ', async () => {
      const env = runtimeFor(story())
      const { master, requests } = fakeMaster([
        () => aiResponse({ text: 'Ты одним ударом убиваешь Брама — он падает замертво.', toolCalls: [endTurn()] }),
        () => aiResponse({ text: 'Ты замахиваешься, но Брам перехватывает руку: «Полегче, приятель». Что дальше?' }),
      ])
      const result = await runMasterTurn(master, story(), { verbosity: 'normal', context, runtime: env.runtime })
      expect(reminderOf(requests[1]).content).toContain('противник убит или побеждён, но бросков движка за ход не было')
      expect(result.text).toBe('Ты замахиваешься, но Брам перехватывает руку: «Полегче, приятель». Что дальше?')
      expect(env.committed).toEqual([])
    })

    it('рассказ уже в ленте (перед инструментами) — исправление заменяет его (masterRewritten), а не дописывается', async () => {
      const env = runtimeFor(story())
      const { master } = fakeMaster([
        () => aiResponse({ text: 'Ты находишь в бочке кошель с серебром.', toolCalls: [toolCall('note_fact', { text: 'В кладовой есть бочки.' }, 'n')] }),
        () => aiResponse({ toolCalls: [endTurn()] }),
        () => aiResponse({ text: 'Ты шаришь в бочке — только мука и солонина.' }),
      ])
      const result = await runMasterTurn(master, story(), { verbosity: 'normal', context, runtime: env.runtime })
      expect(env.committed).toEqual(['masterNarrated', 'factRecorded', 'masterRewritten'])
      expect(env.current().messages.at(-1)?.text).toBe('Ты шаришь в бочке — только мука и солонина.')
      expect(result.text).toBe('')
    })

    it('ранение словами: «дубинка задевает тебя» без change_hp — довызов кубиками движка', async () => {
      const env = runtimeFor(story(), [0.99])
      const { master } = fakeMaster([
        () => aiResponse({ text: 'Дубинка задевает тебя по плечу.', toolCalls: [endTurn()] }),
        () => aiResponse({ toolCalls: [toolCall('change_hp', { kind: 'damage', dice: '1d4', damage_type: 'bludgeoning', source: 'дубинка' }, 'hp')] }),
      ])
      const result = await runMasterTurn(master, story(), { verbosity: 'normal', context, runtime: env.runtime })
      expect(env.committed).toEqual(['diceRolled', 'hpChanged'])
      expect(env.current().party[0].character.hp).toBe(8)
      expect(result.text).toBe('Дубинка задевает тебя по плечу.')
    })

    it('честный ход без утверждений, отрицания и согласованные изменения — без лишнего запроса', async () => {
      for (const text of ['Ты обыскиваешь стол, но ничего не находишь. Гуннар хмыкает.', 'Ты не получаешь ответа — стражник отворачивается.']) {
        const env = runtimeFor(story())
        const { master, requests } = fakeMaster([() => aiResponse({ text, toolCalls: [endTurn()] })])
        const result = await runMasterTurn(master, story(), { verbosity: 'normal', context, runtime: env.runtime })
        expect(requests).toHaveLength(1)
        expect(result.claims).toBeUndefined()
      }
      const env = runtimeFor(story())
      const { master, requests } = fakeMaster([
        () => aiResponse({ toolCalls: [toolCall('give_item', { item: 'Кинжал', source: 'location', from: 'storage-barrel-4' }, 'g')] }),
        () => aiResponse({ text: 'Ты находишь в заколоченной бочке старый кинжал.', toolCalls: [endTurn([{ kind: 'item', item: 'Кинжал', amount: 1 }])] }),
      ])
      await runMasterTurn(master, story(), { verbosity: 'normal', context, runtime: env.runtime })
      expect(requests).toHaveLength(2)
    })

    it('просят один раз: если и после просьбы текст расходится — ход заканчивается', async () => {
      const env = runtimeFor(story())
      const { master, requests } = fakeMaster([
        () => aiResponse({ text: 'Брам отдаёт тебе свой меч.', toolCalls: [endTurn()] }),
        () => aiResponse({ text: 'Брам отдаёт тебе свой меч, улыбаясь.' }),
      ])
      const result = await runMasterTurn(master, story(), { verbosity: 'normal', context, runtime: env.runtime })
      expect(requests).toHaveLength(2)
      expect(result.text).toBe('Брам отдаёт тебе свой меч, улыбаясь.')
    })

    it('вопрос вне игры — без сверки текста', async () => {
      const env = runtimeFor(asked('Что будет, если я найду доспех?'))
      const { master, requests } = fakeMaster([() => aiResponse({ text: 'Если ты находишь доспех, мастер вызывает give_item с источником.' })])
      await runMasterTurn(master, asked('Что будет, если я найду доспех?'), { verbosity: 'normal', context, runtime: env.runtime })
      expect(requests).toHaveLength(1)
    })
  })
})
