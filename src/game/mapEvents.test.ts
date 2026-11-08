import { describe, expect, it } from 'vitest'
import { aiResponse, fakeMaster } from '../ai/testing'
import { itemCatalog, rulesData } from '../data'
import adventureJson from '../data/adventures/drunken-griffin.json'
import fighterJson from '../data/characters/fighter-ratibor.json'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import reactionsJson from '../data/map-reactions.json'
import type { CellPosition } from '../types/location'
import type { ActionAuthor, StoryEvent, StoryState } from '../types/story'
import { parseAdventure } from './adventure'
import { parseCharacterSheet } from './character'
import { LocationValidationError, parseLocation } from './location'
import {
  heroSurroundings,
  MAP_REACTIONS,
  moveReportEvent,
  moveSignificance,
  parseMapReactions,
  pendingMoveText,
  reactionDue,
  surroundingsText,
  type MapReactionConfig,
} from './mapEvents'
import { chatToAi, MAP_EVENT_MARK, MOVE_MARK } from './masterPrompt'
import { gameStateText } from './masterState'
import { runMasterTurn } from './masterTurn'
import { applyAction, checkAction, ENGINE, makeAction, MASTER, newStorySeed, player, replay } from './storyActions'

const location = parseLocation(drunkenGriffinJson)
const locations = { [location.id]: location }
const adventure = parseAdventure(adventureJson, locations)
const ratibor = parseCharacterSheet(fighterJson, itemCatalog)
const ctx = { catalog: itemCatalog, rules: rulesData }
const HERO = 'ratibor'

let seq = 0
function start(): StoryState {
  seq = 0
  return applyAction(null, makeAction('s1', seq++, { type: 'storyCreated', seed: newStorySeed({ id: 's1', title: 'Т', tone: 'detective', adventure, locations, party: [ratibor], now: 1 }) }, ENGINE, 1, 'c'))
}
/** Действие через проверку движка (как в игре). */
function act(state: StoryState, event: StoryEvent, author: ActionAuthor = player(HERO)): StoryState {
  const action = makeAction(state.id, seq++, event, author, 2 + seq, `a${seq}`)
  const reason = checkAction(state, action, ctx)
  if (reason) throw new Error(reason)
  return applyAction(state, action)
}
const move = (state: StoryState, to: CellPosition) => act(state, { type: 'heroMoved', heroId: HERO, to })
const hero = (state: StoryState) => state.party[0]
/** Только эти правила значимости включены. */
const only = (...ids: string[]): MapReactionConfig => ({ ...MAP_REACTIONS, rules: MAP_REACTIONS.rules.map((r) => ({ ...r, enabled: ids.includes(r.id) })) })

describe('настройки реакций карты (src/data/map-reactions.json)', () => {
  it('файл проходит проверку: все четыре правила, пауза между реакциями', () => {
    expect(MAP_REACTIONS.rules.map((r) => r.id)).toEqual(['entered-room', 'adjacent-npc', 'hidden-zone', 'hid-from-sight'])
    expect(MAP_REACTIONS.cooldownSeconds).toBeGreaterThan(0)
  })
  it('ошибки конфига — списком', () => {
    expect(() => parseMapReactions({ ...reactionsJson, cooldownSeconds: -1, rules: [{ id: 'teleport', enabled: true, title: 'x' }] })).toThrow(
      /"cooldownSeconds" — целое не меньше 0[\s\S]*rules\[0\]: "id" — одно из/,
    )
    expect(() => parseMapReactions({ ...reactionsJson, rules: [reactionsJson.rules[0], reactionsJson.rules[0]] })).toThrow(/повторяется/)
  })
  it('защита от лишних запросов: не чаще одной реакции за cooldownSeconds', () => {
    const config = { cooldownSeconds: 20 }
    expect(reactionDue(null, 1000, config)).toBe(true)
    expect(reactionDue(1000, 1000 + 19_999, config)).toBe(false)
    expect(reactionDue(1000, 1000 + 20_000, config)).toBe(true)
  })
})

describe('обстановка вокруг героя', () => {
  it('на входе: комната, ближайшее с расстоянием в футах, кто видит, укрытия нет', () => {
    const s = heroSurroundings(start(), location, hero(start()), MAP_REACTIONS)
    expect(s.room).toBe('Общий зал')
    expect(s.nearby[0]).toEqual({ name: 'Факел', kind: 'object', feet: 10 })
    expect(s.nearby).toContainEqual({ name: 'Стол у входа', kind: 'object', feet: 20 })
    // Стены между залом и стойкой нет (проём) — Гуннар за стойкой видит вход.
    expect(s.seenBy).toEqual(expect.arrayContaining(['Гуннар', 'Тобиас', 'Брам', 'Лиара']))
    expect(s.cover).toEqual([])
    expect(surroundingsText(s)).toMatch(/^Ратибор — «Общий зал», клетка \(10, 13\); рядом: Факел \(10 фт\.\)/)
  })

  it('укрытие: стол между героем и теми, кто сидит за ним', () => {
    const state = move(start(), { x: 11, y: 7 })
    const s = heroSurroundings(state, location, hero(state), MAP_REACTIONS)
    expect(s.cover).toContainEqual({ name: 'Центральный стол', from: expect.arrayContaining(['Брам', 'Лиара']) })
    expect(surroundingsText(s)).toContain('укрытие рядом: Центральный стол (между ним и ')
  })

  it('кто не видит: стены кладовой закрывают героя от Тобиаса', () => {
    let state = move(start(), { x: 13, y: 3 })
    state = move(state, { x: 14, y: 0 })
    const s = heroSurroundings(state, location, hero(state), MAP_REACTIONS)
    expect(s.unseenBy).toContain('Тобиас')
    expect(s.seenBy).toContain('Гуннар')
  })

  it('в состоянии игры — раздел «Где герои» и скрытые зоны (только ведущему)', () => {
    const text = gameStateText(move(start(), { x: 11, y: 7 }), ctx)
    expect(text).toContain('## Где герои (карта; учитывай в описаниях)\n- Ратибор — «Общий зал», клетка (11, 7); рядом:')
    expect(text).toContain('Скрытые зоны (игрок их не видит')
    expect(text).toContain('- Скрипучие половицы — опасное место, клетки 13–14 × 1–2')
  })
})

describe('склейка мелких перемещений и отправка с репликой игрока', () => {
  it('несколько шагов подряд — одно перемещение: начало первого, конец последнего, футы суммой', () => {
    let state = move(start(), { x: 9, y: 13 })
    state = move(state, { x: 8, y: 12 })
    state = move(state, { x: 8, y: 11 })
    expect(state.pendingMoves?.[HERO]).toMatchObject({ from: { x: 10, y: 13 }, to: { x: 8, y: 11 }, feet: 15, moves: 3, rooms: ['hall'], zones: [] })
    const text = pendingMoveText(state, location, HERO, MAP_REACTIONS)!
    expect(text).toMatch(/^Ратибор прошёл 15 фт\. \(3 перемещения подряд\) из клетки \(10, 13\) \(«Общий зал»\)\. Сейчас: Ратибор — «Общий зал», клетка \(8, 11\)/)
  })

  it('уходит ведущему с репликой игрока и снимается; в запросе — пометка перед репликой', () => {
    let state = move(start(), { x: 9, y: 13 })
    const text = pendingMoveText(state, location, HERO, MAP_REACTIONS)!
    state = act(state, { type: 'playerSpoke', heroId: HERO, messageId: 'p1', text: 'Оглядываюсь.', move: text })
    expect(state.pendingMoves).toBeUndefined()
    expect(chatToAi(state, state.messages.at(-1)!)).toEqual({ role: 'user', content: `${MOVE_MARK} ${text}\nОглядываюсь.` })
    // Без новых шагов — пометки нет.
    expect(pendingMoveText(state, location, HERO, MAP_REACTIONS)).toBeNull()
  })

  it('вопрос вне игры перемещения не забирает', () => {
    let state = move(start(), { x: 9, y: 13 })
    state = act(state, { type: 'playerSpoke', heroId: HERO, messageId: 'q', text: 'Как работает укрытие?', ooc: true })
    expect(state.pendingMoves?.[HERO]?.feet).toBe(5)
  })

  it('журнал воспроизводится в то же состояние', () => {
    const actions = [] as ReturnType<typeof makeAction>[]
    let state: StoryState | null = null
    seq = 0
    const push = (event: StoryEvent, author: ActionAuthor) => {
      const a = makeAction('s1', seq++, event, author, seq, `r${seq}`)
      actions.push(a)
      state = applyAction(state, a)
    }
    push({ type: 'storyCreated', seed: newStorySeed({ id: 's1', title: 'Т', tone: 'detective', adventure, locations, party: [ratibor], now: 1 }) }, ENGINE)
    push({ type: 'heroMoved', heroId: HERO, to: { x: 9, y: 12 } }, player(HERO))
    push({ type: 'heroMoved', heroId: HERO, to: { x: 9, y: 11 } }, player(HERO))
    expect(replay(actions).pendingMoves).toEqual(state!.pendingMoves)
  })
})

describe('значимые перемещения (правила из конфига)', () => {
  it('шаг по той же комнате — не значим', () => {
    const before = start()
    expect(moveSignificance(before, move(before, { x: 9, y: 13 }), HERO, location, MAP_REACTIONS).rules).toEqual([])
  })

  it('вошёл в новую комнату', () => {
    const before = start()
    const sig = moveSignificance(before, move(before, { x: 10, y: 4 }), HERO, location, MAP_REACTIONS)
    expect(sig.rules).toContain('entered-room')
    expect(sig.master).toContain('вошёл в «У стойки»')
  })

  it('подошёл вплотную к НПС', () => {
    const before = start()
    const sig = moveSignificance(before, move(before, { x: 18, y: 9 }), HERO, location, MAP_REACTIONS)
    expect(sig.rules).toEqual(['adjacent-npc'])
    expect(sig.player).toEqual(['подошёл вплотную к Тобиас'])
  })

  it('скрытая зона: ведущему — что там, игроку — ни слова', () => {
    const before = move(start(), { x: 12, y: 3 })
    const after = move(before, { x: 14, y: 1 })
    const sig = moveSignificance(before, after, HERO, location, only('hidden-zone'))
    expect(sig.rules).toEqual(['hidden-zone'])
    expect(sig.master[0]).toMatch(/^прошёл через скрытую зону «Скрипучие половицы» \(опасное место: /)
    expect(sig.player).toEqual([])
    const report = moveReportEvent(after, location, HERO, sig, only('hidden-zone'), 'e1')
    expect(report.text).toBe('Ратибор: перешёл на новое место.')
    expect(report.text).not.toContain('половиц')
    expect(report.note).toContain('Скрипучие половицы')
  })

  it('спрятался от чьего-то взгляда', () => {
    const before = move(start(), { x: 13, y: 3 })
    const sig = moveSignificance(before, move(before, { x: 14, y: 0 }), HERO, location, only('hid-from-sight'))
    expect(sig.rules).toEqual(['hid-from-sight'])
    expect(sig.master).toContain('скрылся от взгляда Тобиас')
    // Скрытый карманник — только ведущему.
    expect(sig.player).toEqual(['скрылся от взгляда Тобиас'])
  })

  it('выключенное в конфиге правило не срабатывает', () => {
    const before = start()
    expect(moveSignificance(before, move(before, { x: 18, y: 9 }), HERO, location, only('entered-room')).rules).toEqual([])
  })
})

describe('событие карты для ведущего: heroMoveReported', () => {
  const significant = () => {
    const before = start()
    const after = move(before, { x: 18, y: 9 })
    const sig = moveSignificance(before, after, HERO, location, MAP_REACTIONS)
    return { after, event: moveReportEvent(after, location, HERO, sig, MAP_REACTIONS, 'e1') }
  }

  it('только от движка; в ленте — строка игроку, перемещения сняты', () => {
    const { after, event } = significant()
    expect(checkAction(after, makeAction(after.id, 50, event, player(HERO), 9, 'z'), ctx)).toBe('О перемещениях героя ведущему сообщает движок.')
    expect(checkAction(after, makeAction(after.id, 50, event, MASTER, 9, 'z'), ctx)).toBe('О перемещениях героя ведущему сообщает движок.')
    const state = act(after, event, ENGINE)
    expect(state.pendingMoves).toBeUndefined()
    expect(state.messages.at(-1)).toMatchObject({ author: 'system', text: 'Ратибор: подошёл вплотную к Тобиас.', mapEvent: { note: expect.stringContaining('Значимо: подошёл вплотную к Тобиас') } })
    expect(chatToAi(state, state.messages.at(-1)!).content).toMatch(new RegExp(`^${MAP_EVENT_MARK.replace(/[[\]().]/g, '\\$&')} Значимо: подошёл вплотную к Тобиас\\. Ратибор прошёл`))
  })

  it('вопрос вне игры — событие не пишется (игра стоит)', () => {
    const { event } = significant()
    let state = act(start(), { type: 'playerSpoke', heroId: HERO, messageId: 'q', text: 'Вопрос?', ooc: true })
    state = move(state, { x: 18, y: 9 })
    expect(checkAction(state, makeAction(state.id, 60, event, ENGINE, 9, 'z'), ctx)).toMatch(/вопрос вне игры/)
  })

  it('ход ведущего с подменённым ответом: в запросе событие и «Где герои», ответ — короткая реакция', async () => {
    const { event } = significant()
    const state = act(significant().after, event, ENGINE)
    const { master, requests } = fakeMaster([() => aiResponse({ text: 'Тобиас поднимает глаза от кружки и щурится на тебя.' })])
    const result = await runMasterTurn(master, state, { verbosity: 'short', context: ctx })
    expect(result.text).toBe('Тобиас поднимает глаза от кружки и щурится на тебя.')
    const last = requests[0].messages.at(-1)!
    expect(last.role).toBe('user')
    expect(String(last.content)).toContain(MAP_EVENT_MARK)
    expect(String(last.content)).toContain('вплотную: Тобиас')
    expect(String(requests[0].messages[0].content)).toContain('## Где герои')
    expect(String(requests[0].messages[0].content)).toContain('## Карта: где стоит герой')
  })
})

describe('скрытые зоны в формате локации', () => {
  const base = drunkenGriffinJson as Record<string, unknown>
  it('у таверны — «Скрипучие половицы»', () => {
    expect(location.zones).toEqual([expect.objectContaining({ id: 'creaky-boards', kind: 'hazard', x: 13, y: 1, w: 2, h: 2 })])
  })
  it('неверный вид, выход за карту — ошибки', () => {
    const bad = (zones: unknown) => {
      try {
        parseLocation({ ...base, zones })
        return []
      } catch (e) {
        return (e as LocationValidationError).problems
      }
    }
    expect(bad([{ id: 'z', kind: 'pit', name: 'Яма', x: 1, y: 1, w: 1, h: 1 }])).toEqual(['zones[0] "z": "kind" должно быть одним из: trap, ambush, hazard, secret'])
    expect(bad([{ id: 'z', kind: 'trap', name: 'Яма', x: 19, y: 1, w: 3, h: 1 }])).toEqual(['zones[0] "z": зона выходит за пределы карты 20×14'])
    expect(bad([{ id: 'z', kind: 'trap', name: '', x: 1, y: 1, w: 0, h: 1 }])).toEqual(['zones[0] "z": "name" должно быть непустой строкой', 'zones[0] "z": "w" и "h" — положительные целые'])
  })
})
