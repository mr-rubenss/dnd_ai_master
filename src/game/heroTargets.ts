// Цели на карте для инструментов ведущего (move_hero, ping, reveal): НПС, объект, дверь или окно по id или названию,
// их область в клетках; путь героя к цели — ближайшая свободная клетка рядом (A*), причина, если не дойти (какая
// дверь мешает), и обрезка пути по скорости в бою. Чистые функции.
import { pathFeet } from '../engine/pathfinding'
import type { CellPosition, DoorState, GridSegment, LocationData } from '../types/location'
import type { StoryState } from '../types/story'
import { approachCell, combatBudget, heroMovePlan, type HeroMovePlan } from './heroMove'

export interface MapArea {
  x: number
  y: number
  w: number
  h: number
}

export interface MapTarget {
  kind: 'npc' | 'object' | 'door' | 'window'
  id: string
  name: string
  area: MapArea
  hidden?: boolean
}

const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е')

/** Клетки по обе стороны отрезка двери или окна (в пределах карты). */
export function segmentArea(location: LocationData, s: GridSegment): MapArea {
  const horizontal = s.y1 === s.y2
  const area = horizontal
    ? { x: Math.min(s.x1, s.x2), y: s.y1 - 1, w: Math.abs(s.x2 - s.x1), h: 2 }
    : { x: s.x1 - 1, y: Math.min(s.y1, s.y2), w: 2, h: Math.abs(s.y2 - s.y1) }
  const x = Math.max(0, area.x)
  const y = Math.max(0, area.y)
  return { x, y, w: Math.min(location.width, area.x + area.w) - x, h: Math.min(location.height, area.y + area.h) - y }
}

/** Все цели карты (НПС, объекты, двери, окна). */
export function mapTargets(location: LocationData): MapTarget[] {
  return [
    ...location.npcs.map((n) => ({ kind: 'npc' as const, id: n.id, name: n.name, area: { x: n.x, y: n.y, w: 1, h: 1 }, ...(n.hidden ? { hidden: true } : {}) })),
    ...location.objects.map((o) => ({ kind: 'object' as const, id: o.id, name: o.name, area: { x: o.x, y: o.y, w: o.w ?? 1, h: o.h ?? 1 }, ...(o.hidden ? { hidden: true } : {}) })),
    ...location.doors.map((d) => ({ kind: 'door' as const, id: d.id, name: d.name, area: segmentArea(location, d) })),
    ...location.windows.map((w) => ({ kind: 'window' as const, id: w.id, name: w.name ?? 'Окно', area: segmentArea(location, w) })),
  ]
}

/** Цель по id или названию; иначе — текст отказа со списком. */
export function findMapTarget(location: LocationData, query: string): MapTarget | string {
  const all = mapTargets(location)
  const exact = all.find((t) => t.id === query)
  if (exact) return exact
  const named = all.filter((t) => norm(t.name) === norm(query))
  if (named.length === 1) return named[0]
  if (named.length > 1) return `Целей с названием «${query}» несколько — укажи id: ${named.map((t) => t.id).join(', ')}.`
  const list = all
    .filter((t) => t.kind !== 'object' || !['chair', 'candle', 'rug'].includes(location.objects.find((o) => o.id === t.id)?.type ?? ''))
    .map((t) => `${t.name} (${t.id})`)
  return `Цели «${query}» на карте нет. Есть: ${list.join(', ')}.`
}

export type HeroRoute = { cell: CellPosition; plan: HeroMovePlan } | { blocked: string }

const DOOR_WORDS: Record<DoorState, string> = { open: 'открыта', closed: 'закрыта', locked: 'заперта' }

/**
 * Путь героя к цели без учёта скорости: ближайшая свободная клетка рядом (у двери и окна — по любую сторону).
 * Не дойти — причина: какая закрытая или запертая дверь перекрывает путь, или стены и мебель вокруг.
 */
export function routeToTarget(location: LocationData, state: Pick<StoryState, 'party' | 'world' | 'combat'>, heroId: string, target: MapTarget): HeroRoute {
  const best = (s: Pick<StoryState, 'party' | 'world' | 'combat'>) => {
    if (target.kind === 'door' || target.kind === 'window') {
      let found: { cell: CellPosition; plan: HeroMovePlan } | null = null
      for (let y = target.area.y; y < target.area.y + target.area.h; y++)
        for (let x = target.area.x; x < target.area.x + target.area.w; x++) {
          const plan = heroMovePlan(location, s, heroId, { x, y }, { ignoreBudget: true })
          if (typeof plan !== 'string' && (!found || plan.path.length < found.plan.path.length)) found = { cell: { x, y }, plan }
        }
      return found
    }
    return approachCell(location, s, heroId, target.area, { ignoreBudget: true })
  }
  const route = best(state)
  if (route) return route
  // Не дойти: виновата ли закрытая дверь? Пробуем открыть по одной.
  const doors = state.world.doors[location.id] ?? {}
  const closed = location.doors.filter((d) => (doors[d.id] ?? d.state) !== 'open')
  const withDoors = (open: string[]) => ({
    ...state,
    world: { ...state.world, doors: { ...state.world.doors, [location.id]: { ...doors, ...Object.fromEntries(open.map((id) => [id, 'open' as const])) } } },
  })
  for (const d of closed)
    if (best(withDoors([d.id])))
      return { blocked: `Не дойти до «${target.name}»: путь перекрывает дверь «${d.name}» — она ${DOOR_WORDS[doors[d.id] ?? d.state]}.` }
  if (closed.length && best(withDoors(closed.map((d) => d.id))))
    return { blocked: `Не дойти до «${target.name}»: путь перекрывают закрытые двери (${closed.map((d) => `«${d.name}»`).join(', ')}).` }
  return { blocked: `Не дойти до «${target.name}»: рядом нет свободной клетки или путь перекрыт стенами и мебелью.` }
}

/** В бою путь обрезается по остатку скорости: сколько клеток хватает. */
export function limitBySpeed(state: Pick<StoryState, 'combat'>, heroId: string, plan: HeroMovePlan, cellFeet: number) {
  const budget = combatBudget(state, heroId)
  if (budget === null || plan.feet <= budget) return { path: plan.path, feet: plan.feet, short: 0, budget }
  const steps = Math.floor(budget / cellFeet)
  const path = plan.path.slice(0, steps)
  return { path, feet: pathFeet(path, cellFeet), short: plan.feet - pathFeet(path, cellFeet), budget }
}
