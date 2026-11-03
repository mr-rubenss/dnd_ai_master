import { describe, expect, it } from 'vitest'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import { parseLocation } from '../game/location'
import { canStep, hasLineOfSight, stepBlocker } from './movement'

const base = { id: 't', name: 'Тест', description: 'Тест', cellFeet: 5, floor: 'stone', wallMaterial: 'stone', objects: [], npcs: [] }

/**
 * Две комнаты 3×3 (x 0–2 и 3–5) с дверью на общей стене между (2, 1) и (3, 1) и окном между (2, 0) и (3, 0).
 *   0 1 2 | 3 4 5
 */
const twoRooms = parseLocation({
  ...base,
  width: 6,
  height: 3,
  rooms: [
    { id: 'west', x: 0, y: 0, w: 3, h: 3 },
    { id: 'east', x: 3, y: 0, w: 3, h: 3 },
  ],
  doors: [{ id: 'door', name: 'Дубовая дверь', state: 'closed', x1: 3, y1: 1, x2: 3, y2: 2 }],
  windows: [{ id: 'win', x1: 3, y1: 0, x2: 3, y2: 1 }],
  playerStart: { x: 0, y: 0 },
})

/** Открытая комната 4×4 с перегородкой-«огрызком» по линии x = 2 от y = 0 до y = 2. */
const stub = parseLocation({
  ...base,
  width: 4,
  height: 4,
  rooms: [{ id: 'room', x: 0, y: 0, w: 4, h: 4 }],
  walls: [{ x1: 2, y1: 0, x2: 2, y2: 2 }],
  playerStart: { x: 0, y: 0 },
})

/** Две стены сходятся углом в узле (2, 2): левая граница клетки (2, 1) и верхняя граница клетки (1, 2). */
const corner = parseLocation({
  ...base,
  width: 4,
  height: 4,
  rooms: [{ id: 'room', x: 0, y: 0, w: 4, h: 4 }],
  walls: [
    { x1: 2, y1: 1, x2: 2, y2: 2 },
    { x1: 1, y1: 2, x2: 2, y2: 2 },
  ],
  playerStart: { x: 0, y: 0 },
})

describe('canStep: по стороне', () => {
  it('внутри комнаты можно шагнуть в любую соседнюю клетку', () => {
    expect(canStep(twoRooms, { x: 1, y: 1 }, { x: 2, y: 1 })).toBe(true)
    expect(canStep(twoRooms, { x: 1, y: 1 }, { x: 1, y: 0 })).toBe(true)
  })

  it('нельзя пройти сквозь стену', () => {
    expect(stepBlocker(twoRooms, { x: 2, y: 2 }, { x: 3, y: 2 })).toBe('мешает стена')
  })

  it('нельзя пройти сквозь окно', () => {
    expect(stepBlocker(twoRooms, { x: 2, y: 0 }, { x: 3, y: 0 })).toBe('мешает окно')
  })

  it('закрытая и запертая дверь не пускают, открытая — пускает', () => {
    const from = { x: 2, y: 1 }
    const to = { x: 3, y: 1 }
    expect(stepBlocker(twoRooms, from, to)).toBe('«Дубовая дверь» закрыта')
    expect(stepBlocker(twoRooms, from, to, { door: 'locked' })).toBe('«Дубовая дверь» заперта')
    expect(canStep(twoRooms, from, to, { door: 'open' })).toBe(true)
    expect(canStep(twoRooms, to, from, { door: 'open' })).toBe(true)
  })

  it('нельзя шагнуть дальше соседней клетки, на месте или за пределы пола', () => {
    expect(stepBlocker(twoRooms, { x: 0, y: 0 }, { x: 2, y: 0 })).toBe('клетки не соседние')
    expect(stepBlocker(twoRooms, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe('клетки не соседние')
    expect(stepBlocker(twoRooms, { x: 0, y: 0 }, { x: -1, y: 0 })).toBe('там нет пола')
  })
})

describe('canStep: по диагонали', () => {
  it('в открытой комнате можно', () => {
    expect(canStep(twoRooms, { x: 0, y: 0 }, { x: 1, y: 1 })).toBe(true)
    expect(canStep(twoRooms, { x: 1, y: 1 }, { x: 0, y: 2 })).toBe(true)
  })

  it('нельзя срезать через открытую дверь по диагонали — у угла проёма стена', () => {
    expect(canStep(twoRooms, { x: 2, y: 1 }, { x: 3, y: 2 }, { door: 'open' })).toBe(false)
    expect(canStep(twoRooms, { x: 2, y: 1 }, { x: 3, y: 1 }, { door: 'open' })).toBe(true)
  })

  it('нельзя обогнуть конец перегородки по диагонали, но можно в обход по сторонам', () => {
    expect(stepBlocker(stub, { x: 1, y: 1 }, { x: 2, y: 2 })).toBe('по диагонали нельзя протиснуться между углами стен')
    expect(canStep(stub, { x: 1, y: 1 }, { x: 1, y: 2 })).toBe(true)
    expect(canStep(stub, { x: 1, y: 2 }, { x: 2, y: 2 })).toBe(true)
    // Чуть дальше от конца перегородки диагональ свободна.
    expect(canStep(stub, { x: 1, y: 2 }, { x: 2, y: 3 })).toBe(true)
  })

  it('нельзя протиснуться между двумя стенами, сходящимися углом', () => {
    expect(canStep(corner, { x: 1, y: 1 }, { x: 2, y: 1 })).toBe(false)
    expect(canStep(corner, { x: 1, y: 1 }, { x: 1, y: 2 })).toBe(false)
    expect(canStep(corner, { x: 1, y: 1 }, { x: 2, y: 2 })).toBe(false)
    expect(canStep(corner, { x: 2, y: 2 }, { x: 1, y: 1 })).toBe(false)
  })
})

describe('hasLineOfSight (заготовка)', () => {
  it('в одной комнате видно', () => {
    expect(hasLineOfSight(twoRooms, { x: 0, y: 0 }, { x: 2, y: 2 })).toBe(true)
  })

  it('стена перекрывает видимость', () => {
    expect(hasLineOfSight(twoRooms, { x: 2, y: 2 }, { x: 4, y: 2 })).toBe(false)
  })

  it('закрытая дверь перекрывает, открытая — нет', () => {
    expect(hasLineOfSight(twoRooms, { x: 1, y: 1 }, { x: 5, y: 1 })).toBe(false)
    expect(hasLineOfSight(twoRooms, { x: 1, y: 1 }, { x: 5, y: 1 }, { door: 'open' })).toBe(true)
  })

  it('сквозь окно видно, хотя пройти нельзя', () => {
    expect(hasLineOfSight(twoRooms, { x: 0, y: 0 }, { x: 5, y: 0 })).toBe(true)
  })

  it('перегородка перекрывает, а линия мимо её конца — нет', () => {
    expect(hasLineOfSight(stub, { x: 0, y: 0 }, { x: 3, y: 0 })).toBe(false)
    expect(hasLineOfSight(stub, { x: 0, y: 3 }, { x: 3, y: 3 })).toBe(true)
    // Диагональ, проходящая ровно через конец перегородки, перекрыта.
    expect(hasLineOfSight(stub, { x: 0, y: 0 }, { x: 3, y: 3 })).toBe(false)
  })
})

describe('таверна «Пьяный грифон»', () => {
  const tavern = parseLocation(drunkenGriffinJson)

  it('в кладовую не пройти, пока дверь заперта', () => {
    expect(stepBlocker(tavern, { x: 14, y: 1 }, { x: 15, y: 1 })).toBe('«Дверь в кладовую» заперта')
    expect(canStep(tavern, { x: 14, y: 1 }, { x: 15, y: 1 }, { 'storage-door': 'open' })).toBe(true)
  })

  it('от зоны у стойки в общий зал — через проём без стены', () => {
    expect(canStep(tavern, { x: 7, y: 4 }, { x: 7, y: 5 })).toBe(true)
    expect(canStep(tavern, { x: 17, y: 4 }, { x: 17, y: 5 })).toBe(false)
  })

  it('из зала не выйти на улицу: за входной дверью нет пола', () => {
    expect(stepBlocker(tavern, { x: 10, y: 13 }, { x: 10, y: 14 })).toBe('там нет пола')
  })
})
