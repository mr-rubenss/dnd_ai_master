// Окрестности здания: каркас строит движок из карты таверны (размер, контур, дверь на месте, дорога, забор, выходы),
// модель не может его затереть (stampBuilding в create_location), слишком маленькая карта окрестностей отклоняется,
// add_exit добавляет выходы.
import { describe, expect, it } from 'vitest'
import type { AiToolCall } from '../ai/types'
import { itemCatalog, priceList, rulesData } from '../data'
import adventureJson from '../data/adventures/drunken-griffin.json'
import fighterJson from '../data/characters/fighter-ratibor.json'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import { canStep, edgeContent, isFloor } from '../engine/movement'
import { gameTime } from '../engine/time'
import type { LocationData } from '../types/location'
import type { StoryState } from '../types/story'
import { parseAdventure } from './adventure'
import { parseCharacterSheet } from './character'
import { parseLocation } from './location'
import { createdLocationProblem } from './locationCreate'
import { executeTool, type ToolContext } from './masterTools'
import { applyAction, checkAction, ENGINE, makeAction, MASTER, newStorySeed, player } from './storyActions'
import {
  buildingFootprint,
  buildingFrame,
  buildingLinkOf,
  buildSurroundings,
  hasBuildingFrame,
  isBuildingDoorExit,
  stampBuilding,
  surroundingsSize,
} from './surroundings'

const tavern = parseLocation(drunkenGriffinJson)
const exit = tavern.exits![0]
const adventure = parseAdventure(adventureJson, { [tavern.id]: tavern })
const ratibor = parseCharacterSheet(fighterJson, itemCatalog)
const ctx: ToolContext = { catalog: itemCatalog, rules: rulesData, prices: priceList, now: () => 1000, newId: () => 'id1' }
const created = makeAction('s1', 0, { type: 'storyCreated', seed: newStorySeed({ id: 's1', title: 'Т', tone: 'detective', adventure, locations: { [tavern.id]: tavern }, party: [ratibor], now: 1 }) }, ENGINE, 1, 'c')
const fresh = (): StoryState => applyAction(null, created)
const call = (name: string, args: unknown): AiToolCall => ({ id: `c-${name}`, name, arguments: args, rawArguments: JSON.stringify(args) })
const frameOf = () => buildSurroundings(tavern, exit, { id: 'outside', time: gameTime(1, 19), doorState: 'closed' })!

describe('размер окрестностей', () => {
  it('таверна 20×14 → окрестности 60×42 (3 размера здания по каждой стороне); маленькое здание — не меньше 32×24', () => {
    expect(buildingFootprint(tavern)).toEqual({ x: 0, y: 0, w: 20, h: 14 })
    expect(surroundingsSize(tavern)).toEqual({ width: 60, height: 42 })
    const hut = parseLocation({ id: 'hut', name: 'Хижина', description: 'Хижина.', cellFeet: 5, width: 4, height: 3, floor: 'wood', wallMaterial: 'wood', rooms: [{ id: 'r', x: 0, y: 0, w: 4, h: 3 }], objects: [], npcs: [], playerStart: { x: 1, y: 1 } })
    expect(surroundingsSize(hut)).toEqual({ width: 32, height: 24 })
  })

  it('выход-дверь таверны — дверь наружу; дверь между комнатами — нет', () => {
    expect(isBuildingDoorExit(tavern, exit)).toBe(true)
    const inner = { id: 'storage', kind: 'door' as const, name: 'Кладовая', door: 'storage-door', x: 14, y: 1 }
    expect(isBuildingDoorExit(tavern, inner)).toBe(false)
    expect(isBuildingDoorExit(tavern, { ...exit, kind: 'road' })).toBe(false)
  })
})

describe('карта окрестностей сама — не здание', () => {
  it('нарисованная дверь окрестностей ведёт внутрь: зданием не считается, карта, ведущая к улице, — не окрестности', () => {
    const outside = frameOf()
    const locations = { [tavern.id]: tavern, [outside.id]: outside }
    const back = outside.exits!.find((e) => e.to === tavern.id)!
    expect(isBuildingDoorExit(outside, back, locations)).toBe(false)
    expect(buildingLinkOf(locations, { id: 'mill', exits: [{ id: 'x', kind: 'edge', name: 'К таверне', x: 0, y: 0, to: outside.id }] })).toBeNull()
    expect(buildingLinkOf(locations, { id: 'yard', exits: [{ id: 'x', kind: 'road', name: 'В таверну', x: 0, y: 0, to: tavern.id }] })?.exit.id).toBe('tavern-door')
  })
})

describe('каркас окрестностей, построенный движком', () => {
  it('контур здания по центру, дверь там же, где изнутри, у неё — клетка входа и выход назад', () => {
    const loc = frameOf()
    expect([loc.width, loc.height]).toEqual([60, 42])
    // Здание 20×14 по центру: (20, 14)–(39, 27) — не пол (снаружи не войти).
    for (const [x, y] of [[20, 14], [39, 27], [29, 20]]) expect(isFloor(loc, x, y)).toBe(false)
    for (const [x, y] of [[19, 14], [40, 27], [30, 28]]) expect(isFloor(loc, x, y)).toBe(true)
    // Стены по контуру; на южной стене — входная дверь (двустворчатая, как в таверне: x 29–31, y 28).
    expect(edgeContent(loc, { side: 'v', x: 20, y: 20 }).kind).toBe('wall')
    expect(edgeContent(loc, { side: 'h', x: 25, y: 14 }).kind).toBe('wall')
    expect(loc.doors).toEqual([{ id: 'drunken-griffin-door', name: 'Входная дверь', description: tavern.doors.find((d) => d.id === 'entrance')!.description, state: 'closed', x1: 29, y1: 28, x2: 31, y2: 28 }])
    expect(edgeContent(loc, { side: 'h', x: 30, y: 28 }).kind).toBe('door')
    // Вход у двери снаружи — туда приходит отряд; выход назад — дверь, в таверну, к её выходу.
    expect(loc.playerStart).toEqual({ x: 30, y: 28 })
    expect(loc.exits?.find((e) => e.to === tavern.id)).toEqual({ id: 'to-drunken-griffin', kind: 'door', name: 'Входная дверь (Таверна «Пьяный грифон»)', door: 'drunken-griffin-door', x: 30, y: 28, to: tavern.id, toExit: 'tavern-door' })
    expect(hasBuildingFrame(loc, buildingFrame(loc, tavern, exit, { doorState: 'closed' })!)).toBe(true)
  })

  it('двор и дорога у входа, дороги за край карты, забор по краям (кроме концов дороги), вечером — сумерки', () => {
    const loc = frameOf()
    expect(loc.rooms).toEqual([
      { id: 'road', name: 'Дорога', floor: 'dirt', x: 0, y: 33, w: 60, h: 3 },
      { id: 'yard', name: 'Двор у входа', floor: 'dirt', x: 29, y: 28, w: 3, h: 5 },
    ])
    expect(loc.exits?.filter((e) => e.kind === 'edge').map((e) => [e.name, e.x, e.y])).toEqual([
      ['Дорога на запад', 0, 34],
      ['Дорога на восток', 59, 34],
    ])
    expect(edgeContent(loc, { side: 'v', x: 0, y: 5 }).kind).toBe('wall')
    expect(edgeContent(loc, { side: 'v', x: 0, y: 34 }).kind).toBe('none')
    expect(edgeContent(loc, { side: 'h', x: 10, y: 42 }).kind).toBe('wall')
    expect(loc.ambientLight).toBe('dim')
    // Проходит все проверки созданной локации; весь пол достижим (вход → конец дороги).
    expect(createdLocationProblem(fresh(), loc)).toBeNull()
    expect(canStep(loc, { x: 30, y: 28 }, { x: 30, y: 29 })).toBe(true)
  })
})

describe('карта окрестностей от модели — контур здания вставляет движок', () => {
  /** Карта модели 60×42: трава, телега у двери, «своя» таверна-объект на месте здания, свой выход в таверну. */
  const modelMap = (extra: Record<string, unknown> = {}) => ({
    id: 'my-street',
    name: 'Улица',
    description: 'Улица у таверны.',
    cellFeet: 5,
    width: 60,
    height: 42,
    floor: 'grass',
    wallMaterial: 'wood',
    rooms: [{ id: 'all', x: 0, y: 0, w: 60, h: 42 }],
    objects: [
      { id: 'house', type: 'building', name: 'Таверна', x: 22, y: 16, w: 4, h: 4 },
      { id: 'cart', type: 'debris', name: 'Телега', x: 30, y: 28 },
      { id: 'tree', type: 'tree', name: 'Дуб', x: 5, y: 5 },
    ],
    npcs: [{ id: 'kid', name: 'Мальчишка', x: 25, y: 20 }],
    exits: [{ id: 'my-door', kind: 'road', name: 'В таверну', x: 2, y: 2, to: tavern.id }],
    playerStart: { x: 3, y: 3 },
    ...extra,
  })

  it('stampBuilding: всё на месте здания и у двери убрано, свой выход в таверну заменён выходом к нарисованной двери', () => {
    const parsed = parseLocation(modelMap())
    const { location, removed } = stampBuilding(parsed, tavern, exit, { doorState: 'open' })!
    expect(location.objects.map((o) => o.id)).toEqual(['tree'])
    expect(location.npcs).toEqual([])
    expect(removed).toEqual(['объект «Таверна»', 'объект «Телега»', 'НПС «Мальчишка»', 'выход «В таверну»'])
    expect(location.exits?.map((e) => e.id)).toEqual(['to-drunken-griffin'])
    expect(location.doors[0]).toMatchObject({ id: 'drunken-griffin-door', state: 'open' })
    // Повторная вставка ничего не ломает (модель не может «перерисовать» здание).
    expect(stampBuilding(location, tavern, exit, { doorState: 'open' })!.location).toEqual(location)
  })

  it('create_location: окрестности таверны меньше 60×42 — отказ с понятной подсказкой', () => {
    const out = executeTool(fresh(), call('create_location', { location: modelMap({ width: 30, height: 20, rooms: [{ id: 'all', x: 0, y: 0, w: 30, h: 20 }], objects: [], npcs: [] }) }), ctx)
    expect(out.ok).toBe(false)
    expect(out.result.error).toContain('окрестности здания «Таверна «Пьяный грифон»»')
    expect(out.result.error).toContain('не меньше 60×42 клеток — 3 размера здания (20×14) по каждой стороне и не меньше 32×24; у тебя 30×20')
    expect(out.result.error).toContain('travel через «Входная дверь» сам построит каркас')
  })

  it('create_location: карта нужного размера принята с контуром здания; модель видит, что убрано', () => {
    const out = executeTool(fresh(), call('create_location', { location: modelMap() }), ctx)
    expect(out.ok).toBe(true)
    expect(out.result.message).toContain('Контур здания «Таверна «Пьяный грифон»» с дверью вставлен движком')
    expect(out.result.message).toContain('Убрано с места здания: объект «Таверна», объект «Телега»')
    const event = out.events[0].event
    if (event.type !== 'locationCreated') throw new Error(event.type)
    const loc: LocationData = event.location
    expect(isFloor(loc, 25, 20)).toBe(false)
    expect(loc.exits?.find((e) => e.to === tavern.id)).toMatchObject({ x: 30, y: 28, door: 'drunken-griffin-door' })
  })
})

describe('add_exit — выходы в другие места', () => {
  it('добавляет выход; не пол, «край» не на краю, неизвестная локация — отказ; только ведущий', () => {
    const s = fresh()
    const ok = executeTool(s, call('add_exit', { kind: 'edge', name: 'Тропа к мельнице', x: 0, y: 6 }), ctx)
    expect(ok.ok).toBe(true)
    const next = applyAction(s, makeAction('s1', 1, ok.events[0].event, MASTER, 2, 'a'))
    expect(next.world.locations[tavern.id].exits?.at(-1)).toMatchObject({ kind: 'edge', name: 'Тропа к мельнице', x: 0, y: 6 })
    expect(executeTool(s, call('add_exit', { kind: 'edge', name: 'x', x: 5, y: 6 }), ctx).result.error).toContain('«Край карты» — клетка на краю карты')
    expect(executeTool(s, call('add_exit', { kind: 'road', name: 'x', x: 15, y: 0 }), ctx).ok).toBe(true)
    expect(executeTool(s, call('add_exit', { kind: 'road', name: 'x', x: 10, y: 13 }), ctx).result.error).toContain('уже есть выход')
    expect(executeTool(s, call('add_exit', { kind: 'road', name: 'x', x: 1, y: 1, to: 'nowhere' }), ctx).result.error).toContain('Локации [nowhere] нет')
    const event = ok.events[0].event
    expect(checkAction(s, makeAction('s1', 1, event, player(ratibor.character.id), 2, 'p'), { catalog: itemCatalog })).toBe('Выходы на карту добавляет ведущий.')
  })
})
