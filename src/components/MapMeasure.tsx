// Измерения на клеточной карте: линейка (футы по правилу сетки SRD — диагональ 5 футов) и шаблоны областей
// воздействия (конус, сфера, куб, линия, цилиндр, излучение) с подсветкой задетых клеток и списком задетых. Расчёт —
// движок (src/engine/areas.ts, src/game/mapAreas.ts); здесь — только состояние жеста и отрисовка.
import { AREA_SHAPE_NAMES, areaLabel, areaOutline, gridDistance, type AreaTemplate } from '../engine/areas'
import { MEASURE_SHAPES, type MeasureTool } from '../game/mapMeasure'
import type { CellPosition } from '../types/location'

/** Задетые клетки, контур фигуры и точка начала. Ведущий (`master`) — другим цветом. */
export function AreaOverlay({ template, cells, cellFeet, master }: { template: AreaTemplate; cells: readonly CellPosition[]; cellFeet: number; master?: boolean }) {
  const d = cells.map((c) => `M${c.x} ${c.y}h1v1h-1z`).join('')
  const outline = areaOutline(template, cellFeet)
  return (
    <g
      className={`map-area${master ? ' map-area--master' : ''}`}
      pointerEvents="none"
      data-testid={master ? 'master-area' : 'measure-area'}
      data-shape={template.shape}
      data-size={template.size}
      data-cells={cells.length}
    >
      {d && <path d={d} className="map-area-cells" />}
      {outline.kind === 'circle' && <circle cx={outline.cx} cy={outline.cy} r={outline.r} className="map-area-outline" />}
      {outline.kind === 'polygon' && <polygon points={outline.points.map((p) => `${p.x},${p.y}`).join(' ')} className="map-area-outline" />}
      {outline.kind === 'rounded' && <rect x={outline.x} y={outline.y} width={outline.w} height={outline.h} rx={outline.r} className="map-area-outline" />}
      <circle cx={template.origin.x} cy={template.origin.y} r={0.12} className="map-area-origin" />
    </g>
  )
}

/** Линейка: отрезок между центрами клеток и подпись в футах. */
export function RulerOverlay({ from, to, cellFeet }: { from: CellPosition; to: CellPosition; cellFeet: number }) {
  const feet = gridDistance(from, to) * cellFeet
  return (
    <g className="map-ruler" data-testid="measure-ruler" data-feet={feet}>
      <line x1={from.x + 0.5} y1={from.y + 0.5} x2={to.x + 0.5} y2={to.y + 0.5} className="map-ruler-line" />
      <circle cx={from.x + 0.5} cy={from.y + 0.5} r={0.14} className="map-area-origin" />
      <rect x={to.x + 0.08} y={to.y + 0.08} width={0.84} height={0.84} rx={0.15} className="map-ruler-end" />
      <text x={to.x + 0.5} y={to.y - 0.25} className="drag-label">
        {feet} фт.
      </text>
    </g>
  )
}

/** Панель инструментов измерения. */
export function MeasureToolbar({ tool, open, onTool, onOpen }: { tool: MeasureTool | null; open: boolean; onTool: (tool: MeasureTool | null) => void; onOpen: (open: boolean) => void }) {
  const isArea = tool?.kind === 'area'
  return (
    <div className="map-measure-tools" role="toolbar" aria-label="Измерения" onClick={(e) => e.stopPropagation()} data-testid="measure-tools">
      <div className="map-measure-row">
        <button
          type="button"
          className={`map-control map-control--wide${tool?.kind === 'ruler' ? ' is-active' : ''}`}
          aria-pressed={tool?.kind === 'ruler'}
          onClick={() => {
            onOpen(false)
            onTool(tool?.kind === 'ruler' ? null : { kind: 'ruler' })
          }}
          data-testid="measure-ruler-button"
        >
          Линейка
        </button>
        <button
          type="button"
          className={`map-control map-control--wide${isArea || open ? ' is-active' : ''}`}
          aria-pressed={isArea}
          aria-expanded={open}
          onClick={() => {
            if (isArea) {
              onTool(null)
              onOpen(false)
            } else onOpen(!open)
          }}
          data-testid="measure-area-button"
        >
          {isArea ? AREA_SHAPE_NAMES[tool.shape] : 'Области'}
        </button>
      </div>
      {open && (
        <div className="map-measure-row" role="group" aria-label="Фигура области">
          {MEASURE_SHAPES.map((shape) => (
            <button
              key={shape}
              type="button"
              className="map-control map-control--wide"
              onClick={() => {
                onTool({ kind: 'area', shape })
                onOpen(false)
              }}
              data-shape={shape}
            >
              {AREA_SHAPE_NAMES[shape]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Сводка измерения или области ведущего: размер, клетки, кто задет; «Скрыть». */
export function MeasureInfo({
  title,
  template,
  cells,
  creatures,
  master,
  onClose,
}: {
  title?: string
  template?: AreaTemplate
  cells?: number
  creatures?: readonly string[]
  master?: boolean
  onClose: () => void
}) {
  return (
    <div className={`map-measure-info${master ? ' map-measure-info--master' : ''}`} role="status" data-testid={master ? 'master-area-info' : 'measure-info'} onClick={(e) => e.stopPropagation()}>
      <p className="map-measure-title">
        {master && <span className="map-measure-kind">Ведущий: </span>}
        {title ?? (template ? areaLabel(template) : '')}
        {template && title && <span className="map-measure-kind"> · {areaLabel(template)}</span>}
        {cells !== undefined && <span className="map-measure-kind"> · {cells} кл.</span>}
      </p>
      {creatures && (
        <p className="map-measure-creatures" data-testid={master ? 'master-area-creatures' : 'measure-creatures'}>
          {creatures.length ? `Задеты: ${creatures.join(', ')}` : 'Никого не задевает'}
        </p>
      )}
      <button type="button" className="map-measure-close" onClick={onClose} aria-label="Скрыть" title="Скрыть" data-testid={master ? 'master-area-close' : 'measure-close'}>
        ×
      </button>
    </div>
  )
}
