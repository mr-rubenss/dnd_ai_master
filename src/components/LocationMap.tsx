import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { tileAt } from '../game/location'
import {
  TILE_FLOOR,
  TILE_WALL,
  type CellPosition,
  type LocationData,
  type MapObjectType,
  type NpcAttitude,
} from '../types/location'
import { MapObjectIcon } from './MapIcons'

const OBJECT_TYPE_LABELS: Record<MapObjectType, string> = {
  table: 'Стол',
  chair: 'Стул',
  bar: 'Стойка',
  fireplace: 'Камин',
  barrel: 'Бочка',
  door: 'Дверь',
}

const ATTITUDE_LABELS: Record<NpcAttitude, string> = {
  friendly: 'Дружелюбен',
  neutral: 'Нейтрален',
  hostile: 'Враждебен',
}

/** Элемент карты, на который можно навести или нажать. */
interface MapEntity {
  key: string
  name: string
  kindLabel: string
  description?: string
  x: number
  y: number
  w: number
  h: number
}

interface ActiveEntity {
  key: string
  pinned: boolean
}

interface Props {
  location: LocationData
  player: CellPosition
}

/** Тактическая карта локации: сетка клеток, объекты, НПС и фишка игрока. Масштабируется под контейнер. */
export function LocationMap({ location, player }: Props) {
  const { width, height } = location
  const [active, setActive] = useState<ActiveEntity | null>(null)

  const entities = useMemo(() => {
    const map = new Map<string, MapEntity>()
    for (const obj of location.objects) {
      map.set(`obj:${obj.id}`, {
        key: `obj:${obj.id}`,
        name: obj.name,
        kindLabel: OBJECT_TYPE_LABELS[obj.type],
        description: obj.description,
        x: obj.x,
        y: obj.y,
        w: obj.w ?? 1,
        h: obj.h ?? 1,
      })
    }
    for (const npc of location.npcs) {
      map.set(`npc:${npc.id}`, {
        key: `npc:${npc.id}`,
        name: npc.name,
        kindLabel: `НПС · ${ATTITUDE_LABELS[npc.attitude ?? 'neutral']}`,
        description: npc.description,
        x: npc.x,
        y: npc.y,
        w: 1,
        h: 1,
      })
    }
    return map
  }, [location])

  // Закрыть подсказку по Escape.
  useEffect(() => {
    if (!active) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setActive(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  const interactiveProps = (key: string) => ({
    tabIndex: 0,
    role: 'button',
    className: `map-entity${active?.key === key ? ' is-active' : ''}`,
    'aria-label': entities.get(key)?.name,
    onPointerEnter: (event: PointerEvent) => {
      if (event.pointerType === 'mouse') setActive((cur) => (cur?.pinned ? cur : { key, pinned: false }))
    },
    onPointerLeave: (event: PointerEvent) => {
      if (event.pointerType === 'mouse') setActive((cur) => (cur && !cur.pinned && cur.key === key ? null : cur))
    },
    onClick: (event: React.MouseEvent) => {
      event.stopPropagation()
      setActive((cur) => (cur?.key === key && cur.pinned ? null : { key, pinned: true }))
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        setActive((cur) => (cur?.key === key && cur.pinned ? null : { key, pinned: true }))
      }
    },
    onFocus: () => setActive((cur) => (cur?.pinned ? cur : { key, pinned: false })),
    onBlur: () => setActive((cur) => (cur && !cur.pinned && cur.key === key ? null : cur)),
  })

  const activeEntity = active ? entities.get(active.key) : undefined

  const cells = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = tileAt(location, x, y)
      if (tile === TILE_FLOOR) {
        cells.push(
          <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} className={`floor floor--${location.floor}${y % 2 ? ' floor--alt' : ''}`} />,
        )
      } else if (tile === TILE_WALL) {
        cells.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} className={`wall wall--${location.walls}`} />)
      }
    }
  }

  return (
    <div className="map-canvas">
      <div
        className="map-board"
        style={{ '--map-w': width, '--map-h': height } as CSSProperties}
        onClick={() => setActive(null)}
      >
        <svg viewBox={`0 0 ${width} ${height}`} className="map-svg" role="img" aria-label={`Карта: ${location.name}`}>
          <defs>
            <pattern id="cell-grid" width={1} height={1} patternUnits="userSpaceOnUse">
              <path d="M 1 0 L 0 0 0 1" className="grid-line" />
            </pattern>
            <radialGradient id="fire-glow">
              <stop offset="0%" stopColor="#ff9a3c" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#ff9a3c" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="player-fill" cx="35%" cy="35%">
              <stop offset="0%" stopColor="#fff1c4" />
              <stop offset="100%" stopColor="#c9a45c" />
            </radialGradient>
          </defs>

          <g>{cells}</g>
          <rect width={width} height={height} fill="url(#cell-grid)" pointerEvents="none" />

          <g>
            {location.objects.map((obj) => (
              <g key={obj.id} {...interactiveProps(`obj:${obj.id}`)}>
                <rect x={obj.x} y={obj.y} width={obj.w ?? 1} height={obj.h ?? 1} className="hit-area" />
                <MapObjectIcon object={obj} />
              </g>
            ))}
          </g>

          <g>
            {location.npcs.map((npc) => (
              <g key={npc.id} {...interactiveProps(`npc:${npc.id}`)}>
                <rect x={npc.x} y={npc.y} width={1} height={1} className="hit-area" />
                <circle cx={npc.x + 0.5} cy={npc.y + 0.5} r={0.4} className={`npc-token npc-token--${npc.attitude ?? 'neutral'}`} />
                <text x={npc.x + 0.5} y={npc.y + 0.52} className="npc-initial">
                  {npc.name[0]}
                </text>
                <text x={npc.x + 0.5} y={npc.y + 1.3} className="npc-label">
                  {npc.name}
                </text>
              </g>
            ))}
          </g>

          <g className="player-token" aria-label="Вы">
            <circle cx={player.x + 0.5} cy={player.y + 0.5} r={0.46} className="player-ring" />
            <circle cx={player.x + 0.5} cy={player.y + 0.5} r={0.36} fill="url(#player-fill)" className="player-core" />
            <text x={player.x + 0.5} y={player.y + 0.53} className="player-label">
              Вы
            </text>
          </g>
        </svg>

        {activeEntity && <MapTooltip entity={activeEntity} mapWidth={width} mapHeight={height} />}

        <span className="map-scale">1 клетка = {location.cellFeet} фт.</span>
      </div>
    </div>
  )
}

interface TooltipProps {
  entity: MapEntity
  mapWidth: number
  mapHeight: number
}

function MapTooltip({ entity, mapWidth, mapHeight }: TooltipProps) {
  const centerX = (entity.x + entity.w / 2) / mapWidth
  // Элементы в верхней половине карты — подсказка снизу, иначе сверху, чтобы она не выходила за карту.
  const below = entity.y + entity.h / 2 < mapHeight / 2
  const top = (below ? entity.y + entity.h : entity.y) / mapHeight
  const align = centerX < 0.25 ? 'left' : centerX > 0.75 ? 'right' : 'center'
  const left = align === 'left' ? entity.x / mapWidth : align === 'right' ? (entity.x + entity.w) / mapWidth : centerX

  return (
    <div
      className={`map-tooltip map-tooltip--${align} map-tooltip--${below ? 'below' : 'above'}`}
      style={{ left: `${left * 100}%`, top: `${top * 100}%` }}
      role="tooltip"
    >
      {entity.kindLabel !== entity.name && <span className="map-tooltip-kind">{entity.kindLabel}</span>}
      <strong className="map-tooltip-name">{entity.name}</strong>
      {entity.description && <p className="map-tooltip-text">{entity.description}</p>}
    </div>
  )
}
