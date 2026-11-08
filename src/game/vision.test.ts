// Видимость: линия видимости (стены, двери), свет и тьма, тёмное зрение SRD 5.2.1, магическая тьма и дым, туман войны
// (areaExplored) и раздел «Что видит герой сейчас» для ведущего.
import { describe, expect, it } from 'vitest'
import { itemCatalog, rulesData } from '../data'
import adventureJson from '../data/adventures/drunken-griffin.json'
import fighterJson from '../data/characters/fighter-ratibor.json'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import type { LocationData } from '../types/location'
import type { PartyMember, StoryState } from '../types/story'
import { parseAdventure } from './adventure'
import { parseCharacterSheet } from './character'
import { parseLocation } from './location'
import { gameStateText } from './masterState'
import { applyAction, checkAction, ENGINE, makeAction, MASTER, newStorySeed, replay, SYSTEM } from './storyActions'
import { darkvisionOf, exploredCells, heroVision, lightMap, mergeExplored, newlyExplored, partyVision, visionText } from './vision'

const ratibor = parseCharacterSheet(fighterJson, itemCatalog)
const tavern = parseLocation(drunkenGriffinJson)

/** Две комнаты 5×5: A слева, B справа, между ними дверь (x = 5, клетки y 2). */
function rooms(extra: Record<string, unknown> = {}): LocationData {
  return parseLocation({
    id: 'crypt',
    name: 'Склеп',
    description: 'Два зала.',
    cellFeet: 5,
    width: 10,
    height: 5,
    floor: 'stone',
    wallMaterial: 'stone',
    rooms: [
      { id: 'a', name: 'Зал A', x: 0, y: 0, w: 5, h: 5 },
      { id: 'b', name: 'Зал B', x: 5, y: 0, w: 5, h: 5 },
    ],
    doors: [{ id: 'door', name: 'Дверь', state: 'closed', x1: 5, y1: 2, x2: 5, y2: 3 }],
    objects: [],
    npcs: [{ id: 'ghoul', name: 'Упырь', x: 8, y: 2 }],
    playerStart: { x: 1, y: 2 },
    ...extra,
  })
}

/** Герой (лист Ратибора) с нужным видом и в нужной клетке. */
const member = (speciesId = 'human', at = { x: 1, y: 2 }, speciesOption: string | null = null): PartyMember => ({
  heroId: 'ratibor',
  character: { ...ratibor.character, speciesId, speciesOption },
  inventory: ratibor.inventory,
  position: at,
})
const world = (location: LocationData, doors: Record<string, 'open' | 'closed' | 'locked'> = {}): Pick<StoryState, 'world'> => ({
  world: { locations: { [location.id]: location }, currentLocationId: location.id, doors: { [location.id]: doors }, facts: [], quests: [] },
})
const sees = (location: LocationData, m: PartyMember, doors = {}) => heroVision(location, world(location, doors), m, rulesData).visible

describe('линия видимости героя', () => {
  it('стены и закрытая дверь перекрывают, открытая дверь — нет', () => {
    const loc = rooms({ ambientLight: 'bright' })
    const closed = sees(loc, member())
    expect(closed.has('4,4')).toBe(true)
    expect(closed.has('8,2')).toBe(false)
    const open = sees(loc, member(), { door: 'open' })
    expect(open.has('8,2')).toBe(true)
  })

  it('таверна: от входа видны зал и стойка, кладовая за запертой дверью — нет', () => {
    const v = sees(tavern, member('human', tavern.playerStart))
    expect(v.has('7,1')).toBe(true)
    expect(v.has('17,9')).toBe(true)
    for (const cell of ['16,1', '17,3', '18,2']) expect(v.has(cell)).toBe(false)
  })
})

describe('свет и тьма', () => {
  const dark = (light = { bright: 5, dim: 5 }) =>
    rooms({ ambientLight: 'dark', objects: [{ id: 'torch', type: 'torch', name: 'Факел', x: 0, y: 0, light }] })

  it('освещённость: яркий у факела, тусклый дальше, темнота за радиусом и за стеной', () => {
    const levels = lightMap(dark())
    expect(levels.get('0,0')).toBe('bright')
    expect(levels.get('1,1')).toBe('dim')
    expect(levels.get('4,4')).toBe('dark')
    // Свет сквозь стену не проходит, даже в радиусе.
    const big = lightMap(dark({ bright: 60, dim: 0 }))
    expect(big.get('4,4')).toBe('bright')
    expect(big.get('6,0')).toBe('dark')
  })

  it('без тёмного зрения в темноте видно только освещённое', () => {
    const v = sees(dark(), member('human', { x: 1, y: 2 }))
    expect(v.has('0,0')).toBe(true)
    expect(v.has('4,4')).toBe(false)
    expect(v.has('1,2')).toBe(true)
  })

  it('тёмное зрение по SRD 5.2.1: в темноте в пределах дальности видно; дальше — нет', () => {
    expect(darkvisionOf(member('human').character, rulesData)).toBe(0)
    expect(darkvisionOf(member('elf').character, rulesData)).toBe(60)
    expect(darkvisionOf(member('elf', undefined, 'drow').character, rulesData)).toBe(120)
    expect(darkvisionOf(member('dwarf').character, rulesData)).toBe(120)
    // Длинный тёмный коридор 30 клеток: эльф (60 фт. = 12 клеток) видит до 12-й клетки.
    const hall = parseLocation({
      id: 'hall', name: 'Коридор', description: 'Тьма.', cellFeet: 5, width: 30, height: 1, floor: 'stone', wallMaterial: 'stone',
      ambientLight: 'dark', rooms: [{ id: 'h', x: 0, y: 0, w: 30, h: 1 }], objects: [], npcs: [], playerStart: { x: 0, y: 0 },
    })
    const elf = sees(hall, member('elf', { x: 0, y: 0 }))
    expect(elf.has('12,0')).toBe(true)
    expect(elf.has('13,0')).toBe(false)
    expect(sees(hall, member('dwarf', { x: 0, y: 0 })).has('24,0')).toBe(true)
    expect(sees(hall, member('human', { x: 0, y: 0 })).size).toBe(1)
  })

  it('магическая тьма: обычный свет её не освещает, тёмное зрение сквозь неё не видит; дым заслоняет', () => {
    const loc = rooms({ ambientLight: 'bright', effects: [{ id: 'night', kind: 'darkness', x: 3, y: 0, w: 2, h: 5 }] })
    expect(lightMap(loc).get('3,2')).toBe('magic-dark')
    expect(sees(loc, member('dwarf')).has('3,2')).toBe(false)
    expect(sees(loc, member('dwarf')).has('2,2')).toBe(true)
    const smoky = rooms({ ambientLight: 'bright', effects: [{ id: 'smoke', kind: 'smoke', x: 3, y: 0, w: 2, h: 5 }] })
    expect(sees(smoky, member()).has('4,1')).toBe(false)
  })
})

describe('туман войны: исследованное', () => {
  const adventure = parseAdventure(adventureJson, { [tavern.id]: tavern })
  const start = () =>
    applyAction(null, makeAction('s1', 0, { type: 'storyCreated', seed: newStorySeed({ id: 's1', title: 'Т', tone: 'detective', adventure, locations: { [tavern.id]: tavern }, party: [ratibor], now: 1 }) }, ENGINE, 1, 'c'))

  it('увиденное записывается действием areaExplored и переживает воспроизведение журнала', () => {
    let s = start()
    const seen = partyVision(tavern, s, rulesData)
    const cells = newlyExplored(s, tavern, seen)
    expect(cells.length).toBe(seen.size)
    const a1 = makeAction('s1', 1, { type: 'areaExplored', locationId: tavern.id, cells }, SYSTEM, 2, 'x1')
    expect(checkAction(s, a1, { catalog: itemCatalog })).toBeNull()
    s = applyAction(s, a1)
    expect(exploredCells(s, tavern)).toEqual(seen)
    // Второй раз нового нет; кладовая не исследована.
    expect(newlyExplored(s, tavern, seen)).toEqual([])
    expect(exploredCells(s, tavern).has('17,3')).toBe(false)
    // Открыли дверь кладовой — новые клетки.
    s = applyAction(s, makeAction('s1', 2, { type: 'doorChanged', locationId: tavern.id, doorId: 'storage-door', state: 'open' }, MASTER, 3, 'x2'))
    const more = newlyExplored(s, tavern, partyVision(tavern, s, rulesData))
    expect(more.length).toBeGreaterThan(0)
    // Всё новое — в кладовой (x ≥ 15, y ≤ 4): видно сквозь открытую дверь.
    for (const i of more) expect([i % tavern.width >= 15, Math.floor(i / tavern.width) <= 4]).toEqual([true, true])
    const back = replay([makeAction('s1', 0, { type: 'storyCreated', seed: start() }, ENGINE, 1, 'c'), a1])
    expect(exploredCells(back, tavern)).toEqual(seen)
  })

  it('ведущий отмечать исследованное не может; клетки за картой — отказ', () => {
    const s = start()
    expect(checkAction(s, makeAction('s1', 1, { type: 'areaExplored', locationId: tavern.id, cells: [1] }, MASTER, 2, 'm'), { catalog: itemCatalog })).toBe(
      'Исследованное отмечает игра, а не ведущий.',
    )
    expect(checkAction(s, makeAction('s1', 1, { type: 'areaExplored', locationId: tavern.id, cells: [9999] }, SYSTEM, 2, 'm'), { catalog: itemCatalog })).toBe(
      'Клетки за пределами карты.',
    )
    expect(mergeExplored('01', 4, [3])).toBe('0101')
  })
})

describe('ведущему: что видит герой сейчас', () => {
  it('в таверне: свет, видимые НПС, невидимое за запертой дверью; тёмного зрения нет', () => {
    const adventure = parseAdventure(adventureJson, { [tavern.id]: tavern })
    const s = newStorySeed({ id: 's1', title: 'Т', tone: 'detective', adventure, locations: { [tavern.id]: tavern }, party: [ratibor], now: 1 })
    const text = visionText(s, tavern, rulesData)
    expect(text).toMatch(/^## Что видит герой сейчас \(описывай только видимое\)\n- Ратибор: у него (полумрак|яркий свет); тёмного зрения нет/)
    expect(text).toContain('Видит НПС: Гуннар, Брам, Лиара, Тобиас.')
    expect(text).toMatch(/НЕ видит \(стены, закрытые двери, темнота, дым\): [^\n]*Окованный сундук/)
    // Скрытый карманник в списках не упоминается — его и так нет для героя.
    expect(text).not.toContain('Шнырь')
    expect(gameStateText(s, { catalog: itemCatalog, rules: rulesData })).toContain('## Что видит герой сейчас')
  })

  it('в темноте: упырь вне света не виден; у дварфа — тёмное зрение', () => {
    const loc = rooms({ ambientLight: 'dark' })
    const base = { ...world(loc, { door: 'open' }), party: [member('human')] } as unknown as StoryState
    expect(visionText(base, loc, rulesData)).toContain('НЕ видит (стены, закрытые двери, темнота, дым): Упырь')
    const dwarf = { ...base, party: [member('dwarf')] } as StoryState
    const text = visionText(dwarf, loc, rulesData)
    expect(text).toContain('тёмное зрение 120 фт. (в темноте в этих пределах видит как в полумраке, только оттенки серого')
    expect(text).toContain('Видит НПС: Упырь.')
  })
})
