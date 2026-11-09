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

/**
 * Улица 12×8 — просто новое место, не окрестности таверны (выход назад не ведёт в здание; окрестности здания строит
 * движок — тесты каркаса ниже и в surroundings.test.ts).
 */
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
    { id: 'to-tavern', kind: 'road', name: 'Дверь таверны', x: 5, y: 7 },
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
  it('у таверны есть выход — входная дверь; карты снаружи нет — движок сам строит каркас окрестностей', () => {
    const s = applyAction(null, created)
    expect(findExit(tavern, 'tavern-door')).toMatchObject({ kind: 'door', door: 'entrance', x: 10, y: 13 })
    expect(findExit(tavern, 'входная ДВЕРЬ')?.id).toBe('tavern-door')
    const plan = travelPlan(s, 'tavern-door')
    if (typeof plan === 'string') throw new Error(plan)
    expect(plan.built).toBe(true)
    expect(plan.events.map((e) => e.type)).toEqual(['locationCreated', 'exitLinked', 'partyTraveled'])
    expect(plan.to).toMatchObject({ id: 'drunken-griffin-outside', width: 60, height: 42 })
    // Герой — у нарисованной входной двери снаружи.
    expect(plan.at).toEqual({ x: 30, y: 28 })
    // Не дверь здания (дорога, край карты) — карту по-прежнему создаёт ведущий.
    expect(missingMapNote(tavern, findExit(tavern, 'tavern-door')!, 'Ратибор')).toContain('toExit: "tavern-door"')
  })

  it('travel через дверь: каркас, выходы связаны, путь обновлён; обратно — у двери таверны; повторно — та же карта', () => {
    seq = 1
    log.length = 1
    let s = applyAction(null, created)
    const go = tool(s, 'travel', { exit: 'tavern-door' })
    expect(go.out.ok).toBe(true)
    expect(go.out.result.message).toContain('Карту окрестностей построил движок')
    s = go.state
    const outside = 'drunken-griffin-outside'
    expect(s.world.currentLocationId).toBe(outside)
    expect(s.party[0].position).toEqual({ x: 30, y: 28 })
    expect(s.world.locations[tavern.id].exits?.[0]).toMatchObject({ to: outside, toExit: 'to-drunken-griffin' })
    expect(s.world.locations[outside].exits?.find((e) => e.to === tavern.id)).toMatchObject({ id: 'to-drunken-griffin', toExit: 'tavern-door', kind: 'door' })
    expect(trailOf(s)).toEqual([tavern.id, outside])
    expect(gameStateText(s, { catalog: itemCatalog, rules: rulesData })).toContain('### Снаружи: Таверна «Пьяный грифон»')

    // Обратно: к нарисованной двери ведёт выход в таверну; герой у входной двери внутри.
    s = tool(s, 'travel', { exit: 'to-drunken-griffin' }).state
    expect(s.world.currentLocationId).toBe(tavern.id)
    expect(s.party[0].position).toEqual({ x: 10, y: 13 })
    expect(trailOf(s)).toEqual([tavern.id, outside, tavern.id])
    // Повторный уход — та же карта, без нового создания и без лишних связей.
    const again = tool(s, 'travel', { exit: 'tavern-door' })
    expect(again.out.events.map((e) => e.event.type)).toEqual(['partyTraveled'])
    expect(again.state.world.locations[outside]).toEqual(go.state.world.locations[outside])
    expect(Object.keys(again.state.world.locations)).toEqual([tavern.id, outside])
    // Всё воспроизводится из журнала.
    expect(replay(log)).toEqual(again.state)
  })

  it('create_location + travel в просто новое место (не окрестности здания): отряд у playerStart', () => {
    let s = applyAction(null, created)
    s = tool(s, 'create_location', { location: street }).state
    s = tool(s, 'travel', { exit: 'tavern-door', to: 'griffin-street' }).state
    expect(s.world.currentLocationId).toBe('griffin-street')
    expect(s.party[0].position).toEqual({ x: 5, y: 6 })
  })

  it('туман: исследованное — своё у каждой карты; на новой видно новое, старое не теряется', () => {
    let s = applyAction(null, created)
    const seenTavern = newlyExplored(s, tavern, partyVision(tavern, s, rulesData))
    s = applyAction(s, makeAction('s1', 1, { type: 'areaExplored', locationId: tavern.id, cells: seenTavern }, { kind: 'system' }, 2, 'x1'))
    s = tool(s, 'travel', { exit: 'tavern-door' }).state
    const streetLoc = s.world.locations['drunken-griffin-outside']
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
    s = tool(s, 'travel', { exit: 'to-tavern', to: tavern.id }).state
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
