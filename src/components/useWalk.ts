// Плавное перемещение фишек по клеткам пути: фишка переходит из клетки в клетку (CSS-переход transform), а не
// прыгает. Путь — walkPath (src/game/mapView.ts) с учётом стен и закрытых дверей; длинный или невозможный путь —
// одним переходом. При «уменьшить движение» — сразу на место. Один таймер на все фишки: положение общее для тела
// фишки (слой фишек) и её подписи (слой интерфейса).
import { useEffect, useRef, useState } from 'react'
import type { CellPosition } from '../types/location'
import { MAX_WALK_STEPS } from '../game/mapView'

/** Сколько длится шаг на одну клетку, мс (то же значение — в переходе .map-token в index.css). */
export const WALK_STEP_MS = 140

const reducedMotion = () => document.documentElement.dataset.motion === 'reduce'

export interface Walks {
  /** Где фишка сейчас (во время перемещения — промежуточная клетка). */
  pos: Record<string, CellPosition>
  /** Какие фишки ещё идут. */
  walking: Set<string>
}

export function useWalks(targets: Record<string, CellPosition>, path: (from: CellPosition, to: CellPosition) => CellPosition[] | null): Walks {
  const [state, setState] = useState<Walks>({ pos: targets, walking: new Set() })
  const current = useRef(targets)
  const queues = useRef<Record<string, CellPosition[]>>({})
  const timer = useRef(0)
  const pathRef = useRef(path)
  useEffect(() => {
    pathRef.current = path
  }, [path])
  const key = Object.entries(targets)
    .map(([id, p]) => `${id}:${p.x},${p.y}`)
    .join('|')

  useEffect(() => {
    const next = { ...current.current }
    for (const id of Object.keys(next)) if (!(id in targets)) delete next[id]
    for (const [id, to] of Object.entries(targets)) {
      const from = next[id]
      if (!from) {
        next[id] = to
        continue
      }
      if (from.x === to.x && from.y === to.y) {
        delete queues.current[id]
        continue
      }
      let steps = reducedMotion() ? null : pathRef.current(from, to)
      if (!steps || steps.length === 0 || steps.length > MAX_WALK_STEPS) steps = [to]
      queues.current[id] = steps
    }
    current.current = next
    window.clearTimeout(timer.current)
    const step = () => {
      const pos = { ...current.current }
      for (const [id, queue] of Object.entries(queues.current)) {
        const cell = queue.shift()
        if (cell) pos[id] = cell
      }
      current.current = pos
      const walking = new Set(Object.keys(queues.current))
      for (const [id, queue] of Object.entries(queues.current)) if (queue.length === 0) delete queues.current[id]
      setState({ pos, walking })
      // Последний шаг ещё анимируется — «идёт» снимается после него.
      timer.current = window.setTimeout(Object.keys(queues.current).length ? step : () => setState({ pos: current.current, walking: new Set() }), WALK_STEP_MS)
    }
    if (Object.keys(queues.current).length) step()
    else setState({ pos: next, walking: new Set() })
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => window.clearTimeout(timer.current), [])
  return state
}
