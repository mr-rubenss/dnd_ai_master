// Отрисовка тонких стен, окон и дверей карты. Координаты — в клетках (1 единица = 1 клетка),
// стены лежат на линиях сетки.
import { isFloor } from '../engine/movement'
import type { Door, DoorState, LocationData, MapWindow } from '../types/location'
import { wallRuns } from './mapDrawing'

export function WallLines({ location }: { location: LocationData }) {
  const runs = wallRuns(location)
  // Под тёмной линией — светлая подложка, чтобы внешние стены были видны и на тёмном фоне за картой.
  return (
    <g className="walls">
      {runs.map((run) => (
        <line key={run.key} x1={run.x1} y1={run.y1} x2={run.x2} y2={run.y2} className={`wall-halo wall-halo--${run.material}`} />
      ))}
      {runs.map((run) => (
        <line key={run.key} x1={run.x1} y1={run.y1} x2={run.x2} y2={run.y2} className={`wall-line wall-line--${run.material}`} />
      ))}
    </g>
  )
}

export function WindowIcon({ window: win }: { window: MapWindow }) {
  const { x1, y1, x2, y2 } = win
  const horizontal = y1 === y2
  const off = 0.07
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} className="window-glass" />
      <line x1={x1} y1={y1} x2={x2} y2={y2} transform={horizontal ? `translate(0 ${-off})` : `translate(${-off} 0)`} className="window-frame" />
      <line x1={x1} y1={y1} x2={x2} y2={y2} transform={horizontal ? `translate(0 ${off})` : `translate(${off} 0)`} className="window-frame" />
    </g>
  )
}

const THICKNESS = 0.26

interface DoorIconProps {
  door: Door
  state: DoorState
  location: LocationData
}

/**
 * Значок двери на стене. Закрытая — створка вдоль стены (у запертой — ещё и замок),
 * открытая — проём в стене и створка, распахнутая внутрь помещения, с дугой хода.
 */
export function DoorIcon({ door, state, location }: DoorIconProps) {
  const horizontal = door.y1 === door.y2
  const start = horizontal ? Math.min(door.x1, door.x2) : Math.min(door.y1, door.y2)
  const length = horizontal ? Math.abs(door.x2 - door.x1) : Math.abs(door.y2 - door.y1)
  const line = horizontal ? door.y1 : door.x1
  /** Точка в координатах «вдоль двери (a), поперёк (b)» → координаты карты. */
  const pt = (a: number, b: number) => (horizontal ? { x: a, y: b } : { x: b, y: a })

  if (state !== 'open') {
    const box = horizontal
      ? { x: start + 0.04, y: line - THICKNESS / 2, width: length - 0.08, height: THICKNESS }
      : { x: line - THICKNESS / 2, y: start + 0.04, width: THICKNESS, height: length - 0.08 }
    const mid = pt(start + length / 2, line)
    return (
      <g className={`door door--${state}`}>
        <rect {...box} rx={0.04} className="door-leaf" />
        {length >= 2 && (
          <line {...seg(pt(start + length / 2, line - THICKNESS / 2), pt(start + length / 2, line + THICKNESS / 2))} className="door-seam" />
        )}
        {state === 'locked' && (
          <g className="door-lock">
            <rect x={mid.x - 0.13} y={mid.y - 0.09} width={0.26} height={0.22} rx={0.04} />
            <path d={`M ${mid.x - 0.08} ${mid.y - 0.09} v -0.06 a 0.08 0.08 0 0 1 0.16 0 v 0.06`} className="door-lock-shackle" />
          </g>
        )}
      </g>
    )
  }

  // Открытая дверь распахивается в сторону пола (если пол по обе стороны — внутрь, к меньшим координатам).
  const probe = horizontal ? (dir: number) => isFloor(location, start, dir < 0 ? line - 1 : line) : (dir: number) => isFloor(location, dir < 0 ? line - 1 : line, start)
  const dir = probe(-1) ? -1 : probe(1) ? 1 : -1
  // Широкая дверь — двустворчатая: створки на петлях у обоих краёв проёма.
  const leafLength = length >= 2 ? length / 2 : length
  const hinges = length >= 2 ? [{ at: start, sign: 1 }, { at: start + length, sign: -1 }] : [{ at: start, sign: 1 }]
  return (
    <g className="door door--open">
      {hinges.map(({ at, sign }) => {
        const hinge = pt(at, line)
        const tip = pt(at, line + dir * leafLength)
        const closedTip = pt(at + sign * leafLength, line)
        // Дуга хода створки вокруг петли: от закрытого положения к открытому.
        const cross = (closedTip.x - hinge.x) * (tip.y - hinge.y) - (closedTip.y - hinge.y) * (tip.x - hinge.x)
        const sweep = cross > 0 ? 1 : 0
        return (
          <g key={at}>
            <path d={`M ${closedTip.x} ${closedTip.y} A ${leafLength} ${leafLength} 0 0 ${sweep} ${tip.x} ${tip.y}`} className="door-swing" />
            <line {...seg(hinge, tip)} className="door-leaf-open" />
          </g>
        )
      })}
    </g>
  )
}

function seg(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }
}
