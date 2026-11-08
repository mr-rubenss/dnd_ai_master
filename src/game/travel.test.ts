// Переходы между картами: выход таверны → новая улица (create_location + travel), герой у соответствующего входа,
// обратный путь, связи выходов (exitLinked), путь отряда, проверки действий и отказы инструмента travel.
import { describe, expect, it } from 'vitest'
import type { AiToolCall } from '../ai/types'
import { itemCatalog, priceList, rulesData } from '../data'
import adventureJson from '../data/adventures/drunken-griffin.json'
import fighterJson from '../data/characters/fighter-ratibor.json'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import type { StoryEvent, StoryState } from '../types/story'
import { parseAdventure } from './adventure'
import { parseCharacterSheet } from './character'
import { parseLocation } from './location'
import { gameStateText } from './masterState'
import { executeTool, type ToolContext } from './masterTools'
import { applyAction, checkAction, ENGINE, makeAction, MASTER, newStorySeed, player, replay } from './storyActions'
import { arrivalCells, findExit, missingMapNote, nextTrail, trailOf, TRAIL_MAX, travelPlan } from './travel'
import { exploredCells, newlyExplored, partyVision } from './vision'

const tavern = parseLocation(drunkenGriffinJson)
const locations = { [tavern.id]: tavern }
const adventure = parseAdventure(adventureJson, locations)
const ratibor = parseCharacterSheet(fighterJson, itemCatalog)
const HERO = ratibor.character.id
const ctx: ToolContext = { catalog: itemCatalog, rules: rulesData, prices: priceList, now: () => 1000, newId: () => 'id1' }
const created = makeAction('s1', 0, { type: 'storyCreated', seed: newStorySeed({ id: 's1', title: 'Т', tone: 'detective', adventure, locations, party: [ratibor], now: 1 }) }, ENGINE, 1, 'c')
const call = (name: string, args: unknown): AiToolCall => ({ id: `c-${name}`, name, arguments: args, rawArguments: JSON.stringify(args) })

/** Улица у таверны: дверь таверны ведёт назад (к выходу tavern-door), на восток — край карты. */
const street = {
  id: 'griffin-street',
  name: 'Улица у таверны',
  description: 'Грязная улица под фонарём.',
  cellFeet: 5,
  width: 12,
  height: 8,
  floor: 'dirt',
  wallMaterial: 'stone',
  rooms: [{ id: 'street', name: 'Улица', x: 0, y: 0, w: 12, h: 8 }],
  objects: [{ id: 'cart', type: 'debris', name: 'Телега', x: 3, y: 4, w: 2 }],
  npcs: [{ id: 'beggar', name: 'Нищий', x: 6, y: 6 }],
  exits: [
    { id: 'to-tavern', kind: 'road', name: 'Дверь таверны', x: 5, y: 7, to: tavern.id },
    { id: 'east-road', kind: 'edge', name: 'Дорога на восток', x: 11, y: 4 },
  ],
  playerStart: { x: 5, y: 6 },
}

/** Выполнить инструмент и записать его действия (как ход ведущего). */
let seq = 1
const log = [created]
function tool(state: StoryState, name: string, args: unknown) {
  const out = executeTool(state, call(name, args), ctx)
  let next = state
  for (const { event, author } of out.events) {
    const action = makeAction('s1', seq++, event, author, 10 + seq, `a${seq}`)
    expect(checkAction(next, action, { catalog: itemCatalog })).toBeNull()
    log.push(action)
    next = applyAction(next, action)
  }
  return { out, state: next }
}

describe('переход между картами', () => {
  it('у таверны есть выход — входная дверь; карты за ним нет — travel просит создать её', () => {
    const s = applyAction(null, created)
    expect(findExit(tavern, 'tavern-door')).toMatchObject({ kind: 'door', door: 'entrance', x: 10, y: 13 })
    expect(findExit(tavern, 'входная ДВЕРЬ')?.id).toBe('tavern-door')
    const plan = travelPlan(s, 'tavern-door')
    expect(plan).toContain('Карты места за выходом «Входная дверь» ещё нет')
    expect(plan).toContain('create_location')
    const out = executeTool(s, call('travel', { exit: 'tavern-door' }), ctx)
    expect(out.ok).toBe(false)
    expect(out.events).toEqual([])
    expect(missingMapNote(tavern, findExit(tavern, 'tavern-door')!, 'Ратибор')).toContain('toExit: "tavern-door"')
  })

  it('create_location + travel: отряд на новой карте у входа, выходы связаны, путь обновлён; обратно — у двери таверны', () => {
    seq = 1
    log.length = 1
    let s = applyAction(null, created)
    s = tool(s, 'create_location', { location: street }).state
    const go = tool(s, 'travel', { exit: 'tavern-door', to: 'griffin-street' })
    expect(go.out.ok).toBe(true)
    expect(go.out.result.message).toContain('Отряд перешёл через выход «Входная дверь»')
    s = go.state
    expect(s.world.currentLocationId).toBe('griffin-street')
    // Вход новой карты — выход, ведущий обратно (to-tavern, клетка (5, 7)).
    expect(s.party[0].position).toEqual({ x: 5, y: 7 })
    expect(s.world.locations[tavern.id].exits?.[0]).toMatchObject({ to: 'griffin-street', toExit: 'to-tavern' })
    expect(s.world.locations['griffin-street'].exits?.[0]).toMatchObject({ to: tavern.id, toExit: 'tavern-door' })
    expect(trailOf(s)).toEqual([tavern.id, 'griffin-street'])
    expect(gameStateText(s, { catalog: itemCatalog, rules: rulesData })).toContain('### Улица у таверны')

    // Обратно: связь уже есть — travel без to; герой у входной двери таверны.
    s = tool(s, 'travel', { exit: 'Дверь таверны' }).state
    expect(s.world.currentLocationId).toBe(tavern.id)
    expect(s.party[0].position).toEqual({ x: 10, y: 13 })
    expect(trailOf(s)).toEqual([tavern.id, 'griffin-street', tavern.id])
    // Повторный уход — та же карта, без нового создания и без лишних связей.
    const again = tool(s, 'travel', { exit: 'tavern-door' })
    expect(again.out.events.map((e) => e.event.type)).toEqual(['partyTraveled'])
    expect(again.state.world.locations['griffin-street']).toEqual(go.state.world.locations['griffin-street'])
    // Всё воспроизводится из журнала.
    expect(replay(log)).toEqual(again.state)
  })

  it('туман: исследованное — своё у каждой карты; на новой видно новое, старое не теряется', () => {
    let s = applyAction(null, created)
    const seenTavern = newlyExplored(s, tavern, partyVision(tavern, s, rulesData))
    s = applyAction(s, makeAction('s1', 1, { type: 'areaExplored', locationId: tavern.id, cells: seenTavern }, { kind: 'system' }, 2, 'x1'))
    s = tool(s, 'create_location', { location: street }).state
    s = tool(s, 'travel', { exit: 'tavern-door', to: 'griffin-street' }).state
    const streetLoc = s.world.locations['griffin-street']
    expect(exploredCells(s, streetLoc).size).toBe(0)
    expect(newlyExplored(s, streetLoc, partyVision(streetLoc, s, rulesData)).length).toBeGreaterThan(0)
    expect(exploredCells(s, tavern).size).toBe(seenTavern.length)
  })

  it('запертая дверь-выход и несуществующий выход — отказ с причиной', () => {
    let s = applyAction(null, created)
    s = applyAction(s, makeAction('s1', 1, { type: 'doorChanged', locationId: tavern.id, doorId: 'entrance', state: 'locked' }, MASTER, 2, 'd'))
    expect(travelPlan(s, 'tavern-door')).toBe('«Входная дверь» заперта — сначала её нужно отпереть.')
    expect(travelPlan(s, 'окно')).toBe('Выхода «окно» здесь нет. Есть: Входная дверь [tavern-door].')
  })

  it('partyTraveled и exitLinked — только движок; клетки героев проверяются', () => {
    let s = applyAction(null, created)
    s = tool(s, 'create_location', { location: street }).state
    const ev = (positions: Record<string, { x: number; y: number }>): StoryEvent => ({ type: 'partyTraveled', from: tavern.id, to: 'griffin-street', exitId: 'tavern-door', positions })
    const check = (event: StoryEvent, author = ENGINE) => checkAction(s, makeAction('s1', 9, event, author, 2, 'p'), { catalog: itemCatalog })
    expect(check(ev({ [HERO]: { x: 5, y: 7 } }))).toBeNull()
    expect(check(ev({ [HERO]: { x: 5, y: 7 } }), MASTER)).toContain('переводит на другую карту движок')
    expect(check(ev({ [HERO]: { x: 5, y: 7 } }), player(HERO))).toContain('переводит на другую карту движок')
    expect(check(ev({ [HERO]: { x: 6, y: 6 } }))).toBe('Клетка (6, 6) в новой локации занята: НПС «Нищий».')
    expect(check(ev({ [HERO]: { x: 40, y: 7 } }))).toContain('нужна клетка пола')
    expect(check(ev({}))).toContain('нужна клетка пола')
    expect(check({ ...ev({ [HERO]: { x: 5, y: 7 } }), to: 'nowhere' } as StoryEvent)).toBe('В мире этой истории нет такой локации.')
    expect(check({ ...ev({ [HERO]: { x: 5, y: 7 } }), exitId: 'nope' } as StoryEvent)).toBe('В текущей локации нет такого выхода.')
    expect(check({ ...ev({ [HERO]: { x: 5, y: 7 } }), from: 'griffin-street' } as StoryEvent)).toBe('Отряд уходит только из текущей локации.')
    const link: StoryEvent = { type: 'exitLinked', locationId: tavern.id, exitId: 'tavern-door', to: 'griffin-street', toExit: 'to-tavern' }
    expect(check(link)).toBeNull()
    expect(check(link, MASTER)).toBe('Выходы связывает движок при переходе.')
    expect(check({ ...link, to: 'nowhere' })).toBe('Выход может вести только в существующую локацию.')
    expect(check({ ...link, toExit: 'nope' })).toBe('В локации назначения нет такого входа.')
  })

  it('выход ведёт в другую локацию — travel в третью не пускает', () => {
    let s = applyAction(null, created)
    s = tool(s, 'create_location', { location: street }).state
    s = tool(s, 'create_location', { location: { ...street, id: 'cellar', name: 'Подвал' } }).state
    s = tool(s, 'travel', { exit: 'tavern-door', to: 'griffin-street' }).state
    s = tool(s, 'travel', { exit: 'to-tavern' }).state
    expect(travelPlan(s, 'tavern-door', 'cellar')).toBe('Выход «Входная дверь» ведёт в «Улица у таверны» [griffin-street], а не в [cellar].')
  })

  it('без входа в новой карте — у playerStart; занятая клетка — ближайшая свободная', () => {
    expect(arrivalCells(tavern, {}, { x: 7, y: 1 }, 1)).not.toEqual([{ x: 7, y: 1 }]) // Гуннар стоит там
    expect(arrivalCells(tavern, {}, { x: 10, y: 13 }, 2)).toEqual([
      { x: 10, y: 13 },
      { x: 10, y: 12 },
    ])
    let s = applyAction(null, created)
    const noBack = { ...street, exits: [{ id: 'east-road', kind: 'edge', name: 'Дорога', x: 11, y: 4 }] }
    s = tool(s, 'create_location', { location: noBack }).state
    s = tool(s, 'travel', { exit: 'tavern-door', to: 'griffin-street' }).state
    expect(s.party[0].position).toEqual({ x: 5, y: 6 })
  })

  it('путь отряда: без повторов подряд, не длиннее TRAIL_MAX', () => {
    expect(nextTrail(['a'], 'a')).toEqual(['a'])
    const long = Array.from({ length: TRAIL_MAX }, (_, i) => `l${i}`)
    expect(nextTrail(long, 'x')).toEqual([...long.slice(1), 'x'])
  })
})
