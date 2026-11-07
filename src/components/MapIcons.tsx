// SVG-иконки обстановки карты. Координаты — в клетках (1 единица = 1 клетка), размер — по w × h объекта, поэтому
// одни и те же иконки служат картам любого масштаба. Под предметом — мягкая тень (градиент, без фильтров:
// фильтры дороги на телефоне). Цвета — только классы с токенами темы (index.css).
import type { ReactNode } from 'react'
import type { MapObject } from '../types/location'

interface IconProps {
  object: MapObject
}

/** Мягкая тень под предметом: эллипс со смещением вниз-вправо. */
function Shadow({ x, y, w, h, inset = 0.08 }: { x: number; y: number; w: number; h: number; inset?: number }) {
  return <ellipse cx={x + w / 2 + 0.06} cy={y + h / 2 + 0.1} rx={w / 2 - inset + 0.08} ry={h / 2 - inset + 0.08} className="obj-shadow" />
}

/** Пламя с ядром — для камина, огня, факела и свечи. */
function Flame({ cx, cy, size }: { cx: number; cy: number; size: number }) {
  const s = size
  return (
    <g className="obj-flame-group">
      <path
        d={`M ${cx} ${cy - s} C ${cx + s * 0.65} ${cy - s * 0.2}, ${cx + s * 0.4} ${cy + s * 0.8}, ${cx} ${cy + s * 0.8} C ${cx - s * 0.4} ${cy + s * 0.8}, ${cx - s * 0.65} ${cy - s * 0.2}, ${cx} ${cy - s} Z`}
        className="obj-flame"
      />
      <path
        d={`M ${cx} ${cy - s * 0.3} C ${cx + s * 0.28} ${cy + s * 0.1}, ${cx + s * 0.18} ${cy + s * 0.65}, ${cx} ${cy + s * 0.65} C ${cx - s * 0.18} ${cy + s * 0.65}, ${cx - s * 0.28} ${cy + s * 0.1}, ${cx} ${cy - s * 0.3} Z`}
        className="obj-flame-core"
      />
    </g>
  )
}

const range = (n: number) => Array.from({ length: Math.max(0, n) }, (_, i) => i)

export function MapObjectIcon({ object }: IconProps): ReactNode {
  const { x, y } = object
  const w = object.w ?? 1
  const h = object.h ?? 1
  const cx = x + w / 2
  const cy = y + h / 2
  const wide = w >= h

  switch (object.type) {
    case 'table':
      return (
        <g>
          <Shadow x={x} y={y} w={w} h={h} inset={0.12} />
          <rect x={x + 0.1} y={y + 0.1} width={w - 0.2} height={h - 0.2} rx={0.16} className="obj-table" />
          <rect x={x + 0.18} y={y + 0.18} width={w - 0.36} height={h - 0.36} rx={0.1} className="obj-table-top" />
          {/* Доски столешницы. */}
          {range(Math.round((wide ? h : w) * 3) - 1).map((i) =>
            wide ? (
              <line key={i} x1={x + 0.2} x2={x + w - 0.2} y1={y + 0.18 + ((h - 0.36) / (h * 3)) * (i + 1)} y2={y + 0.18 + ((h - 0.36) / (h * 3)) * (i + 1)} className="obj-plank" />
            ) : (
              <line key={i} y1={y + 0.2} y2={y + h - 0.2} x1={x + 0.18 + ((w - 0.36) / (w * 3)) * (i + 1)} x2={x + 0.18 + ((w - 0.36) / (w * 3)) * (i + 1)} className="obj-plank" />
            ),
          )}
          <circle cx={cx - 0.25} cy={cy - 0.1} r={0.12} className="obj-mug" />
          {w * h > 1 && <circle cx={cx + 0.3} cy={cy + 0.15} r={0.1} className="obj-mug" />}
          {w * h > 2 && <ellipse cx={cx + 0.05} cy={cy - 0.35} rx={0.2} ry={0.13} className="obj-plate" />}
        </g>
      )
    case 'chair':
      return (
        <g>
          <Shadow x={x + 0.2} y={y + 0.2} w={0.6} h={0.6} inset={0.02} />
          <rect x={x + 0.27} y={y + 0.27} width={0.46} height={0.46} rx={0.08} className="obj-chair" />
          <rect x={x + 0.27} y={y + 0.2} width={0.46} height={0.12} rx={0.04} className="obj-chair-back" />
          <line x1={x + 0.33} x2={x + 0.67} y1={y + 0.5} y2={y + 0.5} className="obj-plank" />
        </g>
      )
    case 'bar':
      return (
        <g>
          <Shadow x={x} y={y + 0.1} w={w} h={h - 0.2} inset={0.05} />
          <rect x={x + 0.04} y={y + 0.15} width={w - 0.08} height={h - 0.3} rx={0.1} className="obj-bar" />
          <rect x={x + 0.1} y={y + 0.22} width={w - 0.2} height={0.12} rx={0.05} className="obj-bar-edge" />
          {range(Math.floor(w) - 1).map((i) => (
            <line key={i} x1={x + 1 + i} x2={x + 1 + i} y1={y + 0.36} y2={y + h - 0.2} className="obj-plank" />
          ))}
          {range(Math.max(1, Math.floor(w / 2))).map((i) => (
            <circle key={i} cx={x + 1 + i * 2} cy={y + h / 2 + 0.08} r={0.12} className="obj-mug" />
          ))}
          {range(Math.max(0, Math.floor(w / 3))).map((i) => (
            <rect key={`b${i}`} x={x + 1.9 + i * 3} y={y + h / 2 - 0.06} width={0.12} height={0.28} rx={0.05} className="obj-bottle" />
          ))}
        </g>
      )
    case 'fireplace':
      return (
        <g>
          <Shadow x={x} y={y} w={w} h={h} inset={0.02} />
          <rect x={x + 0.05} y={y + 0.05} width={w - 0.1} height={h - 0.1} rx={0.1} className="obj-fireplace" />
          {/* Кладка. */}
          {range(Math.round(Math.max(w, h) * 2)).map((i) =>
            wide ? (
              <line key={i} x1={x + 0.05 + i * 0.5} x2={x + 0.05 + i * 0.5} y1={y + 0.05} y2={y + 0.3} className="obj-brick" />
            ) : (
              <line key={i} y1={y + 0.05 + i * 0.5} y2={y + 0.05 + i * 0.5} x1={x + 0.05} x2={x + 0.3} className="obj-brick" />
            ),
          )}
          <rect x={x + 0.25} y={y + 0.35} width={w - 0.5} height={h - 0.7} rx={0.08} className="obj-fireplace-mouth" />
          <path d={`M ${cx - 0.25} ${cy + 0.3} L ${cx + 0.25} ${cy + 0.2} M ${cx - 0.2} ${cy + 0.15} L ${cx + 0.22} ${cy + 0.32}`} className="obj-log" />
          <Flame cx={cx} cy={cy} size={0.55} />
        </g>
      )
    case 'barrel':
      return (
        <g>
          <Shadow x={cx - 0.4} y={cy - 0.4} w={0.8} h={0.8} inset={0} />
          <circle cx={cx} cy={cy} r={0.38} className="obj-barrel" />
          {/* Клёпки. */}
          <path d={`M ${cx - 0.38} ${cy} H ${cx + 0.38} M ${cx} ${cy - 0.38} V ${cy + 0.38}`} className="obj-stave" />
          <circle cx={cx} cy={cy} r={0.27} className="obj-barrel-ring" />
          <circle cx={cx} cy={cy} r={0.06} className="obj-barrel-tap" />
        </g>
      )
    case 'fire':
      // Огонь на полу: языки пламени в каждой клетке (свечение — в слое эффектов).
      return (
        <g className="obj-fire">
          {range(w * h).map((i) => (
            <Flame key={i} cx={x + (i % w) + 0.5} cy={y + Math.floor(i / w) + 0.55} size={0.4} />
          ))}
        </g>
      )
    case 'debris':
      return (
        <g>
          {objectPieces(w, h).map(([px, py, s], i) => (
            <path
              key={i}
              d={`M ${x + px} ${y + py - s} L ${x + px + s} ${y + py - s * 0.2} L ${x + px + s * 0.5} ${y + py + s} L ${x + px - s * 0.8} ${y + py + s * 0.6} L ${x + px - s} ${y + py - s * 0.4} Z`}
              className="obj-debris"
            />
          ))}
        </g>
      )
    case 'item':
      return (
        <g>
          <Shadow x={x + 0.15} y={y + 0.15} w={w - 0.3} h={h - 0.3} inset={0} />
          <rect x={x + 0.2} y={y + 0.2} width={w - 0.4} height={h - 0.4} rx={0.08} className="obj-item" />
          <path d={`M ${x + 0.2} ${cy} H ${x + w - 0.2}`} className="obj-item-band" />
        </g>
      )
    case 'bed': {
      // Изголовье — у короткой стороны: сверху у вертикальной кровати, слева у горизонтальной.
      const pillow = wide ? { x: x + 0.15, y: y + 0.18, w: 0.35, h: h - 0.36 } : { x: x + 0.18, y: y + 0.15, w: w - 0.36, h: 0.35 }
      const blanket = wide ? { x: x + 0.6, y: y + 0.12, w: w - 0.72, h: h - 0.24 } : { x: x + 0.12, y: y + 0.6, w: w - 0.24, h: h - 0.72 }
      return (
        <g>
          <Shadow x={x} y={y} w={w} h={h} inset={0.06} />
          <rect x={x + 0.08} y={y + 0.08} width={w - 0.16} height={h - 0.16} rx={0.1} className="obj-bed" />
          <rect x={x + 0.12} y={y + 0.12} width={w - 0.24} height={h - 0.24} rx={0.08} className="obj-bed-sheet" />
          <rect {...rect(blanket)} rx={0.08} className="obj-bed-blanket" />
          <rect {...rect(pillow)} rx={0.1} className="obj-bed-pillow" />
        </g>
      )
    }
    case 'chest':
      return (
        <g>
          <Shadow x={x + 0.1} y={y + 0.15} w={w - 0.2} h={h - 0.3} inset={0} />
          <rect x={x + 0.12} y={y + 0.2} width={w - 0.24} height={h - 0.4} rx={0.07} className="obj-chest" />
          <path d={`M ${x + 0.12} ${cy - 0.05} H ${x + w - 0.12}`} className="obj-chest-band" />
          <path d={`M ${x + 0.3} ${y + 0.2} V ${y + h - 0.2} M ${x + w - 0.3} ${y + 0.2} V ${y + h - 0.2}`} className="obj-chest-band" />
          <rect x={cx - 0.07} y={cy - 0.1} width={0.14} height={0.13} rx={0.02} className="obj-metal" />
        </g>
      )
    case 'shelf': {
      const n = Math.max(2, Math.round(Math.max(w, h) * 3))
      return (
        <g>
          <Shadow x={x} y={y + 0.15} w={w} h={h - 0.3} inset={0.02} />
          <rect x={x + 0.05} y={y + 0.15} width={w - 0.1} height={h - 0.3} rx={0.05} className="obj-shelf" />
          {range(n).map((i) => {
            const t = (i + 0.5) / n
            const bx = wide ? x + 0.1 + t * (w - 0.2) - 0.08 : cx - 0.12
            const by = wide ? cy - 0.12 : y + 0.2 + t * (h - 0.4) - 0.08
            return <rect key={i} x={bx} y={by} width={wide ? 0.14 : 0.24} height={wide ? 0.24 : 0.14} rx={0.03} className={i % 3 === 1 ? 'obj-shelf-item obj-shelf-item--alt' : 'obj-shelf-item'} />
          })}
        </g>
      )
    }
    case 'rug':
      return (
        <g>
          <rect x={x + 0.08} y={y + 0.08} width={w - 0.16} height={h - 0.16} rx={0.06} className="obj-rug" />
          <rect x={x + 0.2} y={y + 0.2} width={w - 0.4} height={h - 0.4} rx={0.04} className="obj-rug-border" />
          <path d={`M ${cx} ${y + 0.35} L ${x + w - 0.35} ${cy} L ${cx} ${y + h - 0.35} L ${x + 0.35} ${cy} Z`} className="obj-rug-pattern" />
        </g>
      )
    case 'torch':
      return (
        <g>
          <rect x={cx - 0.05} y={cy - 0.05} width={0.1} height={0.4} rx={0.03} className="obj-torch" />
          <Flame cx={cx} cy={cy - 0.12} size={0.22} />
        </g>
      )
    case 'candle':
      return (
        <g>
          <ellipse cx={cx + 0.02} cy={cy + 0.12} rx={0.12} ry={0.06} className="obj-shadow" />
          <rect x={cx - 0.05} y={cy - 0.02} width={0.1} height={0.16} rx={0.03} className="obj-candle" />
          <Flame cx={cx} cy={cy - 0.1} size={0.1} />
        </g>
      )
    case 'tree': {
      const r = Math.min(w, h) * 0.45
      return (
        <g>
          <Shadow x={cx - r} y={cy - r} w={r * 2} h={r * 2} inset={-0.05} />
          <circle cx={cx} cy={cy} r={r} className="obj-tree-dark" />
          <circle cx={cx - r * 0.25} cy={cy - r * 0.2} r={r * 0.7} className="obj-tree" />
          <circle cx={cx + r * 0.3} cy={cy + r * 0.15} r={r * 0.5} className="obj-tree" />
          <circle cx={cx} cy={cy} r={r * 0.12} className="obj-tree-trunk" />
        </g>
      )
    }
    case 'rock': {
      const s = Math.min(w, h) * 0.4
      return (
        <g>
          <Shadow x={cx - s} y={cy - s * 0.8} w={s * 2} h={s * 1.6} inset={0} />
          <path d={`M ${cx - s} ${cy + s * 0.3} L ${cx - s * 0.6} ${cy - s * 0.7} L ${cx + s * 0.3} ${cy - s} L ${cx + s} ${cy - s * 0.1} L ${cx + s * 0.6} ${cy + s * 0.8} L ${cx - s * 0.4} ${cy + s * 0.9} Z`} className="obj-rock" />
          <path d={`M ${cx - s * 0.6} ${cy - s * 0.7} L ${cx + s * 0.1} ${cy} L ${cx + s} ${cy - s * 0.1}`} className="obj-rock-shade" />
        </g>
      )
    }
    case 'building':
      return (
        <g>
          <Shadow x={x} y={y} w={w} h={h} inset={0.02} />
          <rect x={x + 0.08} y={y + 0.08} width={w - 0.16} height={h - 0.16} rx={0.04} className="obj-roof" />
          <path d={wide ? `M ${x + 0.08} ${cy} H ${x + w - 0.08}` : `M ${cx} ${y + 0.08} V ${y + h - 0.08}`} className="obj-roof-ridge" />
        </g>
      )
  }
}

const rect = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x, y: r.y, width: r.w, height: r.h })

/** Куски обломков: по три на клетку, с небольшим разбросом (детерминированно — без случайных чисел). */
function objectPieces(w: number, h: number): [number, number, number][] {
  const pieces: [number, number, number][] = []
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++) {
      pieces.push([dx + 0.3, dy + 0.35, 0.16], [dx + 0.68, dy + 0.45, 0.2], [dx + 0.45, dy + 0.72, 0.13])
    }
  return pieces
}
