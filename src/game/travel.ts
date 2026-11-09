// Переходы между картами одного масштаба через выходы (дверь, дорога, лестница, край карты). Отряд уходит через
// выход текущей локации и появляется у соответствующего входа новой: у выхода `toExit`, иначе у выхода, который ведёт
// обратно, иначе у playerStart. Переход — действие движка partyTraveled (и exitLinked, если выход ещё никуда не вёл).
// Карты ещё нет — ведущий создаёт её (create_location) и переводит отряд (travel). Чистые функции.
import { canStep, doorState, isFloor } from '../engine/movement'
import { EXIT_KIND_NAMES, type CellPosition, type LocationData, type MapExit } from '../types/location'
import type { StoryEvent, StoryState } from '../types/story'
import { cellOccupant } from './mapPlacement'

/** Сколько последних локаций помнит путь отряда (строка над картой). */
export const TRAIL_MAX = 8

const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е')

/** Выход локации по id или названию. */
export function findExit(location: LocationData, query: string): MapExit | null {
  const exits = location.exits ?? []
  return exits.find((e) => e.id === query) ?? exits.find((e) => norm(e.name) === norm(query)) ?? null
}

/** Путь отряда: локации по порядку прихода (старые истории — только текущая). */
export function trailOf(state: Pick<StoryState, 'world'>): string[] {
  return state.world.trail?.length ? state.world.trail : [state.world.currentLocationId]
}

/** Путь после прихода в локацию: без повторов подряд, не длиннее TRAIL_MAX. */
export function nextTrail(trail: readonly string[], to: string): string[] {
  const next = trail.at(-1) === to ? [...trail] : [...trail, to]
  return next.slice(-TRAIL_MAX)
}

/** Вход в новой локации для отряда, пришедшего через выход `via` из `fromId`. */
export function arrivalExit(target: LocationData, fromId: string, via: MapExit): MapExit | null {
  const exits = target.exits ?? []
  return (via.toExit ? exits.find((e) => e.id === via.toExit) : undefined) ?? exits.find((e) => e.to === fromId) ?? null
}

/**
 * Клетки для отряда у входа: первая — ближайшая свободная к `start` (сама клетка, если свободна), остальные — рядом
 * (поиск в ширину по шагам, которые разрешают стены и двери). null — места не хватило.
 */
export function arrivalCells(location: LocationData, doors: Record<string, string>, start: CellPosition, count: number): CellPosition[] | null {
  const free = (c: CellPosition, taken: CellPosition[]) =>
    isFloor(location, c.x, c.y) && !cellOccupant(location, [], c, { creature: true }) && !taken.some((t) => t.x === c.x && t.y === c.y)
  const cells: CellPosition[] = []
  const seen = new Set([`${start.x},${start.y}`])
  const queue = [start]
  while (queue.length && cells.length < count) {
    const c = queue.shift()!
    if (free(c, cells)) cells.push(c)
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]]) {
      const n = { x: c.x + dx, y: c.y + dy }
      const key = `${n.x},${n.y}`
      if (seen.has(key) || !isFloor(location, n.x, n.y) || !canStep(location, c, n, doors as never)) continue
      seen.add(key)
      queue.push(n)
    }
  }
  return cells.length === count ? cells : null
}

/** Выход через запертую дверь закрыт: причина или null. */
export function exitLockProblem(state: Pick<StoryState, 'world'>, location: LocationData, exit: MapExit): string | null {
  const door = exit.door ? location.doors.find((d) => d.id === exit.door) : undefined
  return door && doorState(door, state.world.doors[location.id]) === 'locked' ? `«${door.name}» заперта — сначала её нужно отпереть.` : null
}

export interface TravelPlan {
  events: StoryEvent[]
  from: LocationData
  to: LocationData
  exit: MapExit
  arrival: MapExit | null
  /** Клетка ведущего героя в новой локации. */
  at: CellPosition
}

/**
 * Переход отряда через выход `exitQuery` текущей локации (в `toId` — если выход ещё никуда не ведёт или ведёт
 * в несозданную локацию). Причина отказа строкой — для игрока и ведущего.
 */
export function travelPlan(state: StoryState, exitQuery: string, toId?: string): TravelPlan | string {
  const from = state.world.locations[state.world.currentLocationId]
  const exit = findExit(from, exitQuery)
  if (!exit) {
    const list = (from.exits ?? []).map((e) => `${e.name} [${e.id}]`).join(', ')
    return list ? `Выхода «${exitQuery}» здесь нет. Есть: ${list}.` : `У локации «${from.name}» нет выходов.`
  }
  const locked = exitLockProblem(state, from, exit)
  if (locked) return locked
  if (exit.to && toId && exit.to !== toId && state.world.locations[exit.to])
    return `Выход «${exit.name}» ведёт в «${state.world.locations[exit.to].name}» [${exit.to}], а не в [${toId}].`
  const targetId = toId ?? exit.to
  const to = targetId ? state.world.locations[targetId] : undefined
  if (!to)
    return (
      `Карты места за выходом «${exit.name}» ещё нет${targetId ? ` ([${targetId}] не создана)` : ''}. Создай её create_location ` +
      `(выход назад — to: "${from.id}", toExit: "${exit.id}"), затем вызови travel (exit: "${exit.id}", to: id новой локации).`
    )
  if (to.id === from.id) return 'Отряд и так в этой локации.'
  const arrival = arrivalExit(to, from.id, exit)
  const heroes = state.party.filter((m) => !m.fallen)
  const start = arrival ? { x: arrival.x, y: arrival.y } : to.playerStart
  const cells = arrivalCells(to, state.world.doors[to.id] ?? {}, start, heroes.length)
  if (!cells) return `У входа в «${to.name}» нет свободного места для отряда.`
  const positions = Object.fromEntries(heroes.map((m, i) => [m.heroId, cells[i]]))
  const events: StoryEvent[] = []
  // Выход ещё никуда не вёл — теперь ведёт в новую локацию (и к её входу).
  if (exit.to !== to.id || (arrival && exit.toExit !== arrival.id))
    events.push({ type: 'exitLinked', locationId: from.id, exitId: exit.id, to: to.id, ...(arrival ? { toExit: arrival.id } : {}) })
  // Обратный выход новой локации тоже знает, куда ведёт.
  if (arrival && (arrival.to !== from.id || arrival.toExit !== exit.id)) events.push({ type: 'exitLinked', locationId: to.id, exitId: arrival.id, to: from.id, toExit: exit.id })
  events.push({ type: 'partyTraveled', from: from.id, to: to.id, exitId: exit.id, ...(arrival ? { arrivalExitId: arrival.id } : {}), positions })
  return { events, from, to, exit, arrival, at: cells[0] }
}

/** Проверка partyTraveled: из текущей локации через её выход в другую существующую, герои — на свободном полу. */
export function partyTraveledProblem(state: StoryState, e: Extract<StoryEvent, { type: 'partyTraveled' }>): string | null {
  if (e.from !== state.world.currentLocationId) return 'Отряд уходит только из текущей локации.'
  const from = state.world.locations[e.from]
  const to = state.world.locations[e.to]
  if (!to) return 'В мире этой истории нет такой локации.'
  if (to.id === from.id) return 'Отряд и так в этой локации.'
  if (!(from.exits ?? []).some((x) => x.id === e.exitId)) return 'В текущей локации нет такого выхода.'
  if (e.arrivalExitId !== undefined && !(to.exits ?? []).some((x) => x.id === e.arrivalExitId)) return 'В новой локации нет такого входа.'
  const heroes = state.party.filter((m) => !m.fallen)
  const taken: CellPosition[] = []
  for (const m of heroes) {
    const p = e.positions?.[m.heroId]
    if (!p || !Number.isInteger(p.x) || !Number.isInteger(p.y) || !isFloor(to, p.x, p.y)) return `Герою ${m.character.name} нужна клетка пола в новой локации.`
    const who = cellOccupant(to, [], p, { creature: true })
    if (who) return `Клетка (${p.x}, ${p.y}) в новой локации занята: ${who}.`
    if (taken.some((t) => t.x === p.x && t.y === p.y)) return 'Два героя не могут встать в одну клетку.'
    taken.push(p)
  }
  return null
}

/** Проверка exitLinked: выход есть, локация назначения есть, её вход (если указан) — тоже. */
export function exitLinkedProblem(state: StoryState, e: Extract<StoryEvent, { type: 'exitLinked' }>): string | null {
  const location = state.world.locations[e.locationId]
  if (!location) return 'В мире этой истории нет такой локации.'
  if (!(location.exits ?? []).some((x) => x.id === e.exitId)) return 'В этой локации нет такого выхода.'
  const to = state.world.locations[e.to]
  if (!to) return 'Выход может вести только в существующую локацию.'
  if (e.toExit !== undefined && !(to.exits ?? []).some((x) => x.id === e.toExit)) return 'В локации назначения нет такого входа.'
  return null
}

/** Строка для игрока о переходе: «Ратибор: через «Входная дверь» → «Улица у таверны»». */
export function travelText(plan: Pick<TravelPlan, 'exit' | 'to'>, name: string): string {
  return `${name}: через «${plan.exit.name}» → «${plan.to.name}».`
}

/** Заметка ведущему: отряд перешёл, опиши новое место. */
export function travelNote(plan: TravelPlan, name: string): string {
  return (
    `Отряд перешёл через выход «${plan.exit.name}» (${EXIT_KIND_NAMES[plan.exit.kind]}) из «${plan.from.name}» в «${plan.to.name}» [${plan.to.id}]. ` +
    `${name} — у ${plan.arrival ? `входа «${plan.arrival.name}»` : 'входа'}, клетка (${plan.at.x}, ${plan.at.y}). Опиши новое место (что видно, кто здесь) — карта в состоянии игры.`
  )
}

/** Начало заметки «карты за выходом нет» — по нему сверка хода узнаёт, что отряд ждёт перехода. */
export const MISSING_MAP_MARK = 'уходит через выход'
/** Сколько ходов ведущего ждать перехода, прежде чем сказать игроку, что карта не сменилась. */
export const EXIT_STUCK_TURNS = 2

/** Заметка ведущему: герой у выхода, а карты за ним ещё нет — создай и переведи. */
export function missingMapNote(from: LocationData, exit: MapExit, name: string, repeat = false): string {
  return (
    `${repeat ? 'Повтор: карта так и не сменилась. ' : ''}${name} ${MISSING_MAP_MARK} «${exit.name}» [${exit.id}] (${EXIT_KIND_NAMES[exit.kind]}) из «${from.name}». ` +
    `Карты места за ним ещё нет. Обязательно в этом ответе: create_location (выход назад — to: "${from.id}", toExit: "${exit.id}"), ` +
    `затем travel (exit: "${exit.id}", to: id новой локации), и только потом опиши новое место (можно длиннее обычного). Описание без перехода недопустимо.`
  )
}
