// SVG-иконки объектов карты. Координаты — в клетках (1 единица = 1 клетка).
import type { MapObject } from '../types/location'

interface IconProps {
  object: MapObject
}

export function MapObjectIcon({ object }: IconProps) {
  const { x, y } = object
  const w = object.w ?? 1
  const h = object.h ?? 1
  const cx = x + w / 2
  const cy = y + h / 2

  switch (object.type) {
    case 'table':
      return (
        <g>
          <rect x={x + 0.12} y={y + 0.12} width={w - 0.24} height={h - 0.24} rx={0.18} className="obj-table" />
          <rect x={x + 0.22} y={y + 0.22} width={w - 0.44} height={h - 0.44} rx={0.12} className="obj-table-top" />
          <circle cx={cx - 0.25} cy={cy - 0.1} r={0.12} className="obj-mug" />
          {w * h > 1 && <circle cx={cx + 0.3} cy={cy + 0.15} r={0.1} className="obj-mug" />}
        </g>
      )
    case 'chair':
      return (
        <g>
          <rect x={x + 0.27} y={y + 0.27} width={0.46} height={0.46} rx={0.08} className="obj-chair" />
          <rect x={x + 0.27} y={y + 0.2} width={0.46} height={0.12} rx={0.04} className="obj-chair-back" />
        </g>
      )
    case 'bar':
      return (
        <g>
          <rect x={x + 0.04} y={y + 0.15} width={w - 0.08} height={h - 0.3} rx={0.1} className="obj-bar" />
          <rect x={x + 0.1} y={y + 0.22} width={w - 0.2} height={0.12} rx={0.05} className="obj-bar-edge" />
          {Array.from({ length: Math.max(1, Math.floor(w / 2)) }, (_, i) => (
            <circle key={i} cx={x + 1 + i * 2} cy={y + h / 2 + 0.05} r={0.12} className="obj-mug" />
          ))}
        </g>
      )
    case 'fireplace':
      return (
        <g>
          <circle cx={cx} cy={cy} r={Math.max(w, h) * 0.9} className="obj-fire-glow" />
          <rect x={x + 0.05} y={y + 0.05} width={w - 0.1} height={h - 0.1} rx={0.1} className="obj-fireplace" />
          <rect x={x + 0.25} y={y + 0.35} width={w - 0.5} height={h - 0.7} rx={0.08} className="obj-fireplace-mouth" />
          <path
            d={`M ${cx} ${cy - 0.55} C ${cx + 0.35} ${cy - 0.1}, ${cx + 0.2} ${cy + 0.45}, ${cx} ${cy + 0.45} C ${cx - 0.2} ${cy + 0.45}, ${cx - 0.35} ${cy - 0.1}, ${cx} ${cy - 0.55} Z`}
            className="obj-flame"
          />
          <path
            d={`M ${cx} ${cy - 0.15} C ${cx + 0.15} ${cy + 0.05}, ${cx + 0.1} ${cy + 0.35}, ${cx} ${cy + 0.35} C ${cx - 0.1} ${cy + 0.35}, ${cx - 0.15} ${cy + 0.05}, ${cx} ${cy - 0.15} Z`}
            className="obj-flame-core"
          />
        </g>
      )
    case 'barrel':
      return (
        <g>
          <circle cx={cx} cy={cy} r={0.38} className="obj-barrel" />
          <circle cx={cx} cy={cy} r={0.27} className="obj-barrel-ring" />
          <circle cx={cx} cy={cy} r={0.06} className="obj-barrel-tap" />
        </g>
      )
    case 'fire':
      // Огонь на полу: свечение и языки пламени в каждой клетке.
      return (
        <g className="obj-fire">
          <circle cx={cx} cy={cy} r={Math.max(w, h) * 0.75} className="obj-fire-glow" />
          {Array.from({ length: w * h }, (_, i) => {
            const fx = x + (i % w) + 0.5
            const fy = y + Math.floor(i / w) + 0.55
            return (
              <g key={i}>
                <path
                  d={`M ${fx} ${fy - 0.4} C ${fx + 0.3} ${fy - 0.05}, ${fx + 0.2} ${fy + 0.32}, ${fx} ${fy + 0.32} C ${fx - 0.2} ${fy + 0.32}, ${fx - 0.3} ${fy - 0.05}, ${fx} ${fy - 0.4} Z`}
                  className="obj-flame"
                />
                <path
                  d={`M ${fx} ${fy - 0.1} C ${fx + 0.12} ${fy + 0.05}, ${fx + 0.08} ${fy + 0.26}, ${fx} ${fy + 0.26} C ${fx - 0.08} ${fy + 0.26}, ${fx - 0.12} ${fy + 0.05}, ${fx} ${fy - 0.1} Z`}
                  className="obj-flame-core"
                />
              </g>
            )
          })}
        </g>
      )
    case 'debris':
      // Обломки: несколько неровных кусков.
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
          <rect x={x + 0.2} y={y + 0.2} width={w - 0.4} height={h - 0.4} rx={0.08} className="obj-item" />
          <path d={`M ${x + 0.2} ${cy} H ${x + w - 0.2}`} className="obj-item-band" />
        </g>
      )
  }
}

/** Куски обломков: по три на клетку, с небольшим разбросом (детерминированно — без случайных чисел). */
function objectPieces(w: number, h: number): [number, number, number][] {
  const pieces: [number, number, number][] = []
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++) {
      pieces.push([dx + 0.3, dy + 0.35, 0.16], [dx + 0.68, dy + 0.45, 0.2], [dx + 0.45, dy + 0.72, 0.13])
    }
  return pieces
}
