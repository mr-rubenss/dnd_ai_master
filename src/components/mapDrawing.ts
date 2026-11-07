// Вспомогательные расчёты для отрисовки карты (без React).
import { edgeKey, segmentEdges } from '../engine/movement'
import type { DoorState, GridSegment, LocationData, WallMaterial } from '../types/location'

export const DOOR_STATE_LABELS: Record<DoorState, string> = {
  open: 'Открыта',
  closed: 'Закрыта',
  locked: 'Заперта',
}

export interface WallRun {
  key: string
  material: WallMaterial
  x1: number
  y1: number
  x2: number
  y2: number
}

/** Склеивает единичные стены в длинные линии (без участков под дверями и окнами). */
export function wallRuns(location: LocationData): WallRun[] {
  const fitted = new Set<string>()
  for (const s of [...location.doors, ...location.windows]) {
    for (const e of segmentEdges(s) ?? []) fitted.add(edgeKey(e.side, e.x, e.y))
  }
  const runs: WallRun[] = []
  // Стены уже отсортированы: сначала горизонтальные по строкам, затем вертикальные — по x внутри стороны.
  const horizontal = location.walls.filter((w) => w.side === 'h' && !fitted.has(edgeKey('h', w.x, w.y)))
  const vertical = location.walls
    .filter((w) => w.side === 'v' && !fitted.has(edgeKey('v', w.x, w.y)))
    .sort((a, b) => a.x - b.x || a.y - b.y)
  for (const w of horizontal) {
    const last = runs.at(-1)
    if (last && last.y1 === w.y && last.y2 === w.y && last.x2 === w.x && last.material === w.material) last.x2 = w.x + 1
    else runs.push({ key: `h${w.x},${w.y}`, material: w.material, x1: w.x, y1: w.y, x2: w.x + 1, y2: w.y })
  }
  for (const w of vertical) {
    const last = runs.at(-1)
    if (last && last.x1 === w.x && last.x2 === w.x && last.y2 === w.y && last.material === w.material) last.y2 = w.y + 1
    else runs.push({ key: `v${w.x},${w.y}`, material: w.material, x1: w.x, y1: w.y, x2: w.x, y2: w.y + 1 })
  }
  return runs
}

/** Рамка вокруг отрезка — для области нажатия и положения подсказки. */
export function segmentBox(s: GridSegment, pad: number) {
  return {
    x: Math.min(s.x1, s.x2) - pad,
    y: Math.min(s.y1, s.y2) - pad,
    w: Math.abs(s.x2 - s.x1) + pad * 2,
    h: Math.abs(s.y2 - s.y1) + pad * 2,
  }
}


/** id SVG-узора пола по типу (MapDefs.tsx). */
export const floorPatternId = (floor: string) => `floor-${floor}`
