// Проходимость и линия видимости на карте с тонкими стенами. Чистые функции.
//
// Стены лежат на границах клеток. Единичный отрезок границы («ребро») задаётся стороной и клеткой:
// `h` (x, y) — верхняя граница клетки (x, y), то есть отрезок от узла (x, y) до узла (x + 1, y);
// `v` (x, y) — левая граница клетки (x, y), отрезок от узла (x, y) до узла (x, y + 1).

import type { CellPosition, Door, DoorState, GridSegment, LocationData } from '../types/location'

export type EdgeSide = 'h' | 'v'

export interface EdgeRef {
  side: EdgeSide
  x: number
  y: number
}

export const edgeKey = (side: EdgeSide, x: number, y: number): string => `${side}:${x},${y}`

/**
 * Разбивает отрезок по линиям сетки на единичные рёбра.
 * Возвращает null, если отрезок не горизонтальный/вертикальный, нулевой длины или с дробными координатами.
 */
export function segmentEdges(segment: GridSegment): EdgeRef[] | null {
  const { x1, y1, x2, y2 } = segment
  if (![x1, y1, x2, y2].every(Number.isInteger)) return null
  const edges: EdgeRef[] = []
  if (x1 === x2 && y1 !== y2) {
    for (let y = Math.min(y1, y2); y < Math.max(y1, y2); y++) edges.push({ side: 'v', x: x1, y })
    return edges
  }
  if (y1 === y2 && x1 !== x2) {
    for (let x = Math.min(x1, x2); x < Math.max(x1, x2); x++) edges.push({ side: 'h', x, y: y1 })
    return edges
  }
  return null
}

/** Ребро между двумя соседними по стороне клетками. */
export function edgeBetween(a: CellPosition, b: CellPosition): EdgeRef {
  if (b.x !== a.x) return { side: 'v', x: Math.max(a.x, b.x), y: a.y }
  return { side: 'h', x: a.x, y: Math.max(a.y, b.y) }
}

/** Текущие состояния дверей по id (из состояния игры). Нет записи — действует начальное состояние из локации. */
export type DoorStates = Readonly<Record<string, DoorState>>

export function doorState(door: Door, doors: DoorStates = {}): DoorState {
  return doors[door.id] ?? door.state
}

interface MapGeometry {
  walls: Set<string>
  doorAt: Map<string, Door>
  windows: Set<string>
}

const geometryCache = new WeakMap<LocationData, MapGeometry>()

function geometry(location: LocationData): MapGeometry {
  let g = geometryCache.get(location)
  if (!g) {
    g = { walls: new Set(), doorAt: new Map(), windows: new Set() }
    for (const wall of location.walls) g.walls.add(edgeKey(wall.side, wall.x, wall.y))
    for (const door of location.doors) {
      for (const e of segmentEdges(door) ?? []) g.doorAt.set(edgeKey(e.side, e.x, e.y), door)
    }
    for (const win of location.windows) {
      for (const e of segmentEdges(win) ?? []) g.windows.add(edgeKey(e.side, e.x, e.y))
    }
    geometryCache.set(location, g)
  }
  return g
}

export function isFloor(location: LocationData, x: number, y: number): boolean {
  return location.floorPlan[y]?.[x] === '.'
}

/** Что стоит на ребре: ничего, стена, окно или дверь (с текущим состоянием). */
export type EdgeContent = { kind: 'none' } | { kind: 'wall' } | { kind: 'window' } | { kind: 'door'; door: Door; state: DoorState }

export function edgeContent(location: LocationData, edge: EdgeRef, doors: DoorStates = {}): EdgeContent {
  const g = geometry(location)
  const key = edgeKey(edge.side, edge.x, edge.y)
  if (!g.walls.has(key)) return { kind: 'none' }
  const door = g.doorAt.get(key)
  if (door) return { kind: 'door', door, state: doorState(door, doors) }
  if (g.windows.has(key)) return { kind: 'window' }
  return { kind: 'wall' }
}

/** Мешает ли ребро пройти: стена, окно, закрытая или запертая дверь. */
function blocksMovement(content: EdgeContent): boolean {
  return content.kind === 'wall' || content.kind === 'window' || (content.kind === 'door' && content.state !== 'open')
}

/** Мешает ли ребро видеть: стена и закрытая/запертая дверь. Окно и открытая дверь — не мешают. */
function blocksSight(content: EdgeContent): boolean {
  return content.kind === 'wall' || (content.kind === 'door' && content.state !== 'open')
}

/**
 * Почему нельзя шагнуть из клетки `from` в соседнюю клетку `to` (по стороне или по диагонали).
 * Возвращает null, если шаг возможен, иначе — причину на русском.
 */
export function stepBlocker(location: LocationData, from: CellPosition, to: CellPosition, doors: DoorStates = {}): string | null {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return 'клетки не соседние'
  if (!isFloor(location, from.x, from.y) || !isFloor(location, to.x, to.y)) return 'там нет пола'

  const describe = (content: EdgeContent): string => {
    if (content.kind === 'door') return content.state === 'locked' ? `«${content.door.name}» заперта` : `«${content.door.name}» закрыта`
    if (content.kind === 'window') return 'мешает окно'
    return 'мешает стена'
  }

  if (dx === 0 || dy === 0) {
    const content = edgeContent(location, edgeBetween(from, to), doors)
    return blocksMovement(content) ? describe(content) : null
  }

  // Диагональ проходит через общий угол клеток: все четыре ребра у этого угла должны быть свободны,
  // а обе боковые клетки — полом. Иначе персонаж «протискивается» между углами стен.
  if (!isFloor(location, from.x + dx, from.y) || !isFloor(location, from.x, from.y + dy)) return 'по диагонали мешает угол'
  const cx = Math.max(from.x, to.x)
  const cy = Math.max(from.y, to.y)
  const around: EdgeRef[] = [
    { side: 'h', x: cx - 1, y: cy },
    { side: 'h', x: cx, y: cy },
    { side: 'v', x: cx, y: cy - 1 },
    { side: 'v', x: cx, y: cy },
  ]
  for (const edge of around) {
    if (blocksMovement(edgeContent(location, edge, doors))) return 'по диагонали нельзя протиснуться между углами стен'
  }
  return null
}

/** Можно ли шагнуть из клетки `from` в соседнюю клетку `to`. */
export function canStep(location: LocationData, from: CellPosition, to: CellPosition, doors: DoorStates = {}): boolean {
  return stepBlocker(location, from, to, doors) === null
}

/**
 * Есть ли линия видимости от центра клетки `from` до центра клетки `to`.
 * Её перекрывают стены и закрытые двери (касание угла стены тоже перекрывает); окна и открытые двери — нет.
 * Это заготовка: объекты, существа, свет и укрытие пока не учитываются.
 */
export function hasLineOfSight(location: LocationData, from: CellPosition, to: CellPosition, doors: DoorStates = {}): boolean {
  const ax = from.x + 0.5
  const ay = from.y + 0.5
  const bx = to.x + 0.5
  const by = to.y + 0.5
  const blocked = (side: EdgeSide, x: number, y: number) => blocksSight(edgeContent(location, { side, x, y }, doors))

  // Пересечения с вертикальными линиями сетки x = X.
  for (let X = Math.min(from.x, to.x) + 1; X <= Math.max(from.x, to.x); X++) {
    const y = ay + ((by - ay) * (X - ax)) / (bx - ax)
    const cell = Math.floor(y)
    if (blocked('v', X, cell)) return false
    if (Number.isInteger(y) && blocked('v', X, y - 1)) return false
  }
  // Пересечения с горизонтальными линиями сетки y = Y.
  for (let Y = Math.min(from.y, to.y) + 1; Y <= Math.max(from.y, to.y); Y++) {
    const x = ax + ((bx - ax) * (Y - ay)) / (by - ay)
    const cell = Math.floor(x)
    if (blocked('h', cell, Y)) return false
    if (Number.isInteger(x) && blocked('h', x - 1, Y)) return false
  }
  return true
}

/** Что перекрывает прямую: `sight` — стены и закрытые двери (как hasLineOfSight); `solid` — ещё и окна (полное укрытие). */
export type SegmentMode = 'sight' | 'solid'

/**
 * Перекрыта ли прямая между двумя любыми точками карты (в клетках, непрерывные координаты) — для областей воздействия:
 * SRD «If all straight lines extending from the point of origin to a location are blocked…». Касание угла стены тоже
 * перекрывает. Точка на самой линии сетки (угол, середина стороны клетки) сдвигается на волосок к другой точке —
 * так стена, на которой лежит начало, перекрывает прямые сквозь себя.
 */
export function segmentBlocked(location: LocationData, from: { x: number; y: number }, to: { x: number; y: number }, doors: DoorStates = {}, mode: SegmentMode = 'solid'): boolean {
  const len = Math.hypot(to.x - from.x, to.y - from.y)
  if (len === 0) return false
  const nudge = 1e-7 / len
  const onLine = (v: number) => Number.isInteger(v)
  const ax = onLine(from.x) ? from.x + (to.x - from.x) * nudge : from.x
  const ay = onLine(from.y) ? from.y + (to.y - from.y) * nudge : from.y
  const bx = to.x
  const by = to.y
  const blocks = (side: EdgeSide, x: number, y: number) => {
    const content = edgeContent(location, { side, x, y }, doors)
    return mode === 'solid' ? blocksMovement(content) : blocksSight(content)
  }
  if (ax !== bx) {
    for (let X = Math.floor(Math.min(ax, bx)) + 1; X < Math.max(ax, bx); X++) {
      const y = ay + ((by - ay) * (X - ax)) / (bx - ax)
      if (blocks('v', X, Math.floor(y))) return true
      if (onLine(y) && blocks('v', X, y - 1)) return true
    }
  }
  if (ay !== by) {
    for (let Y = Math.floor(Math.min(ay, by)) + 1; Y < Math.max(ay, by); Y++) {
      const x = ax + ((bx - ax) * (Y - ay)) / (by - ay)
      if (blocks('h', Math.floor(x), Y)) return true
      if (onLine(x) && blocks('h', x - 1, Y)) return true
    }
  }
  return false
}
