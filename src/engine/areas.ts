// Измерения на клеточной карте и области воздействия (SRD 5.2.1, глоссарий: Area of Effect, Cone, Cube, Cylinder,
// Emanation, Line, Sphere; «Playing on a Grid»). Чистые функции без React и без формата локации — ими пользуются
// линейка и шаблоны на карте, инструмент ведущего show_area, а дальше — бой (этап 8) и заклинания (9.2).
//
// Координаты — в клетках, непрерывные: клетка (x, y) занимает квадрат [x, x+1] × [y, y+1], её центр — (x+0.5, y+0.5),
// узел сетки — целые x и y. Размеры шаблонов — в футах (как в описаниях заклинаний), клетка — `cellFeet` футов.
// Направление — градусы по экрану: 0 — восток (+x), 90 — юг (+y), 180 — запад, 270 — север.
//
// Расстояния (линейка, дальность): по правилам сетки SRD — каждая клетка, и по диагонали тоже, стоит 5 футов
// (Чебышёв). Области — геометрические фигуры из глоссария; клетка задета, если фигура покрывает не меньше половины
// клетки (`COVERAGE_THRESHOLD`, считается по точкам-образцам внутри клетки — `COVERAGE_SAMPLES`²) и до этих точек
// есть хотя бы одна прямая от точки начала, не перекрытая полным укрытием (`blocked` — стены, закрытые двери).
// Это буквально SRD: фигуры заданы геометрически, правило сетки — только для дальности и движения. Поэтому по
// диагонали фигура короче, чем клеток на линейке (линия 30 фт. по диагонали — 4 клетки). Метрика `grid`
// (`AreaGrid.metric`) меряет и фигуры по правилу сетки: сфера — квадрат, по диагонали столько же клеток, сколько
// по стороне; по умолчанию — `euclidean`.

import type { CellPosition } from '../types/location'

export type AreaShape = 'cone' | 'cube' | 'cylinder' | 'emanation' | 'line' | 'sphere'
export const AREA_SHAPES: readonly AreaShape[] = ['cone', 'cube', 'cylinder', 'emanation', 'line', 'sphere']

export const AREA_SHAPE_NAMES: Record<AreaShape, string> = {
  cone: 'Конус',
  cube: 'Куб',
  cylinder: 'Цилиндр',
  emanation: 'Излучение',
  line: 'Линия',
  sphere: 'Сфера',
}

/** Входит ли точка начала в область (SRD: сфера и цилиндр — да; конус, куб, линия, излучение — нет, если создатель не решит иначе). */
export const ORIGIN_INCLUDED: Record<AreaShape, boolean> = {
  cone: false,
  cube: false,
  cylinder: true,
  emanation: false,
  line: false,
  sphere: true,
}

/** Фигуры с направлением (у остальных его нет). */
export const DIRECTED_SHAPES: readonly AreaShape[] = ['cone', 'cube', 'line']

/** Ширина линии по умолчанию, футов (у большинства заклинаний SRD — 5). */
export const DEFAULT_LINE_WIDTH = 5
/** Клетка задета, если фигура покрывает не меньше этой доли клетки. */
export const COVERAGE_THRESHOLD = 0.5
/** Образцов по каждой оси клетки (всего — квадрат). */
export const COVERAGE_SAMPLES = 4
/** Предел размера шаблона, футов (больше в SRD нет — и это защита от огромных циклов). */
export const MAX_AREA_FEET = 1000

const EPS = 1e-9

export interface Point {
  x: number
  y: number
}

/** Прямоугольник клеток (пространство существа или объекта). */
export interface CellRect {
  x: number
  y: number
  w: number
  h: number
}

/** Шаблон области воздействия. */
export interface AreaTemplate {
  shape: AreaShape
  /** Точка начала (в клетках, непрерывная). У излучения — центр пространства источника. */
  origin: Point
  /** Футы: длина конуса и линии, радиус сферы, цилиндра и излучения, сторона куба. */
  size: number
  /** Направление в градусах (конус, линия, куб; куб — по 8 направлениям сетки). */
  direction?: number
  /** Ширина линии, футов (по умолчанию 5). */
  width?: number
  /** Высота цилиндра, футов: на плоской карте не влияет на клетки, только для описания. */
  height?: number
  /** Пространство источника излучения (клетки). Нет — клетка, в которой точка начала. */
  space?: CellRect
  /** Включить точку начала (клетку с ней или пространство излучения) вопреки правилу фигуры. */
  includeOrigin?: boolean
}

/** Как мерить фигуры: `euclidean` — геометрия (по умолчанию), `grid` — по правилу сетки «диагональ — 5 футов». */
export type AreaMetric = 'euclidean' | 'grid'

/** Карта для расчёта области: размер, футы в клетке и (необязательно) что перекрывает прямые и какие клетки годятся. */
export interface AreaGrid {
  width: number
  height: number
  cellFeet: number
  /** Перекрыта ли прямая от точки a до точки b полным укрытием (стена, закрытая дверь). */
  blocked?: (a: Point, b: Point) => boolean
  /** Клетка может быть в области (например, только пол). */
  cellAllowed?: (x: number, y: number) => boolean
  metric?: AreaMetric
}

// ---------- Расстояния ----------

/** Расстояние между клетками в клетках по правилам сетки SRD: каждая клетка, и по диагонали, — одна (Чебышёв). */
export const gridDistance = (a: CellPosition, b: CellPosition): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))

/** Расстояние между клетками в футах («диагональ — 5 футов»). */
export const gridDistanceFeet = (a: CellPosition, b: CellPosition, cellFeet: number): number => gridDistance(a, b) * cellFeet

/**
 * Дальность между пространствами (существа или предметы любого размера), футов — SRD «Ranges»: считать клетки от
 * клетки рядом с одним до пространства другого по кратчайшему пути. Соседние — 5 футов, пересекаются — 0.
 */
export function spaceDistanceFeet(a: CellRect, b: CellRect, cellFeet: number): number {
  const gap = (a0: number, aw: number, b0: number, bw: number) => Math.max(0, b0 - (a0 + aw - 1), a0 - (b0 + bw - 1))
  return Math.max(gap(a.x, a.w, b.x, b.w), gap(a.y, a.h, b.y, b.h)) * cellFeet
}

/** Направление от a к b в градусах [0, 360). */
export function directionBetween(a: Point, b: Point): number {
  const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
  return ((deg % 360) + 360) % 360
}

/** Округлить направление до шага (по умолчанию — 8 направлений сетки). */
export function snapDirection(deg: number, step = 45): number {
  return (((Math.round(deg / step) * step) % 360) + 360) % 360
}

/** Направления сетки — имена для инструмента ведущего. */
export const COMPASS: Record<string, number> = {
  east: 0,
  southeast: 45,
  south: 90,
  southwest: 135,
  west: 180,
  northwest: 225,
  north: 270,
  northeast: 315,
}

/** Округлить футы до клеток (шаг — клетка, не меньше одной). */
export const snapFeet = (feet: number, cellFeet: number): number => Math.max(cellFeet, Math.round(feet / cellFeet) * cellFeet)

// ---------- Фигуры ----------

const unit = (deg: number) => {
  const r = (deg * Math.PI) / 180
  // Округление убирает «почти ноль» (cos 90° ≈ 6e-17), чтобы точки на оси не уезжали за край.
  const c = Math.round(Math.cos(r) * 1e12) / 1e12
  const s = Math.round(Math.sin(r) * 1e12) / 1e12
  return { x: c, y: s }
}

/** Клетка, внутри которой лежит точка (не на линии сетки), или null. */
function cellContaining(p: Point): CellPosition | null {
  if (Number.isInteger(p.x) || Number.isInteger(p.y)) return null
  return { x: Math.floor(p.x), y: Math.floor(p.y) }
}

/** Пространство источника излучения: заданное или клетка с точкой начала. */
function emanationSpace(t: AreaTemplate): CellRect {
  return t.space ?? { x: Math.floor(t.origin.x), y: Math.floor(t.origin.y), w: 1, h: 1 }
}

/**
 * Куб на сетке: стороны по линиям сетки, точка начала на грани. Направление округляется до 8 направлений: по стороне —
 * точка начала в середине грани, по диагонали — в углу куба. Возвращает прямоугольник (непрерывный, в клетках).
 */
export function cubeBox(t: Pick<AreaTemplate, 'origin' | 'size' | 'direction'>, cellFeet: number): CellRect {
  const s = t.size / cellFeet
  const u = unit(snapDirection(t.direction ?? 0))
  const span = (o: number, d: number) => (d > 0.5 ? [o, o + s] : d < -0.5 ? [o - s, o] : [o - s / 2, o + s / 2])
  const [x0, x1] = span(t.origin.x, u.x)
  const [y0, y1] = span(t.origin.y, u.y)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

const norm = (dx: number, dy: number, metric: AreaMetric) => (metric === 'grid' ? Math.max(Math.abs(dx), Math.abs(dy)) : Math.hypot(dx, dy))
/** Во сколько раз по правилу сетки длиннее отрезок в направлении u: 1 по стороне, √2 по диагонали. */
const gridStretch = (u: Point, metric: AreaMetric) => (metric === 'grid' ? 1 / Math.max(Math.abs(u.x), Math.abs(u.y)) : 1)

/** Лежит ли точка в фигуре (без учёта укрытия и правила точки начала). */
export function pointInArea(t: AreaTemplate, p: Point, cellFeet: number, metric: AreaMetric = 'euclidean'): boolean {
  const L = t.size / cellFeet
  const dx = p.x - t.origin.x
  const dy = p.y - t.origin.y
  switch (t.shape) {
    case 'sphere':
    case 'cylinder':
      return norm(dx, dy, metric) <= L + EPS
    case 'cone':
    case 'line': {
      const u = unit(t.direction ?? 0)
      const along = dx * u.x + dy * u.y
      const across = Math.abs(dx * u.y - dy * u.x)
      if (along <= EPS || along > L * gridStretch(u, metric) + EPS) return false
      // Конус: ширина в каждой точке равна расстоянию от точки начала (полуширина — половина).
      return t.shape === 'cone' ? across <= along / 2 + EPS : across <= (t.width ?? DEFAULT_LINE_WIDTH) / cellFeet / 2 + EPS
    }
    case 'cube': {
      const b = cubeBox(t, cellFeet)
      return p.x >= b.x - EPS && p.x <= b.x + b.w + EPS && p.y >= b.y - EPS && p.y <= b.y + b.h + EPS
    }
    case 'emanation': {
      const s = emanationSpace(t)
      const ex = Math.max(s.x - p.x, 0, p.x - (s.x + s.w))
      const ey = Math.max(s.y - p.y, 0, p.y - (s.y + s.h))
      return norm(ex, ey, metric) <= L + EPS
    }
  }
}

/** Габариты фигуры (для перебора клеток). */
function bounds(t: AreaTemplate, cellFeet: number): CellRect {
  const L = t.size / cellFeet
  if (t.shape === 'cube') return cubeBox(t, cellFeet)
  if (t.shape === 'emanation') {
    const s = emanationSpace(t)
    return { x: s.x - L, y: s.y - L, w: s.w + 2 * L, h: s.h + 2 * L }
  }
  // С запасом на метрику сетки: по диагонали фигура длиннее в √2 раз, сфера — квадрат.
  const len = L * Math.SQRT2
  const r = t.shape === 'line' ? Math.hypot(len, (t.width ?? DEFAULT_LINE_WIDTH) / cellFeet / 2) : t.shape === 'cone' ? len * Math.hypot(1, 0.5) : len
  return { x: t.origin.x - r, y: t.origin.y - r, w: 2 * r, h: 2 * r }
}

/** Что не так с шаблоном (null — всё в порядке). Проверяет и событие истории, и вызов ведущего. */
export function areaTemplateProblem(t: AreaTemplate, grid: Pick<AreaGrid, 'width' | 'height' | 'cellFeet'>): string | null {
  if (!AREA_SHAPES.includes(t.shape)) return `Фигура — одна из: ${AREA_SHAPES.join(', ')}.`
  const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
  if (!t.origin || !finite(t.origin.x) || !finite(t.origin.y)) return 'Неверная точка начала области.'
  if (t.origin.x < 0 || t.origin.y < 0 || t.origin.x > grid.width || t.origin.y > grid.height) return 'Точка начала области за пределами карты.'
  if (!finite(t.size) || t.size <= 0 || t.size > MAX_AREA_FEET) return `Размер области — от 1 до ${MAX_AREA_FEET} футов.`
  if (t.direction !== undefined && !finite(t.direction)) return 'Направление — число градусов.'
  if (DIRECTED_SHAPES.includes(t.shape) && t.direction === undefined) return `У фигуры «${AREA_SHAPE_NAMES[t.shape]}» нужно направление.`
  if (t.width !== undefined && (!finite(t.width) || t.width <= 0 || t.width > MAX_AREA_FEET)) return 'Неверная ширина линии.'
  if (t.height !== undefined && (!finite(t.height) || t.height <= 0 || t.height > MAX_AREA_FEET)) return 'Неверная высота цилиндра.'
  if (t.space) {
    const s = t.space
    if (![s.x, s.y, s.w, s.h].every(Number.isInteger) || s.w < 1 || s.h < 1 || s.x < 0 || s.y < 0 || s.x + s.w > grid.width || s.y + s.h > grid.height)
      return 'Пространство источника излучения — целые клетки в пределах карты.'
  }
  return null
}

/**
 * Клетки, задетые областью: фигура покрывает не меньше половины клетки и до покрытых точек есть неперекрытая прямая
 * от точки начала. Точка начала исключается по правилу фигуры (`ORIGIN_INCLUDED`, `includeOrigin`): у конуса, куба
 * и линии — клетка, внутри которой она лежит; у излучения — пространство источника.
 * Порядок — по строкам, слева направо.
 */
export function areaCells(t: AreaTemplate, grid: AreaGrid): CellPosition[] {
  const { cellFeet } = grid
  const metric = grid.metric ?? 'euclidean'
  const include = t.includeOrigin ?? ORIGIN_INCLUDED[t.shape]
  const space = t.shape === 'emanation' ? emanationSpace(t) : null
  const originCell = t.shape === 'emanation' ? null : cellContaining(t.origin)
  // Прямые к точкам излучения ведутся от центра пространства источника.
  const from = space ? { x: space.x + space.w / 2, y: space.y + space.h / 2 } : t.origin
  const b = bounds(t, cellFeet)
  const x0 = Math.max(0, Math.floor(b.x - EPS))
  const y0 = Math.max(0, Math.floor(b.y - EPS))
  const x1 = Math.min(grid.width - 1, Math.ceil(b.x + b.w + EPS) - 1)
  const y1 = Math.min(grid.height - 1, Math.ceil(b.y + b.h + EPS) - 1)
  const n = COVERAGE_SAMPLES
  const need = Math.ceil(n * n * COVERAGE_THRESHOLD - EPS)
  const out: CellPosition[] = []
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (grid.cellAllowed && !grid.cellAllowed(x, y)) continue
      if (!include && originCell && originCell.x === x && originCell.y === y) continue
      if (!include && space && x >= space.x && x < space.x + space.w && y >= space.y && y < space.y + space.h) continue
      let hits = 0
      let left = n * n
      for (let j = 0; j < n && hits < need && hits + left >= need; j++) {
        for (let i = 0; i < n; i++) {
          left--
          const p = { x: x + (i + 0.5) / n, y: y + (j + 0.5) / n }
          if (pointInArea(t, p, cellFeet, metric) && !(grid.blocked && grid.blocked(from, p))) hits++
        }
      }
      if (hits >= need) out.push({ x, y })
    }
  }
  return out
}

/** Существо или объект на карте для списка задетых областью. */
export interface AreaOccupant {
  id: string
  space: CellRect
}

/** Кто задет областью: хотя бы одна клетка пространства — в области. Порядок — как во входном списке. */
export function occupantsInArea<T extends AreaOccupant>(cells: readonly CellPosition[], occupants: readonly T[]): T[] {
  const set = new Set(cells.map((c) => `${c.x},${c.y}`))
  return occupants.filter((o) => {
    for (let y = o.space.y; y < o.space.y + o.space.h; y++) for (let x = o.space.x; x < o.space.x + o.space.w; x++) if (set.has(`${x},${y}`)) return true
    return false
  })
}

/**
 * Точка начала у края пространства существа или объекта в сторону направления (SRD: конус, линия и куб «от себя»
 * начинаются на границе своего пространства). У куба — по 8 направлениям: середина стороны или угол.
 */
export function edgeOrigin(space: CellRect, direction: number, shape: AreaShape = 'cone'): Point {
  const cx = space.x + space.w / 2
  const cy = space.y + space.h / 2
  const u = unit(shape === 'cube' ? snapDirection(direction) : direction)
  if (shape === 'cube') {
    const side = (c: number, half: number, d: number) => (d > 0.5 ? c + half : d < -0.5 ? c - half : c)
    return { x: side(cx, space.w / 2, u.x), y: side(cy, space.h / 2, u.y) }
  }
  // Луч из центра до границы прямоугольника.
  const tx = Math.abs(u.x) < EPS ? Infinity : space.w / 2 / Math.abs(u.x)
  const ty = Math.abs(u.y) < EPS ? Infinity : space.h / 2 / Math.abs(u.y)
  const k = Math.min(tx, ty)
  return { x: cx + u.x * k, y: cy + u.y * k }
}

/** Контур фигуры для отрисовки (в клетках). */
export type AreaOutline =
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'polygon'; points: Point[] }
  | { kind: 'rounded'; x: number; y: number; w: number; h: number; r: number }

export function areaOutline(t: AreaTemplate, cellFeet: number, metric: AreaMetric = 'euclidean'): AreaOutline {
  const L = t.size / cellFeet
  const o = t.origin
  switch (t.shape) {
    case 'sphere':
    case 'cylinder':
      return metric === 'grid' ? { kind: 'rounded', x: o.x - L, y: o.y - L, w: 2 * L, h: 2 * L, r: 0 } : { kind: 'circle', cx: o.x, cy: o.y, r: L }
    case 'cube': {
      const b = cubeBox(t, cellFeet)
      return { kind: 'polygon', points: [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }] }
    }
    case 'emanation': {
      const s = emanationSpace(t)
      return { kind: 'rounded', x: s.x - L, y: s.y - L, w: s.w + 2 * L, h: s.h + 2 * L, r: metric === 'grid' ? 0 : L }
    }
    case 'cone':
    case 'line': {
      const u = unit(t.direction ?? 0)
      const n = { x: -u.y, y: u.x }
      const half = t.shape === 'cone' ? (L * gridStretch(u, metric)) / 2 : (t.width ?? DEFAULT_LINE_WIDTH) / cellFeet / 2
      const reach = L * gridStretch(u, metric)
      const end = { x: o.x + u.x * reach, y: o.y + u.y * reach }
      const at = (p: Point, k: number) => ({ x: p.x + n.x * k, y: p.y + n.y * k })
      return { kind: 'polygon', points: t.shape === 'cone' ? [o, at(end, half), at(end, -half)] : [at(o, half), at(end, half), at(end, -half), at(o, -half)] }
    }
  }
}

/** Короткое описание шаблона: «Конус 15 фт.», «Линия 30 × 5 фт.», «Цилиндр 10 фт. (высота 40 фт.)». */
export function areaLabel(t: Pick<AreaTemplate, 'shape' | 'size' | 'width' | 'height'>): string {
  const name = AREA_SHAPE_NAMES[t.shape]
  if (t.shape === 'line') return `${name} ${t.size} × ${t.width ?? DEFAULT_LINE_WIDTH} фт.`
  if (t.shape === 'cylinder' && t.height) return `${name} ${t.size} фт. (высота ${t.height} фт.)`
  return `${name} ${t.size} фт.`
}
