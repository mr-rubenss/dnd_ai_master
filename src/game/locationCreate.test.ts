// Новая локация от ведущего (create_location): схема zod, проверки parseLocation и правила созданной локации,
// действие locationCreated (кто может, повторная проверка), хранение в мире истории и «Локации мира» для ведущего.
import { describe, expect, it } from 'vitest'
import type { AiToolCall } from '../ai/types'
import { itemCatalog, priceList, rulesData } from '../data'
import adventureJson from '../data/adventures/drunken-griffin.json'
import fighterJson from '../data/characters/fighter-ratibor.json'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import type { LocationData } from '../types/location'
import type { StoryState } from '../types/story'
import { parseAdventure } from './adventure'
import { parseCharacterSheet } from './character'
import { parseLocation } from './location'
import { createdLocationProblem, locationInputOf, MIN_LOCATION_EXAMPLE, parseCreatedLocation, schemaProblems } from './locationCreate'
import { gameStateText } from './masterState'
import { executeTool, type ToolContext } from './masterTools'
import { applyAction, checkAction, ENGINE, makeAction, MASTER, newStorySeed, player, replay } from './storyActions'

const tavern = parseLocation(drunkenGriffinJson)
const locations = { [tavern.id]: tavern }
const adventure = parseAdventure(adventureJson, locations)
const ratibor = parseCharacterSheet(fighterJson, itemCatalog)
const ctx: ToolContext = { catalog: itemCatalog, rules: rulesData, prices: priceList, now: () => 1000, newId: () => 'id1' }
const created = makeAction('s1', 0, { type: 'storyCreated', seed: newStorySeed({ id: 's1', title: 'Т', tone: 'detective', adventure, locations, party: [ratibor], now: 1 }) }, ENGINE, 1, 'c')
const fresh = (): StoryState => applyAction(null, created)
const call = (args: unknown): AiToolCall => ({ id: 'c1', name: 'create_location', arguments: args, rawArguments: JSON.stringify(args) })

/**
 * Улица 12×8: одна «комната» во всю карту, дорога к мельнице и на восток (край карты). Не окрестности таверны (выход
 * не ведёт в здание) — механика create_location; окрестности здания проверяются в surroundings.test.ts.
 */
const street = (extra: Record<string, unknown> = {}) => ({
  id: 'griffin-street',
  name: 'Улица у «Пьяного грифона»',
  description: 'Грязная улица, фонарь над вывеской таверны.',
  cellFeet: 5,
  width: 12,
  height: 8,
  floor: 'dirt',
  wallMaterial: 'stone',
  rooms: [{ id: 'street', name: 'Улица', x: 0, y: 0, w: 12, h: 8 }],
  objects: [
    { id: 'cart', type: 'debris', name: 'Сломанная телега', x: 3, y: 4, w: 2 },
    { id: 'barrel', type: 'barrel', name: 'Бочка с водой', x: 8, y: 2 },
  ],
  npcs: [{ id: 'beggar', name: 'Нищий', attitude: 'neutral', x: 6, y: 6 }],
  exits: [
    { id: 'to-tavern', kind: 'road', name: 'Дверь таверны', x: 5, y: 0, to: 'old-mill' },
    { id: 'east-road', kind: 'edge', name: 'Дорога на восток', x: 11, y: 4 },
  ],
  playerStart: { x: 5, y: 1 },
  ...extra,
})

const problemsOf = (input: unknown) => {
  const r = parseCreatedLocation(input)
  return r.ok ? [] : r.problems
}

describe('схема и проверки созданной локации', () => {
  it('верная локация проходит: выходы сохраняются, остальное — в полной записи', () => {
    const r = parseCreatedLocation(street())
    expect(r.ok).toBe(true)
    const loc = (r as { location: LocationData }).location
    expect(loc.exits).toEqual([
      { id: 'to-tavern', kind: 'road', name: 'Дверь таверны', to: 'old-mill', x: 5, y: 0 },
      { id: 'east-road', kind: 'edge', name: 'Дорога на восток', x: 11, y: 4 },
    ])
    expect(loc.floorPlan).toHaveLength(8)
    expect(loc.walls.length).toBe(2 * (12 + 8))
  })

  it('форма проверяется схемой zod — ошибки по пути поля, по-русски', () => {
    expect(schemaProblems(street({ exits: [] }))).toEqual(['exits: нужно хотя бы 1 (у локации должен быть хотя бы один выход)'])
    expect(schemaProblems(street({ exits: undefined }))).toEqual(['exits: нет обязательного поля'])
    expect(schemaProblems(street({ width: '12' }))).toEqual(['width: ожидается число'])
    expect(schemaProblems(street({ id: 'Улица 1' }))).toEqual(['id: латиница в нижнем регистре, цифры и дефисы (kebab-case)'])
    expect(schemaProblems(street({ floor: 'lava' }))[0]).toBe('floor: одно из wood, stone, tile, dirt, grass')
    const bad = street({ objects: [{ id: 'x', type: 'throne', name: 'Трон', x: 1, y: 1 }] })
    expect(schemaProblems(bad)[0]).toMatch(/^objects\[0\]\.type: одно из table, chair/)
    expect(schemaProblems(street({ width: 500 }))).toEqual(['width: не больше 100'])
    expect(schemaProblems(street({ npcs: [{ id: 'n', name: '', x: 1, y: 1 }] }))).toEqual(['npcs[0].name: пустая строка'])
  })

  it('объекты не за пределами карты и не друг на друге; НПС — по одному в клетке', () => {
    expect(problemsOf(street({ objects: [{ id: 'cart', type: 'debris', name: 'Телега', x: 11, y: 4, w: 2 }] }))).toEqual([
      'objects[0] "cart": объект размером 2×1 в клетке (11, 4) выходит за пределы карты 12×8',
    ])
    expect(
      problemsOf(
        street({
          objects: [
            { id: 'a', type: 'barrel', name: 'Бочка', x: 2, y: 2 },
            { id: 'b', type: 'chest', name: 'Сундук', x: 2, y: 2 },
          ],
        }),
      ),
    ).toEqual(['objects[1] "b": клетка (2, 2) уже занята объектом objects[0] "a"'])
    // Ковёр плоский — под ним можно поставить стол.
    expect(
      problemsOf(
        street({
          objects: [
            { id: 'rug', type: 'rug', name: 'Ковёр', x: 2, y: 2, w: 2, h: 2 },
            { id: 'table', type: 'table', name: 'Стол', x: 2, y: 2 },
          ],
        }),
      ),
    ).toEqual([])
    expect(
      problemsOf(
        street({
          npcs: [
            { id: 'a', name: 'Аня', x: 6, y: 6 },
            { id: 'b', name: 'Боря', x: 6, y: 6 },
          ],
        }),
      ),
    ).toEqual(['npcs "b": клетка (6, 6) уже занята НПС "a"'])
  })

  it('выходы: клетка пола, «край карты» — на краю, «дверь» — вплотную к своей двери', () => {
    expect(problemsOf(street({ exits: [{ id: 'e', kind: 'edge', name: 'Край', x: 5, y: 4 }] }))).toEqual([
      'exits[0] "e": выход «край карты» — клетка на краю карты (x = 0 или 11, y = 0 или 7)',
    ])
    expect(problemsOf(street({ exits: [{ id: 'e', kind: 'door', name: 'Дверь', x: 5, y: 0 }] }))).toEqual(['exits[0] "e": у выхода-двери нужен "door" — id двери'])
    const withDoor = { doors: [{ id: 'gate', name: 'Ворота', state: 'closed', x1: 0, y1: 3, x2: 0, y2: 4 }] }
    expect(problemsOf(street({ ...withDoor, exits: [{ id: 'e', kind: 'door', name: 'Ворота', door: 'gate', x: 0, y: 3 }] }))).toEqual([])
    expect(problemsOf(street({ ...withDoor, exits: [{ id: 'e', kind: 'door', name: 'Ворота', door: 'gate', x: 5, y: 3 }] }))).toEqual([
      'exits[0] "e": клетка выхода (5, 3) должна быть вплотную к двери "gate"',
    ])
    expect(problemsOf(street({ exits: [{ id: 'e', kind: 'door', name: 'Дверь', door: 'nope', x: 0, y: 0 }] }))).toEqual([
      'exits[0] "e": двери "nope" нет в "doors" — добавь эту дверь в doors (на стене карты) или сделай выход без двери: kind: "road" (дорога, проход) или "edge" (край карты), без поля door',
    ])
  })

  it('стены, достижимость и id — те же правила, что у всех локаций', () => {
    // Комната без проёма за стеной недостижима.
    const cut = street({ rooms: [{ id: 'a', x: 0, y: 0, w: 6, h: 8 }, { id: 'b', x: 6, y: 0, w: 6, h: 8 }] })
    expect(problemsOf(cut)[0]).toMatch(/недостижимы от входа playerStart/)
    expect(problemsOf(street({ npcs: [{ id: 'cart', name: 'Тёзка', x: 1, y: 1 }] }))).toEqual(['npcs[0] "cart": повторяющийся id "cart"'])
  })
})

describe('create_location: инструмент ведущего', () => {
  it('создаёт локацию в мире истории; повтор того же id — отказ; при воспроизведении журнала карта та же', () => {
    const s = fresh()
    const out = executeTool(s, call({ location: street() }), ctx)
    expect(out.ok).toBe(true)
    expect(out.result.message).toContain('Локация «Улица у «Пьяного грифона»» создана: 12×8 клеток')
    expect(out.events).toHaveLength(1)
    expect(out.events[0].author).toEqual(MASTER)
    const action = makeAction('s1', 1, out.events[0].event, MASTER, 5, 'a1')
    const next = applyAction(s, action)
    expect(next.world.locations['griffin-street'].name).toBe('Улица у «Пьяного грифона»')
    // Текущая локация не меняется — переход между картами отдельно.
    expect(next.world.currentLocationId).toBe(tavern.id)
    const again = executeTool(next, call({ location: street({ name: 'Другая улица' }) }), ctx)
    expect(again.ok).toBe(false)
    expect(again.result.error).toContain('уже есть в мире этой истории')
    expect(replay([created, action]).world.locations['griffin-street']).toEqual(next.world.locations['griffin-street'])
    // Ведущий видит, какие локации уже есть.
    const text = gameStateText(next, { catalog: itemCatalog, rules: rulesData })
    expect(text).toContain('## Локации мира')
    expect(text).toContain('«Улица у «Пьяного грифона»» [griffin-street]')
  })

  it('ошибки возвращаются модели списком, история не меняется', () => {
    const out = executeTool(fresh(), call({ location: street({ exits: [], width: 0 }) }), ctx)
    expect(out.ok).toBe(false)
    expect(out.events).toEqual([])
    expect(out.result.error).toContain('Локация не создана, исправь и вызови снова')
    expect(out.result.error).toContain('- width: не меньше 1')
    expect(out.result.error).toContain('- exits: нужно хотя бы 1')
  })

  it('JSON строкой тоже принимается; мусор — понятный отказ', () => {
    expect(executeTool(fresh(), call({ location: JSON.stringify(street()) }), ctx).ok).toBe(true)
    expect(executeTool(fresh(), call({ location: '{oops' }), ctx).result.error).toContain('не разобралась как JSON')
    expect(executeTool(fresh(), call({ location: [1] }), ctx).result.error).toBe('location — JSON-объект локации.')
    expect(executeTool(fresh(), call({ location: street({ id: tavern.id }) }), ctx).result.error).toContain(`Локация «${tavern.id}» уже есть`)
  })

  it('locationCreated: только ведущий; локация перепроверяется (чужое действие с испорченной картой не пройдёт)', () => {
    const s = fresh()
    const loc = (parseCreatedLocation(street()) as { location: LocationData }).location
    const as = (author: Parameters<typeof makeAction>[3], location = loc) => checkAction(s, makeAction('s1', 1, { type: 'locationCreated', location }, author, 2, 'x'), { catalog: itemCatalog })
    expect(as(MASTER)).toBeNull()
    // Движок тоже создаёт локации — каркас окрестностей здания при выходе наружу.
    expect(as(ENGINE)).toBeNull()
    expect(as(player(ratibor.character.id))).toBe('Новые локации создаёт ведущий.')
    expect(as(MASTER, { ...loc, objects: [...loc.objects, { id: 'x', type: 'chest', name: 'Сундук', x: 30, y: 30 }] })).toContain('за пределами карты')
    expect(as(MASTER, { ...loc, exits: [] })).toContain('хотя бы один выход')
    expect(as(MASTER, { ...loc, id: tavern.id })).toContain('уже есть в мире этой истории')
    expect(createdLocationProblem(s, loc)).toBeNull()
  })

  it('полная запись переводится обратно без потерь (таверна: стены, двери, проёмы)', () => {
    const back = parseLocation(locationInputOf(tavern))
    expect(back.walls).toEqual(tavern.walls)
    expect(back.floorPlan).toEqual(tavern.floorPlan)
    expect(back.doors).toEqual(tavern.doors)
    expect(back.objects).toEqual(tavern.objects)
    expect(back.npcs).toEqual(tavern.npcs)
  })
})

describe('пример минимальной локации (идёт модели с ошибками)', () => {
  it('сам проходит все проверки (ссылка назад — заглушка id)', () => {
    expect(parseCreatedLocation(JSON.parse(MIN_LOCATION_EXAMPLE)).ok).toBe(true)
  })
})

describe('терпимость к частым ошибкам модели (живой отчёт 2026-11-09)', () => {
  it('объект с типом эффекта (лужа) переносится в effects, модель получает заметку', () => {
    const r = parseCreatedLocation(street({ objects: [{ id: 'p1', type: 'puddle', name: 'Лужа', x: 3, y: 5, w: 2, h: 2 }, { id: 'f', type: 'fire', name: 'Костёр', x: 8, y: 1 }] }))
    expect(r.ok).toBe(true)
    const loc = (r as { location: LocationData }).location
    expect(loc.effects).toEqual([{ id: 'p1', kind: 'puddle', name: 'Лужа', x: 3, y: 5, w: 2, h: 2 }])
    // fire — и объект, и эффект: остаётся объектом.
    expect(loc.objects.map((o) => o.id)).toEqual(['f'])
    expect(r.notes[0]).toContain('«Лужа» — это эффекты (puddle)')
  })

  it('выход-дверь без двери на карте и неизвестный тип объекта — отказ с подсказкой, как исправить', () => {
    const door = parseCreatedLocation(street({ exits: [{ id: 'e', kind: 'door', name: 'Дверь', door: 'entrance', x: 5, y: 7 }] }))
    expect(door.ok).toBe(false)
    expect((door as { problems: string[] }).problems[0]).toContain('kind: "road"')
    const type = parseCreatedLocation(street({ objects: [{ id: 'x', type: 'sign', name: 'Вывеска', x: 1, y: 1 }] }))
    expect((type as { problems: string[] }).problems[0]).toContain('вывеска, мешок, ящик — item')
  })
})
