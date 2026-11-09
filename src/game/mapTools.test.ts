// Инструменты карты: move_hero (к цели — объекту, НПС, двери; по сюжету — с причиной; в бою — по скорости), ping,
// add_effect / remove_effect, reveal и request_check с reveals; сверка рассказа с картой (mapClaims) и ход ведущего
// с подменённым ответом ИИ.
import { describe, expect, it } from 'vitest'
import { HERO_LEAVES, PARTY_ARRIVES } from './mapClaims'
import { aiResponse, fakeMaster } from '../ai/testing'
import type { AiToolCall } from '../ai/types'
import { itemCatalog, priceList, rulesData } from '../data'
import adventureJson from '../data/adventures/drunken-griffin.json'
import fighterJson from '../data/characters/fighter-ratibor.json'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import type { ActionAuthor, StoryEvent, StoryState } from '../types/story'
import { parseAdventure } from './adventure'
import { parseCharacterSheet } from './character'
import { heroMovePlan, heroReachable } from './heroMove'
import { LocationValidationError, parseLocation } from './location'
import { mapAreaCells } from './mapAreas'
import { mapProblems } from './mapClaims'
import { gameStateText } from './masterState'
import { executeTool, type ToolContext, type ToolOutcome } from './masterTools'
import { runMasterTurn } from './masterTurn'
import { applyAction, checkAction, ENGINE, makeAction, newStorySeed, player } from './storyActions'

const location = parseLocation(drunkenGriffinJson)
const locations = { [location.id]: location }
const adventure = parseAdventure(adventureJson, locations)
const ratibor = parseCharacterSheet(fighterJson, itemCatalog)
const LOC = location.id
const HERO = 'ratibor'
const face = (value: number, sides = 20) => (value - 0.5) / sides

function context(rolls: number[] = []): ToolContext {
  let n = 0
  return { catalog: itemCatalog, rules: rulesData, prices: priceList, rng: () => rolls.shift() ?? 0.5, now: () => 1000, newId: () => `id${++n}` }
}
const fresh = (): StoryState => newStorySeed({ id: 's1', title: 'Тест', tone: 'detective', adventure, locations, party: [ratibor], now: 1 })
const call = (name: string, args: unknown): AiToolCall => ({ id: `c-${name}`, name, arguments: args, rawArguments: JSON.stringify(args) })
let seq = 1
function run(state: StoryState, name: string, args: unknown, ctx = context()) {
  const outcome = executeTool(state, call(name, args), ctx)
  let next = state
  for (const { event, author } of outcome.events) {
    const action = makeAction(state.id, seq++, event, author, 1, `a${seq}`)
    expect(checkAction(next, action, { catalog: itemCatalog, rules: rulesData })).toBeNull()
    next = applyAction(next, action)
  }
  return { outcome, state: next }
}
function rejected(state: StoryState, name: string, args: unknown, ctx = context()): string {
  const outcome = executeTool(state, call(name, args), ctx)
  expect(outcome.ok).toBe(false)
  expect(outcome.events).toEqual([])
  return outcome.result.error as string
}
const hero = (s: StoryState) => s.party[0].position
const tavern = (s: StoryState) => s.world.locations[LOC]
const near = (a: { x: number; y: number }, area: { x: number; y: number; w?: number; h?: number }) =>
  a.x >= area.x - 1 && a.x <= area.x + (area.w ?? 1) && a.y >= area.y - 1 && a.y <= area.y + (area.h ?? 1)

describe('move_hero: к цели по пути, а не по координатам', () => {
  it('к стойке: движок сам находит свободную клетку рядом, герой идёт по пути (действие движка)', () => {
    const { outcome, state } = run(fresh(), 'move_hero', { target: 'bar' })
    expect(outcome.ok).toBe(true)
    expect(outcome.events[0]).toMatchObject({ event: { type: 'heroMoved', heroId: HERO }, author: ENGINE })
    const bar = location.objects.find((o) => o.id === 'bar')!
    expect(near(hero(state), bar)).toBe(true)
    expect(outcome.result.message).toMatch(/^Ратибор подходит к «Барная стойка»: клетка \(\d+, \d+\), \d+ фт\.$/)
    // Ведущий сам двигал героя — в перемещения для следующей реплики это не копится.
    expect(state.pendingMoves).toBeUndefined()
  })

  it('к НПС по имени и к двери; уже рядом — ничего не меняется', () => {
    const toTobias = run(fresh(), 'move_hero', { target: 'Тобиас' })
    expect(near(hero(toTobias.state), { x: 17, y: 9 })).toBe(true)
    const again = run(toTobias.state, 'move_hero', { target: 'tobias' })
    expect(again.outcome.events).toEqual([])
    expect(again.outcome.result.message).toBe('Ратибор уже рядом с «Тобиас».')
    const toDoor = run(fresh(), 'move_hero', { target: 'Входная дверь' })
    expect(hero(toDoor.state).y).toBe(13)
  })

  it('не дойти: заперта дверь — причина с названием двери, герой на месте', () => {
    const error = rejected(fresh(), 'move_hero', { target: 'storage-chest' })
    expect(error).toBe('Не дойти до «Окованный сундук»: путь перекрывает дверь «Дверь в кладовую» — она заперта. Ратибор остаётся на месте — обыграй это в рассказе.')
    expect(rejected(fresh(), 'move_hero', { target: 'люстра' })).toMatch(/^Цели «люстра» на карте нет\. Есть: Гуннар \(gunnar\)/)
  })

  it('координаты — только по сюжету и с причиной: без пути и без траты скорости', () => {
    expect(rejected(fresh(), 'move_hero', { x: 2, y: 12 })).toMatch(/^Координаты — только для перемещения по сюжету/)
    expect(rejected(fresh(), 'move_hero', { target: 'bar', x: 2, y: 12, reason: 'x' })).toMatch(/либо target/)
    expect(rejected(fresh(), 'move_hero', { x: 7, y: 1, reason: 'отбросило' })).toBe('Клетка занята: НПС «Гуннар».')
    const { state } = run(fresh(), 'move_hero', { x: 1, y: 12, reason: 'взрывом бочки отбросило к стене' })
    expect(hero(state)).toEqual({ x: 1, y: 12 })
    // Игрок сам «по сюжету» передвинуть героя не может.
    const forced = makeAction('s1', 99, { type: 'heroMoved', heroId: HERO, to: { x: 1, y: 12 }, forced: 'хочу' }, player(HERO), 1, 'f')
    expect(checkAction(fresh(), forced, { catalog: itemCatalog })).toBe('Перемещение по сюжету делает только движок.')
  })
})

describe('бой: перемещение тратит скорость', () => {
  const inCombat = () => run(fresh(), 'set_combat', { state: 'start' }).state

  it('set_combat: раунд 1, скорость героя из вида; в состоянии игры — раздел «Бой»', () => {
    const s = inCombat()
    expect(s.combat).toEqual({ round: 1, speed: { [HERO]: 30 }, moved: {} })
    expect(gameStateText(s, { catalog: itemCatalog, rules: rulesData })).toContain('## Бой (раунд 1)\nПеремещения героя тратят скорость. Осталось: Ратибор 30 из 30 фт.')
    expect(rejected(s, 'set_combat', { state: 'start' })).toBe('Бой уже идёт (раунд 1).')
    expect(rejected(fresh(), 'set_combat', { state: 'next_round' })).toBe('Боя нет — начни его: state: start.')
  })

  it('скорости не хватает — герой проходит, сколько может, игрок видит строку; дальше — в следующем раунде', () => {
    let s = inCombat()
    const far = run(s, 'move_hero', { target: 'barrel-1' })
    expect(far.outcome.ok).toBe(true)
    expect(far.outcome.result).toMatchObject({ feet: 30, short_by: expect.any(Number) })
    s = far.state
    expect(s.combat!.moved[HERO]).toBe(30)
    const note = s.messages.at(-1)!
    expect(note).toMatchObject({ author: 'system', mapNote: true })
    expect(note.text).toMatch(/^Ратибор: скорости хватило на 30 из \d+ фт\. — до «Бочка эля» ещё \d+ фт\.$/)
    // Скорость кончилась: и ведущему, и игроку (перетаскивание) — отказ.
    expect(rejected(s, 'move_hero', { target: 'barrel-1' })).toMatch(/^Идёт бой: скорость Ратибор в этом раунде кончилась \(осталось 0 фт\.\)/)
    expect(heroMovePlan(tavern(s), s, HERO, { x: hero(s).x, y: hero(s).y + 1 })).toBe('Идёт бой: в этом раунде осталось 0 фт. скорости, а путь — 5 фт.')
    expect(heroReachable(tavern(s), s, HERO).size).toBe(1)
    // Новый раунд — скорость снова есть; по сюжету скорость не тратится.
    s = run(s, 'set_combat', { state: 'next_round' }).state
    expect(s.combat).toMatchObject({ round: 2, moved: {} })
    expect(heroReachable(tavern(s), s, HERO).size).toBeGreaterThan(20)
    s = run(s, 'move_hero', { x: 10, y: 12, reason: 'толкнули' }).state
    expect(s.combat!.moved[HERO] ?? 0).toBe(0)
    s = run(s, 'set_combat', { state: 'end' }).state
    expect(s.combat).toBeUndefined()
  })
})

describe('ping, эффекты, скрытое', () => {
  it('ping: подсветка цели или клетки; скрытое не подсвечивается', () => {
    const { state } = run(fresh(), 'ping', { target: 'entrance', label: 'сюда' })
    expect(state.ping).toEqual({ id: 'ping-id1', locationId: LOC, x: 9, y: 13, w: 2, h: 1, label: 'сюда' })
    expect(run(fresh(), 'ping', { x: 3, y: 4 }).state.ping).toMatchObject({ x: 3, y: 4, w: 1, h: 1 })
    expect(rejected(fresh(), 'ping', { target: 'pickpocket' })).toBe('«Шнырь» скрыт от игрока — сначала reveal (или не показывай).')
  })

  it('add_effect / remove_effect: область на карте, в состоянии игры — список эффектов', () => {
    let s = run(fresh(), 'add_effect', { kind: 'fire', x: 9, y: 7, w: 2, h: 2, name: 'Горящий стол' }).state
    expect(tavern(s).effects).toEqual([{ id: expect.stringMatching(/^fx-/), kind: 'fire', name: 'Горящий стол', x: 9, y: 7, w: 2, h: 2 }])
    expect(gameStateText(s, { catalog: itemCatalog, rules: rulesData })).toMatch(/- Горящий стол \[fx-[^\]]+\] — огонь, клетки 9–10 × 7–8/)
    expect(rejected(s, 'add_effect', { kind: 'smoke', x: 19, y: 13, w: 3 })).toBe('Область выходит за карту 20×14.')
    expect(rejected(s, 'add_effect', { kind: 'lava', x: 1, y: 1 })).toMatch(/не из списка: fire, smoke, darkness, puddle, glow/)
    s = run(s, 'add_effect', { kind: 'smoke', x: 0, y: 6, w: 3, h: 3 }).state
    s = run(s, 'remove_effect', { effect: 'Горящий стол' }).state
    expect(tavern(s).effects!.map((e) => e.kind)).toEqual(['smoke'])
    s = run(s, 'remove_effect', { effect: 'дым' }).state
    expect(tavern(s).effects).toEqual([])
  })

  it('скрытые НПС и объекты: в состоянии игры с пометкой, reveal раскрывает; второй раз — отказ', () => {
    const text = gameStateText(fresh(), { catalog: itemCatalog, rules: rulesData })
    expect(text).toContain('- Шнырь [pickpocket] (19, 13) — СКРЫТ от игрока')
    expect(text).toContain('- Тайник за камнем [hearth-cache] (0, 9) — СКРЫТ от игрока')
    const s = run(fresh(), 'reveal', { target: 'Шнырь' }).state
    expect(tavern(s).npcs.find((n) => n.id === 'pickpocket')!.hidden).toBeUndefined()
    expect(rejected(s, 'reveal', { target: 'pickpocket' })).toMatch(/^Скрытого «pickpocket» здесь нет\. Есть: Тайник за камнем \(hearth-cache\)/)
    // Скрытый объект светом себя не выдаёт и мешает пройти «чем-то».
    expect(heroMovePlan(tavern(fresh()), fresh(), HERO, { x: 0, y: 9 })).toBe('Клетка занята: что-то (не видно, но мешает).')
  })

  it('request_check с reveals: успех раскрывает, провал — нет', () => {
    const args = { skill: 'investigation', dc: 12, reason: 'ищет тайник у камина', hidden: true, reveals: 'hearth-cache' }
    const ok = run(fresh(), 'request_check', args, context([face(18)]))
    expect(ok.outcome.result).toMatchObject({ success: true, revealed: 'Тайник за камнем' })
    expect(tavern(ok.state).objects.find((o) => o.id === 'hearth-cache')!.hidden).toBeUndefined()
    const fail = run(fresh(), 'request_check', args, context([face(2)]))
    expect(fail.outcome.result.success).toBe(false)
    expect(tavern(fail.state).objects.find((o) => o.id === 'hearth-cache')!.hidden).toBe(true)
    expect(rejected(fresh(), 'request_check', { ...args, reveals: 'bar' })).toMatch(/^Скрытого «bar» здесь нет/)
  })

  it('формат локации: hidden и effects проверяются', () => {
    const base = drunkenGriffinJson as Record<string, unknown>
    const problems = (patch: Record<string, unknown>) => {
      try {
        parseLocation({ ...base, ...patch })
        return []
      } catch (e) {
        return (e as LocationValidationError).problems
      }
    }
    expect(problems({ effects: [{ id: 'e', kind: 'acid', x: 1, y: 1, w: 1, h: 1 }] })).toEqual(['effects[0] "e": "kind" должно быть одним из: fire, smoke, darkness, puddle, glow'])
    expect(problems({ effects: [{ id: 'e', kind: 'fire', x: 1, y: 1, w: 1, h: 1 }] })).toEqual([])
    expect(problems({ npcs: [{ id: 'x', name: 'X', x: 1, y: 12, hidden: 'yes' }] })).toEqual(['npcs[0] "x": "hidden" — true или false'])
  })
})

describe('show_area: области воздействия на карте', () => {
  it('сфера от факела: событие ведущего, клетки и кто задет; игра не меняется', () => {
    const before = fresh()
    const { outcome, state } = run(before, 'show_area', { shape: 'sphere', size: 20, target: 'torch-door', label: 'Свет факела' })
    expect(outcome.events[0].author).toEqual({ kind: 'master' })
    expect(state.shownArea).toEqual({ id: 'area-id1', locationId: LOC, template: { shape: 'sphere', size: 20, origin: { x: 12.5, y: 13.5 } }, label: 'Свет факела' })
    expect(outcome.result.message).toMatch(/^На карте показана область от «Факел»\. Сфера 20 фт\.: \d+ кл\. Задеты: Ратибор\.$/)
    expect(outcome.result.creatures).toEqual(['Ратибор'])
    expect({ ...state, shownArea: undefined }).toEqual({ ...before, shownArea: undefined })
  })

  it('конус от героя к цели: начало у края клетки героя; скрытый НПС в списке с пометкой', () => {
    const s = fresh()
    const start = hero(s)
    const { outcome, state } = run(s, 'show_area', { shape: 'cone', size: 30, toward: 'Тобиас' })
    const t = state.shownArea!.template
    expect(t.shape).toBe('cone')
    expect(Math.max(Math.abs(t.origin.x - (start.x + 0.5)), Math.abs(t.origin.y - (start.y + 0.5)))).toBeCloseTo(0.5)
    expect(outcome.result.cells).toBeGreaterThan(0)
    const hidden = run(fresh(), 'show_area', { shape: 'sphere', size: 10, x: 18, y: 13 })
    expect(hidden.outcome.result.creatures).toEqual(['Шнырь (скрыт от игрока)'])
  })

  it('стены и запертая дверь укрывают: за дверью кладовой клеток нет, пока она не открыта', () => {
    const args = { shape: 'sphere', size: 10, x: 13, y: 1 }
    const cellsOf = (st: StoryState) => mapAreaCells(tavern(st), st.shownArea!.template, st.world.doors[LOC] ?? {})
    const locked = run(fresh(), 'show_area', args).state
    expect(cellsOf(locked).some((c) => c.x >= 15)).toBe(false)
    const opened = run(run(fresh(), 'set_door', { door: 'storage-door', state: 'open' }).state, 'show_area', args).state
    expect(cellsOf(opened)).toContainEqual({ x: 15, y: 1 })
    // Деревянная стена кладовой (y = 5) отделяет её от зала.
    const hall = run(fresh(), 'show_area', { shape: 'sphere', size: 10, x: 17, y: 6 }).state
    expect(cellsOf(hall).some((c) => c.y < 5 && c.x >= 15)).toBe(false)
    expect(cellsOf(hall)).toContainEqual({ x: 17, y: 5 })
  })

  it('недопустимые вызовы отклоняются с причиной', () => {
    expect(rejected(fresh(), 'show_area', { shape: 'cone', size: 15 })).toBe('У фигуры «Конус» нужно направление: toward или direction.')
    expect(rejected(fresh(), 'show_area', { shape: 'star', size: 15 })).toMatch(/не из списка: cone, cube, cylinder, emanation, line, sphere/)
    expect(rejected(fresh(), 'show_area', { shape: 'sphere', size: 0 })).toBe('Размер области — от 1 до 1000 футов.')
    expect(rejected(fresh(), 'show_area', { shape: 'sphere', size: 10, target: 'pickpocket' })).toBe('«Шнырь» скрыт от игрока — сначала reveal (или не показывай).')
    expect(rejected(fresh(), 'show_area', { shape: 'sphere', size: 10, target: 'дракон' })).toMatch(/^Цели «дракон» на карте нет/)
    expect(rejected(fresh(), 'show_area', { shape: 'sphere', size: 10, x: 3 })).toBe('Укажи и x, и y (или target).')
    expect(rejected(fresh(), 'show_area', { shape: 'line', size: 30, direction: 'up' })).toMatch(/не из списка: east, southeast/)
    expect(rejected(fresh(), 'show_area', { shape: 'sphere', size: 10, label: 'x'.repeat(41) })).toBe('Подпись — до 40 символов.')
  })

  it('движок не примет событие с неверным шаблоном', () => {
    const s = fresh()
    const bad = (template: unknown) =>
      checkAction(s, makeAction(s.id, 99, { type: 'areaShown', area: { id: 'a', locationId: LOC, template } } as StoryEvent, { kind: 'master' }, 1, 'x'), {
        catalog: itemCatalog,
        rules: rulesData,
      })
    expect(bad({ shape: 'sphere', size: 20, origin: { x: 50, y: 1 } })).toBe('Точка начала области за пределами карты.')
    expect(bad({ shape: 'line', size: 20, origin: { x: 5, y: 1 } })).toBe('У фигуры «Линия» нужно направление.')
    expect(bad(undefined)).toBe('Нет шаблона области.')
    expect(bad({ shape: 'sphere', size: 20, origin: { x: 5, y: 1 } })).toBeNull()
  })
})

describe('move_npc и add_npc: к цели, а не в клетку', () => {
  it('«Гуннар идёт к столу»: target — свободная клетка рядом со столом, ближе к тому, где он стоял', () => {
    const { outcome, state } = run(fresh(), 'move_npc', { npc: 'Гуннар', target: 'table-2' })
    const g = tavern(state).npcs.find((n) => n.id === 'gunnar')!
    expect(near(g, { x: 9, y: 7, w: 2, h: 2 })).toBe(true)
    expect(g.y).toBe(6)
    expect(outcome.result.message).toBe(`Гуннар — теперь в клетке (${g.x}, ${g.y}), рядом с «Центральный стол».`)
    // Уже рядом — ничего не меняется.
    const again = run(state, 'move_npc', { npc: 'gunnar', target: 'table-2' })
    expect(again.outcome.events).toEqual([])
    expect(again.outcome.result.message).toMatch(/^Гуннар уже рядом с «Центральный стол»/)
    // К герою и к другому НПС.
    expect(near(tavern(run(fresh(), 'move_npc', { npc: 'bram', target: 'Ратибор' }).state).npcs.find((n) => n.id === 'bram')!, { x: 10, y: 13 })).toBe(true)
    expect(near(tavern(run(fresh(), 'move_npc', { npc: 'bram', target: 'tobias' }).state).npcs.find((n) => n.id === 'bram')!, { x: 17, y: 9 })).toBe(true)
  })

  it('add_npc у входа: клетка героя занята — новый встаёт рядом с дверью, в зале', () => {
    const { outcome, state } = run(fresh(), 'add_npc', { name: 'Путник', target: 'entrance', description: 'Промокший путник.' })
    const p = tavern(state).npcs.find((n) => n.name === 'Путник')!
    expect(p).toMatchObject({ y: 13 })
    expect([9, 11]).toContain(p.x)
    expect(outcome.result.message).toMatch(/^Путник появляется в клетке \(\d+, 13\), рядом с «Входная дверь»\.$/)
  })

  it('отказы: занятая клетка — с подсказкой свободных; без места; без target и x, y; неизвестная цель', () => {
    expect(rejected(fresh(), 'add_npc', { name: 'Путник', x: 10, y: 13 })).toBe(
      'Клетка (10, 13) занята: герой Ратибор. Свободно рядом: (9, 12), (10, 12), (11, 12). Или укажи target — движок сам найдёт место.',
    )
    expect(rejected(fresh(), 'move_npc', { npc: 'gunnar', x: 9, y: 7 })).toMatch(/^Клетка \(9, 7\) занята: объект «Центральный стол»\. Свободно рядом: /)
    expect(rejected(fresh(), 'move_npc', { npc: 'gunnar' })).toBe('Укажи target (к чему идёт или где появляется) или x и y.')
    expect(rejected(fresh(), 'move_npc', { npc: 'gunnar', target: 'дракон' })).toMatch(/^Цели «дракон» на карте нет/)
    expect(rejected(fresh(), 'move_npc', { npc: 'gunnar', target: 'gunnar' })).toBe('Цель — сам этот НПС.')
    // Старый вызов с координатами работает как раньше.
    expect(tavern(run(fresh(), 'move_npc', { npc: 'gunnar', x: 8, y: 8 }).state).npcs.find((n) => n.id === 'gunnar')).toMatchObject({ x: 8, y: 8 })
  })
})

describe('сверка рассказа с картой', () => {
  const ok: ToolOutcome = { ok: true, result: { ok: true }, events: [] }
  const said = (text: string, extra = {}) => ({ id: 'p', author: 'player' as const, text, heroId: HERO, ...extra })

  it('НПС «уходит», а на карте на месте — просьба; убран или сдвинут — нет; отрицание — нет', () => {
    const before = fresh()
    expect(mapProblems('Тобиас допивает эль и уходит, хлопнув дверью.', before, before, [])).toEqual([
      'в рассказе Тобиас уходит, а на карте стоит на месте — вызови remove_npc (npc: tobias, reason: left) или move_npc, если он ещё в зале',
    ])
    const removed = run(before, 'remove_npc', { npc: 'tobias' }).state
    expect(mapProblems('Тобиас уходит.', before, removed, [])).toEqual([])
    expect(mapProblems('Тобиас не уходит — сидит и ждёт.', before, before, [])).toEqual([])
    // Скрытого не трогаем; разные падежи имени узнаются.
    expect(mapProblems('Гуннар подходит к тебе с кружкой.', before, before, [])).toEqual([
      'в рассказе Гуннар идёт, подходит или садится, а на карте не сдвинулся — вызови move_npc (npc: gunnar, target: id того, к чему идёт)',
    ])
  })

  it('передвижение НПС другими словами: идёт к, пересаживается, шагает, проходит, возвращается; отрицание — нет', () => {
    const before = fresh()
    const moves = [
      'Гуннар идёт к столу.',
      'Гуннар берёт кружку и пересаживается за центральный стол.',
      'Гуннар шагает к стойке.',
      'Гуннар встаёт и проходит к камину.',
      'Брам возвращается к стойке.',
      'Гуннар садится за стол у окна.',
      'Брам заходит за стойку.',
      'Лиара направляется к двери.',
    ]
    for (const text of moves) expect(mapProblems(text, before, before, []), text).toEqual([expect.stringMatching(/^в рассказе (Гуннар|Брам|Лиара) идёт, подходит или садится/)])
    for (const text of ['Гуннар не идёт к столу.', 'Гуннар сидит за столом.', 'Идёт дождь.', 'Гуннар смотрит, как идёт время.']) expect(mapProblems(text, before, before, []), text).toEqual([])
    const moved = run(before, 'move_npc', { npc: 'gunnar', target: 'table-2' }).state
    expect(mapProblems('Гуннар идёт к столу.', before, moved, [])).toEqual([])
  })

  it('кто-то новый входит или появляется в дверях, а на карте никого не прибавилось — просьба add_npc', () => {
    const before = fresh()
    const arrivals = [
      'Дверь хлопает — в таверну заходит новый посетитель.',
      'Входит высокая женщина в плаще.',
      'В дверях появляется стражник.',
      'На пороге стоит промокший гонец.',
      'В зал вваливаются трое наёмников.',
    ]
    for (const text of arrivals) expect(mapProblems(text, before, before, []), text).toEqual([expect.stringMatching(/^в рассказе появляется кто-то новый .* вызови add_npc \(target: id двери, через которую вошёл, например entrance\)/)])
    const calm = [
      'Никто не входит.',
      'На лице Гуннара появляется улыбка.',
      'Появляется запах жареного мяса.',
      'Ты входишь в таверну.',
      'Ратибор входит в зал.',
      'Брам заходит за стойку и наливает эль.',
    ]
    for (const text of calm) expect(mapProblems(text, before, before, []).filter((p) => p.includes('кто-то новый')), text).toEqual([])
    // Добавлен или раскрыт — просьбы нет.
    const added = run(before, 'add_npc', { name: 'Путник', target: 'entrance' }).state
    expect(mapProblems('В таверну заходит путник.', before, added, [])).toEqual([])
    const revealed = run(before, 'reveal', { target: 'pickpocket' }).state
    expect(mapProblems('Из тени у двери появляется щуплый парень.', before, revealed, [])).toEqual([])
  })

  it('игрок «подхожу к стойке», а герой не двинулся и move_hero не было — просьба', () => {
    const before = fresh()
    expect(mapProblems('Гуннар кивает.', before, before, [], said('Подхожу к стойке.'))[0]).toMatch(/^игрок перемещает героя \(«Подхожу к стойке\.»\), а на карте Ратибор стоит на месте — вызови move_hero/)
    // Вызов был (даже с отказом), герой уже пришёл сам перетаскиванием или это вопрос вне игры — без просьбы.
    expect(mapProblems('…', before, before, [{ call: call('move_hero', { target: 'bar' }), outcome: ok }], said('Подхожу к стойке.'))).toEqual([])
    expect(mapProblems('…', before, before, [], said('Подхожу к стойке.', { move: 'Ратибор прошёл 10 фт.' }))).toEqual([])
    expect(mapProblems('…', before, before, [], said('Как подхожу к стойке?', { ooc: true }))).toEqual([])
    expect(mapProblems('…', before, before, [], said('Заказываю эль.'))).toEqual([])
  })

  it('ход с подменённым ответом ИИ: «подхожу к стойке» без move_hero — просьба; ведущий довызывает, герой у стойки', async () => {
    let state = fresh()
    const author = player(HERO)
    const add = (event: StoryEvent, who: ActionAuthor) => (state = applyAction(state, makeAction(state.id, seq++, event, who, 2, `t${seq}`)))
    add({ type: 'playerSpoke', heroId: HERO, messageId: 'p1', text: 'Подхожу к стойке.' }, author)
    let n = 0
    const runtime = {
      getStory: () => state,
      commit: (event: StoryEvent, who: ActionAuthor) => {
        const action = makeAction(state.id, seq++, event, who, 5, `x${seq}`)
        const reason = checkAction(state, action, { catalog: itemCatalog, rules: rulesData })
        if (reason) return reason
        state = applyAction(state, action)
        return null
      },
      tools: { catalog: itemCatalog, rules: rulesData, now: () => 7, newId: () => `t${++n}` },
    }
    const end = { id: 'end', name: 'end_turn', arguments: { changes: [] }, rawArguments: '{"changes":[]}' }
    const { master, requests } = fakeMaster([
      () => aiResponse({ text: 'Ты облокачиваешься на стойку, Гуннар поднимает бровь.', toolCalls: [end] }),
      () => aiResponse({ text: '', toolCalls: [call('move_hero', { target: 'bar' })] }),
    ])
    const result = await runMasterTurn(master, state, { verbosity: 'short', context: { catalog: itemCatalog, rules: rulesData }, runtime })
    expect(String(requests[1].messages.at(-1)?.content)).toMatch(/^\[Код игры\] Текст не совпадает с состоянием игры: игрок перемещает героя/)
    expect(String(requests[1].messages.at(-1)?.content)).toContain('move_hero с target')
    expect(result.claims?.[0]).toMatch(/^игрок перемещает героя/)
    expect(near(hero(state), location.objects.find((o) => o.id === 'bar')!)).toBe(true)
    expect(result.text).toBe('Ты облокачиваешься на стойку, Гуннар поднимает бровь.')
  })
})

describe('сверка: уход в другое место без перехода', () => {
  it('узнаёт рассказ о прибытии и реплику «выхожу на улицу», но не «выхожу из-за стола»', () => {
    for (const t of ['Ты выходишь на улицу, моросит дождь.', 'Вы оказываетесь на площади.', 'Ты выходишь из таверны.', 'Ты спускаешься в подвал.'])
      expect(PARTY_ARRIVES.test(t), t).toBe(true)
    // «Ты на улице» без глагола движения — описание места (на карте улицы это не уход).
    for (const t of ['Ты не выходишь на улицу.', 'Ты выходишь из-за стола.', 'Гуннар выходит на улицу.', 'Ты подходишь к двери.', 'Ты уже снаружи.', 'Вы на улице, моросит.'])
      expect(PARTY_ARRIVES.test(t), t).toBe(false)
    expect(HERO_LEAVES.test('Выхожу на улицу.')).toBe(true)
    expect(HERO_LEAVES.test('Выхожу из-за стола.')).toBe(false)
    // Фразы из живого отчёта: неопределённая форма и слово между глаголом и местом.
    expect(HERO_LEAVES.test('Выйти из таверны')).toBe(true)
    expect(HERO_LEAVES.test('Покидаю таверну.')).toBe(true)
    expect(PARTY_ARRIVES.test('Вы разворачиваетесь и выходите обратно на улицу.')).toBe(true)
    expect(PARTY_ARRIVES.test('Вы уже снаружи.')).toBe(false)
  })
})
