import { describe, expect, it } from 'vitest'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import { parseLocation } from '../game/location'
import { canStep } from './movement'
import { findPath, pathFeet, reachableCells } from './pathfinding'

const tavern = parseLocation(drunkenGriffinJson)

/** Путь — цепочка соседних клеток, каждый шаг разрешён правилами стен и дверей. */
function expectWalkable(from: { x: number; y: number }, path: { x: number; y: number }[], doors = {}) {
  let prev = from
  for (const c of path) {
    expect(Math.max(Math.abs(c.x - prev.x), Math.abs(c.y - prev.y))).toBe(1)
    expect(canStep(tavern, prev, c, doors)).toBe(true)
    prev = c
  }
}

describe('поиск пути A*', () => {
  it('кратчайший путь с диагоналями: длина — расстояние Чебышёва; на месте — пустой путь', () => {
    const path = findPath(tavern, { x: 10, y: 13 }, { x: 6, y: 10 })!
    expect(path).toHaveLength(4)
    expect(path.at(-1)).toEqual({ x: 6, y: 10 })
    expectWalkable({ x: 10, y: 13 }, path)
    expect(findPath(tavern, { x: 3, y: 3 }, { x: 3, y: 3 })).toEqual([])
  })

  it('стена: в кладовую только через дверь; запертая или закрытая — пути нет, открытая — есть', () => {
    expect(findPath(tavern, { x: 14, y: 3 }, { x: 16, y: 3 })).toBeNull()
    expect(findPath(tavern, { x: 14, y: 3 }, { x: 16, y: 3 }, { doors: { 'storage-door': 'closed' } })).toBeNull()
    const open = findPath(tavern, { x: 14, y: 3 }, { x: 16, y: 3 }, { doors: { 'storage-door': 'open' } })!
    expectWalkable({ x: 14, y: 3 }, open, { 'storage-door': 'open' })
    // Проход через дверной проём: клетки (14, 1–2) → (15, 1–2).
    expect(open.some((c) => c.x === 15 && (c.y === 1 || c.y === 2))).toBe(true)
  })

  it('занятые клетки обходятся; цель занята — пути нет', () => {
    const blocked = (c: { x: number; y: number }) => c.y === 10 && c.x >= 2 && c.x <= 17
    const around = findPath(tavern, { x: 10, y: 12 }, { x: 10, y: 8 }, { blocked })!
    expect(around.some((c) => c.y === 10 && c.x >= 2 && c.x <= 17)).toBe(false)
    expectWalkable({ x: 10, y: 12 }, around)
    expect(around.length).toBeGreaterThan(4)
    expect(findPath(tavern, { x: 10, y: 12 }, { x: 5, y: 10 }, { blocked })).toBeNull()
  })

  it('длина в футах: каждая клетка, и по диагонали, — 5 фт.; достижимые клетки — без кладовой за запертой дверью', () => {
    expect(pathFeet(findPath(tavern, { x: 10, y: 13 }, { x: 6, y: 10 })!, 5)).toBe(20)
    const reach = reachableCells(tavern, { x: 10, y: 13 })
    expect(reach.has('0,0')).toBe(true)
    expect(reach.has('17,2')).toBe(false)
    expect(reachableCells(tavern, { x: 10, y: 13 }, { doors: { 'storage-door': 'open' } }).has('17,2')).toBe(true)
  })
})
