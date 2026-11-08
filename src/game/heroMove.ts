// Перемещение героя игроком по карте: путь A* (src/engine/pathfinding.ts) с учётом стен, окон, дверей в их текущем
// состоянии и занятых клеток (НПС, другие герои, мебель; на стул сесть можно, ковёр и свеча клетку не занимают).
// Длина пути — в футах. Проверка одна и для интерфейса (подсветка, отказ отпустить токен), и для движка (checkAction
// действия heroMoved). Чистые функции.
import { findPath, pathFeet, reachableCells } from '../engine/pathfinding'
import { isFloor } from '../engine/movement'
import type { CellPosition, LocationData } from '../types/location'
import type { StoryState } from '../types/story'
import { cellOccupant } from './mapPlacement'

/** Что мешает встать или пройти герою в этой локации (кроме него самого). */
export function heroBlocker(location: LocationData, state: Pick<StoryState, 'party'>, heroId: string) {
  const others = state.party.filter((m) => m.heroId !== heroId && !m.fallen).map((m) => ({ name: m.character.name, position: m.position }))
  return (cell: CellPosition) => cellOccupant(location, others, cell, { creature: true, playerView: true })
}

/** Сколько футов герой ещё может пройти в этом раунде боя; null — боя нет (ходить можно сколько угодно). */
export function combatBudget(state: Pick<StoryState, 'combat'>, heroId: string): number | null {
  const combat = state.combat
  if (!combat) return null
  return Math.max(0, (combat.speed[heroId] ?? 30) - (combat.moved[heroId] ?? 0))
}

export interface MovePlanOptions {
  /** Не учитывать скорость в бою (move_hero сам обрежет путь до остатка). */
  ignoreBudget?: boolean
}

export interface HeroMovePlan {
  path: CellPosition[]
  feet: number
}

/** Путь героя в клетку `to` или причина, почему туда нельзя (за пределами, стена, занято, путь перекрыт). */
export function heroMovePlan(
  location: LocationData,
  state: Pick<StoryState, 'party' | 'world' | 'combat'>,
  heroId: string,
  to: CellPosition,
  options: MovePlanOptions = {},
): HeroMovePlan | string {
  const member = state.party.find((m) => m.heroId === heroId)
  if (!member) return 'Такого героя нет в отряде.'
  if (member.fallen) return `${member.character.name} погиб.`
  if (!Number.isInteger(to.x) || !Number.isInteger(to.y) || to.x < 0 || to.y < 0 || to.x >= location.width || to.y >= location.height) return 'Эта клетка за пределами карты.'
  if (!isFloor(location, to.x, to.y)) return 'Туда не встать: там нет пола.'
  const occupant = heroBlocker(location, state, heroId)(to)
  if (occupant && !(to.x === member.position.x && to.y === member.position.y)) return `Клетка занята: ${occupant}.`
  const doors = state.world.doors[location.id] ?? {}
  const blocker = heroBlocker(location, state, heroId)
  const path = findPath(location, member.position, to, { doors, blocked: (c) => blocker(c) !== null })
  if (!path) return 'Туда не дойти: путь перекрывают стены, закрытые двери или мебель.'
  const feet = pathFeet(path, location.cellFeet)
  const budget = options.ignoreBudget ? null : combatBudget(state, heroId)
  if (budget !== null && feet > budget)
    return `Идёт бой: в этом раунде осталось ${budget} фт. скорости, а путь — ${feet} фт.`
  return { path, feet }
}

/** Клетки, куда герой может дойти (ключ «x,y»). */
export function heroReachable(location: LocationData, state: Pick<StoryState, 'party' | 'world' | 'combat'>, heroId: string): Set<string> {
  const member = state.party.find((m) => m.heroId === heroId)
  if (!member) return new Set()
  const blocker = heroBlocker(location, state, heroId)
  const budget = combatBudget(state, heroId)
  // В бою — только то, до чего хватает скорости в этом раунде.
  const maxSteps = budget === null ? Infinity : Math.floor(budget / location.cellFeet)
  return reachableCells(location, member.position, { doors: state.world.doors[location.id] ?? {}, blocked: (c) => blocker(c) !== null, maxSteps })
}

/**
 * Ближайшая клетка рядом с целью (НПС, предмет, дверь), куда герой может дойти, — для «Подойти». Цель — прямоугольник
 * клеток (или отрезок двери как область 1×1 по обе стороны). null — подойти нельзя.
 */
export function approachCell(
  location: LocationData,
  state: Pick<StoryState, 'party' | 'world' | 'combat'>,
  heroId: string,
  area: { x: number; y: number; w: number; h: number },
  options: MovePlanOptions = {},
): { cell: CellPosition; plan: HeroMovePlan } | null {
  const member = state.party.find((m) => m.heroId === heroId)
  if (!member) return null
  const inside = (c: CellPosition) => c.x >= area.x && c.x < area.x + area.w && c.y >= area.y && c.y < area.y + area.h
  const near = (c: CellPosition) => c.x >= area.x - 1 && c.x <= area.x + area.w && c.y >= area.y - 1 && c.y <= area.y + area.h
  // Герой уже рядом — идти никуда не нужно.
  if (near(member.position) && !inside(member.position)) return { cell: member.position, plan: { path: [], feet: 0 } }
  let best: { cell: CellPosition; plan: HeroMovePlan } | null = null
  for (let y = Math.floor(area.y) - 1; y <= Math.ceil(area.y + area.h); y++)
    for (let x = Math.floor(area.x) - 1; x <= Math.ceil(area.x + area.w); x++) {
      const cell = { x, y }
      if (inside(cell) || !near(cell)) continue
      const plan = heroMovePlan(location, state, heroId, cell, options)
      if (typeof plan !== 'string' && (!best || plan.path.length < best.plan.path.length)) best = { cell, plan }
    }
  return best
}
