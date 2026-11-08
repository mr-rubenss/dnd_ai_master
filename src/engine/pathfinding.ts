// Поиск пути по клеткам (A*) с тонкими стенами, окнами и дверями (src/engine/movement.ts: canStep) и занятыми клетками.
// Шаг — в соседнюю клетку по стороне или по диагонали; по правилам 2024 года каждая клетка, и по диагонали тоже,
// стоит одинаково (5 футов). Эвристика — расстояние Чебышёва; при равной длине путь выбирается прямее (диагонали
// чуть дороже — только для выбора, не для длины). Чистые функции.
import { canStep, isFloor, type DoorStates } from './movement'
import type { CellPosition, LocationData } from '../types/location'

export interface PathOptions {
  /** Текущие состояния дверей. */
  doors?: DoorStates
  /** Клетка занята (существо, мебель) — через неё не пройти и в ней не встать. Стартовая клетка не проверяется. */
  blocked?: (cell: CellPosition) => boolean
}

const DIAGONAL_TIE = 0.001

class MinHeap {
  private items: { key: number; f: number }[] = []
  get size() {
    return this.items.length
  }
  push(key: number, f: number) {
    const a = this.items
    a.push({ key, f })
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p].f <= a[i].f) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }
  pop(): number {
    const a = this.items
    const top = a[0].key
    const last = a.pop()!
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < a.length && a[l].f < a[m].f) m = l
        if (r < a.length && a[r].f < a[m].f) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }
}

const neighbours = (c: CellPosition) => {
  const out: CellPosition[] = []
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) out.push({ x: c.x + dx, y: c.y + dy })
  return out
}

/**
 * Кратчайший путь A* из `from` в `to` (без начальной клетки); [] — уже на месте; null — пути нет
 * (стена, закрытая или запертая дверь, всё перекрыто, цель занята или не пол).
 */
export function findPath(location: LocationData, from: CellPosition, to: CellPosition, options: PathOptions = {}): CellPosition[] | null {
  const { doors = {}, blocked } = options
  if (from.x === to.x && from.y === to.y) return []
  if (!isFloor(location, to.x, to.y) || blocked?.(to)) return null
  const w = location.width
  const key = (c: CellPosition) => c.y * w + c.x
  const cell = (k: number) => ({ x: k % w, y: Math.floor(k / w) })
  const h = (c: CellPosition) => Math.max(Math.abs(c.x - to.x), Math.abs(c.y - to.y))
  const g = new Map<number, number>([[key(from), 0]])
  const prev = new Map<number, number>()
  const open = new MinHeap()
  open.push(key(from), h(from))
  const closed = new Set<number>()
  const goal = key(to)
  while (open.size) {
    const k = open.pop()
    if (k === goal) break
    if (closed.has(k)) continue
    closed.add(k)
    const c = cell(k)
    for (const n of neighbours(c)) {
      if (n.x < 0 || n.y < 0 || n.x >= w || n.y >= location.height) continue
      const nk = key(n)
      if (closed.has(nk) || (blocked?.(n) && nk !== goal)) continue
      if (!canStep(location, c, n, doors)) continue
      const cost = g.get(k)! + 1 + (n.x !== c.x && n.y !== c.y ? DIAGONAL_TIE : 0)
      if (cost >= (g.get(nk) ?? Infinity)) continue
      g.set(nk, cost)
      prev.set(nk, k)
      open.push(nk, cost + h(n))
    }
  }
  if (!prev.has(goal)) return null
  const path: CellPosition[] = []
  for (let k = goal; k !== key(from); k = prev.get(k)!) path.push(cell(k))
  return path.reverse()
}

/** Все клетки, куда можно дойти из `from` (ключ «x,y»), — для подсветки недоступных при перетаскивании. */
export function reachableCells(location: LocationData, from: CellPosition, options: PathOptions & { maxSteps?: number } = {}): Set<string> {
  const { doors = {}, blocked, maxSteps = Infinity } = options
  const seen = new Set<string>([`${from.x},${from.y}`])
  let frontier = [from]
  // Обход «кольцами»: кольцо N — клетки в N шагах (в бою — не дальше, чем хватает скорости).
  for (let step = 0; frontier.length && step < maxSteps; step++) {
    const next: CellPosition[] = []
    for (const c of frontier)
      for (const n of neighbours(c)) {
        const k = `${n.x},${n.y}`
        if (seen.has(k) || n.x < 0 || n.y < 0 || n.x >= location.width || n.y >= location.height) continue
        if (blocked?.(n) || !canStep(location, c, n, doors)) continue
        seen.add(k)
        next.push(n)
      }
    frontier = next
  }
  return seen
}

/** Длина пути в футах: каждая клетка, и по диагонали тоже, — `cellFeet` (правила 2024 года). */
export const pathFeet = (path: readonly CellPosition[], cellFeet: number) => path.length * cellFeet
