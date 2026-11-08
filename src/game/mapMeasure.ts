// Измерения игрока на клеточной карте: инструмент, жест → шаблон области. Чистые функции (отрисовка —
// src/components/MapMeasure.tsx, расчёт клеток — src/engine/areas.ts и src/game/mapAreas.ts).
import { directionBetween, DIRECTED_SHAPES, edgeOrigin, gridDistance, snapFeet, type AreaShape, type AreaTemplate, type CellRect, type Point } from '../engine/areas'
import type { CellPosition } from '../types/location'

/** Фигуры в панели «Области» (порядок кнопок). */
export const MEASURE_SHAPES: readonly AreaShape[] = ['cone', 'sphere', 'cube', 'line', 'cylinder', 'emanation']

export type MeasureTool = { kind: 'ruler' } | { kind: 'area'; shape: AreaShape }

/** Текущее измерение игрока на карте. */
export type Measurement = { kind: 'ruler'; from: CellPosition; to: CellPosition } | { kind: 'area'; template: AreaTemplate }

/** Ближайшая точка сетки с шагом полклетки: узел, середина стороны или центр клетки. */
export const snapHalf = (p: Point): Point => ({ x: Math.round(p.x * 2) / 2, y: Math.round(p.y * 2) / 2 })

/**
 * Шаблон по жесту: нажатие — начало (на существе — от него: конус, линия и куб — от края клетки, излучение — вокруг
 * него, сфера и цилиндр — из центра; на пустом месте — ближайшая точка сетки с шагом полклетки), точка под пальцем —
 * направление и размер (футы, шаг — клетка).
 */
export function templateFromDrag(shape: AreaShape, start: Point, current: Point, creature: CellRect | null, cellFeet: number): AreaTemplate {
  const base = creature ? { x: creature.x + creature.w / 2, y: creature.y + creature.h / 2 } : snapHalf(start)
  const direction = Math.round(directionBetween(base, current))
  const directed = DIRECTED_SHAPES.includes(shape)
  const origin = directed && creature ? edgeOrigin(creature, direction, shape) : base
  let reach: number
  if (shape === 'emanation') {
    const s = creature ?? { x: Math.floor(base.x), y: Math.floor(base.y), w: 1, h: 1 }
    reach = Math.hypot(Math.max(s.x - current.x, 0, current.x - (s.x + s.w)), Math.max(s.y - current.y, 0, current.y - (s.y + s.h)))
    return { shape, origin: { x: s.x + s.w / 2, y: s.y + s.h / 2 }, space: s, size: snapFeet(reach * cellFeet, cellFeet) }
  }
  reach = Math.hypot(current.x - origin.x, current.y - origin.y)
  return { shape, origin, size: snapFeet(reach * cellFeet, cellFeet), ...(directed ? { direction } : {}) }
}

/** Строка о линейке: «25 фт. (5 кл.)». */
export function rulerText(from: CellPosition, to: CellPosition, cellFeet: number): string {
  const n = gridDistance(from, to)
  return `${n * cellFeet} фт. (${n} кл.)`
}

