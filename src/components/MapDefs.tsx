// Общие SVG-определения карты: узоры пола (доски, камень, плитка, земля, трава), сетка, мягкая тень, тёплое
// свечение и градиенты света. Координаты узоров — в клетках (userSpaceOnUse). Цвета — только токены темы (классы
// в index.css и token() для градиентов), поэтому карта выглядит своей в каждой теме. Узоры рисуются один раз
// и заливают целые области пола — это быстро и на телефоне.
import { memo } from 'react'
import { token } from '../theme/css'
import type { MapLight } from '../game/mapView'

import { floorPatternId } from './mapDrawing'

function WoodPattern() {
  // Две клетки в ширину: 4 доски на клетку, стыки вразбежку, волокна.
  const rows = [0, 0.25, 0.5, 0.75]
  const joints = [[0.7], [1.45], [0.2, 1.2], [0.95]]
  return (
    <pattern id={floorPatternId('wood')} width={2} height={1} patternUnits="userSpaceOnUse">
      <rect width={2} height={1} className="pat-wood" />
      {rows.map((y, i) => (i % 2 ? <rect key={y} y={y} width={2} height={0.25} className="pat-wood-alt" /> : null))}
      {rows.map((y) => (
        <line key={`s${y}`} x1={0} y1={y} x2={2} y2={y} className="pat-seam" />
      ))}
      {joints.map((xs, i) => xs.map((x) => <line key={`${i}-${x}`} x1={x} y1={rows[i]} x2={x} y2={rows[i] + 0.25} className="pat-seam" />))}
      <path d="M0.1 0.12h0.45M1.1 0.38h0.6M0.4 0.62h0.5M1.3 0.88h0.4" className="pat-grain" />
    </pattern>
  )
}

function StonePattern() {
  // Плиты разного размера на квадрате 2×2.
  const slabs = ['M0 0h0.9v0.8h-0.9z', 'M0.9 0h1.1v0.55h-1.1z', 'M0.9 0.55h0.6v0.75h-0.6z', 'M1.5 0.55h0.5v0.75h-0.5z', 'M0 0.8h0.9v0.65h-0.9z', 'M0 1.45h1.2v0.55h-1.2z', 'M1.2 1.3h0.8v0.7h-0.8z', 'M0.9 1.3h0.3v0.15h-0.3z']
  return (
    <pattern id={floorPatternId('stone')} width={2} height={2} patternUnits="userSpaceOnUse">
      <rect width={2} height={2} className="pat-stone" />
      {slabs.map((d, i) => (
        <path key={i} d={d} className={i % 3 === 1 ? 'pat-stone-alt pat-slab' : 'pat-slab'} />
      ))}
      <circle cx={0.35} cy={0.3} r={0.04} className="pat-fleck" />
      <circle cx={1.6} cy={1.7} r={0.05} className="pat-fleck" />
    </pattern>
  )
}

function TilePattern() {
  return (
    <pattern id={floorPatternId('tile')} width={1} height={1} patternUnits="userSpaceOnUse">
      <rect width={1} height={1} className="pat-tile" />
      <rect width={0.5} height={0.5} className="pat-tile-alt" />
      <rect x={0.5} y={0.5} width={0.5} height={0.5} className="pat-tile-alt" />
      <path d="M0 0H1M0 0.5H1M0 0V1M0.5 0V1" className="pat-seam pat-seam--tile" />
    </pattern>
  )
}

function DirtPattern() {
  const specks: [number, number, number][] = [[0.3, 0.4, 0.06], [1.2, 0.3, 0.05], [0.8, 1.1, 0.07], [1.7, 1.5, 0.05], [0.4, 1.7, 0.04], [1.5, 0.9, 0.03]]
  return (
    <pattern id={floorPatternId('dirt')} width={2} height={2} patternUnits="userSpaceOnUse">
      <rect width={2} height={2} className="pat-dirt" />
      <ellipse cx={0.6} cy={0.6} rx={0.45} ry={0.3} className="pat-dirt-alt" />
      <ellipse cx={1.5} cy={1.4} rx={0.4} ry={0.35} className="pat-dirt-alt" />
      {specks.map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} className="pat-fleck" />
      ))}
    </pattern>
  )
}

function GrassPattern() {
  const tufts: [number, number][] = [[0.3, 0.35], [1.1, 0.25], [1.7, 0.7], [0.6, 1.2], [1.35, 1.55], [0.2, 1.8], [0.95, 0.8]]
  return (
    <pattern id={floorPatternId('grass')} width={2} height={2} patternUnits="userSpaceOnUse">
      <rect width={2} height={2} className="pat-grass" />
      <ellipse cx={1.3} cy={0.6} rx={0.6} ry={0.4} className="pat-grass-alt" />
      <ellipse cx={0.5} cy={1.5} rx={0.5} ry={0.35} className="pat-grass-alt" />
      {tufts.map(([x, y], i) => (
        <path key={i} d={`M${x} ${y}l-0.06 -0.14M${x} ${y}l0 -0.17M${x} ${y}l0.07 -0.13`} className="pat-blade" />
      ))}
    </pattern>
  )
}

/** Узоры, сетка, тени и градиенты — не зависят от состояния игры, перерисовываются только при смене света. */
export const MapDefs = memo(function MapDefs({ lights }: { lights: MapLight[] }) {
  const warm = token('map', 'lightWarm')
  return (
    <defs>
      <WoodPattern />
      <StonePattern />
      <TilePattern />
      <DirtPattern />
      <GrassPattern />
      <pattern id="cell-grid" width={1} height={1} patternUnits="userSpaceOnUse">
        <path d="M 1 0 L 0 0 0 1" className="grid-line" />
      </pattern>
      {/* Мягкая тень под предметами и фишками: плотная в середине, тает к краю. */}
      <radialGradient id="soft-shadow">
        <stop offset="55%" stopOpacity="0.9" style={{ stopColor: token('map', 'objectShadow') }} />
        <stop offset="100%" stopOpacity="0" style={{ stopColor: token('map', 'objectShadow') }} />
      </radialGradient>
      <radialGradient id="fire-glow">
        <stop offset="0%" stopOpacity="0.35" style={{ stopColor: token('map', 'fireGlow') }} />
        <stop offset="100%" stopOpacity="0" style={{ stopColor: token('map', 'fireGlow') }} />
      </radialGradient>
      <radialGradient id="warm-glow">
        <stop offset="0%" stopOpacity="0.32" style={{ stopColor: warm }} />
        <stop offset="45%" stopOpacity="0.14" style={{ stopColor: warm }} />
        <stop offset="100%" stopOpacity="0" style={{ stopColor: warm }} />
      </radialGradient>
      <radialGradient id="player-fill" cx="35%" cy="35%">
        <stop offset="0%" style={{ stopColor: token('map', 'playerFillLight') }} />
        <stop offset="100%" style={{ stopColor: token('map', 'playerFill') }} />
      </radialGradient>
      {/* Свет «вырезает» тьму: в яркой зоне тьмы нет, в тусклой — она тает к краю радиуса. */}
      {lights.map((l) => (
        <radialGradient key={l.id} id={`light-${l.id}`}>
          <stop offset={`${Math.round((l.bright / l.radius) * 100)}%`} stopOpacity="1" style={{ stopColor: token('map', 'lightMaskOff') }} />
          <stop offset="100%" stopOpacity="0" style={{ stopColor: token('map', 'lightMaskOff') }} />
        </radialGradient>
      ))}
    </defs>
  )
})
