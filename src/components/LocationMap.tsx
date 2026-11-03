import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { doorState, isFloor, type DoorStates } from '../engine/movement'
import type { CellPosition, LocationData, MapObjectType, NpcAttitude } from '../types/location'
import { MapObjectIcon } from './MapIcons'
import { DOOR_STATE_LABELS, segmentBox } from './mapDrawing'
import { DoorIcon, WallLines, WindowIcon } from './MapWalls'
import { token } from '../theme/css'

const OBJECT_TYPE_LABELS: Record<MapObjectType, string> = {
  table: 'Стол',
  chair: 'Стул',
  bar: 'Стойка',
  fireplace: 'Камин',
  barrel: 'Бочка',
}


const ATTITUDE_LABELS: Record<NpcAttitude, string> = {
  friendly: 'Дружелюбен',
  neutral: 'Нейтрален',
  hostile: 'Враждебен',
}

/** Поле вокруг карты в клетках: чтобы внешние стены на краю не обрезались. */
const MAP_PAD = 0.25

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
  /** Текущие состояния дверей (из состояния игры). */
  doors?: DoorStates
}

/** Тактическая карта локации: сетка клеток, объекты, НПС и фишка игрока. Масштабируется под контейнер. */
export function LocationMap({ location, player, doors = {} }: Props) {
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
    for (const door of location.doors) {
      map.set(`door:${door.id}`, {
        key: `door:${door.id}`,
        name: door.name,
        kindLabel: `Дверь · ${DOOR_STATE_LABELS[doorState(door, doors)]}`,
        description: door.description,
        ...segmentBox(door, 0.3),
      })
    }
    for (const win of location.windows) {
      map.set(`window:${win.id}`, {
        key: `window:${win.id}`,
        name: win.name ?? 'Окно',
        kindLabel: 'Окно',
        description: win.description,
        ...segmentBox(win, 0.3),
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
  }, [location, doors])

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
  /** Контур пола — по нему обрезается сетка, чтобы линии клеток не рисовались в пустоте. */
  let floorOutline = ''
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isFloor(location, x, y)) {
        floorOutline += `M${x} ${y}h1v1h-1z`
        cells.push(
          <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} className={`floor floor--${location.floor}${y % 2 ? ' floor--alt' : ''}`} />,
        )
      }
    }
  }

  return (
    <div className="map-canvas">
      <div
        className="map-board"
        style={{ '--board-w': width + MAP_PAD * 2, '--board-h': height + MAP_PAD * 2 } as CSSProperties}
        onClick={() => setActive(null)}
      >
        <svg viewBox={`${-MAP_PAD} ${-MAP_PAD} ${width + MAP_PAD * 2} ${height + MAP_PAD * 2}`} className="map-svg" role="img" aria-label={`Карта: ${location.name}`}>
          <defs>
            <pattern id="cell-grid" width={1} height={1} patternUnits="userSpaceOnUse">
              <path d="M 1 0 L 0 0 0 1" className="grid-line" />
            </pattern>
            <radialGradient id="fire-glow">
              <stop offset="0%" stopOpacity="0.35" style={{ stopColor: token('map', 'fireGlow') }} />
              <stop offset="100%" stopOpacity="0" style={{ stopColor: token('map', 'fireGlow') }} />
            </radialGradient>
            <radialGradient id="player-fill" cx="35%" cy="35%">
              <stop offset="0%" style={{ stopColor: token('map', 'playerFillLight') }} />
              <stop offset="100%" style={{ stopColor: token('map', 'playerFill') }} />
            </radialGradient>
          </defs>

          <clipPath id="floor-clip">
            <path d={floorOutline} />
          </clipPath>
          <g>{cells}</g>
          <rect width={width} height={height} fill="url(#cell-grid)" clipPath="url(#floor-clip)" pointerEvents="none" />

          <g>
            {location.objects.map((obj) => (
              <g key={obj.id} {...interactiveProps(`obj:${obj.id}`)}>
                <rect x={obj.x} y={obj.y} width={obj.w ?? 1} height={obj.h ?? 1} className="hit-area" />
                <MapObjectIcon object={obj} />
              </g>
            ))}
          </g>

          <WallLines location={location} />

          <g>
            {location.windows.map((win) => (
              <g key={win.id} {...interactiveProps(`window:${win.id}`)} data-testid={`window-${win.id}`}>
                <rect {...hitBox(entities.get(`window:${win.id}`))} className="hit-area" />
                <WindowIcon window={win} />
              </g>
            ))}
            {location.doors.map((door) => {
              const state = doorState(door, doors)
              return (
                <g key={door.id} {...interactiveProps(`door:${door.id}`)} data-testid={`door-${door.id}`} data-state={state}>
                  <rect {...hitBox(entities.get(`door:${door.id}`))} className="hit-area" />
                  <DoorIcon door={door} state={state} location={location} />
                </g>
              )
            })}
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

function hitBox(entity: MapEntity | undefined) {
  return entity ? { x: entity.x, y: entity.y, width: entity.w, height: entity.h } : {}
}

interface TooltipProps {
  entity: MapEntity
  mapWidth: number
  mapHeight: number
}

function MapTooltip({ entity, mapWidth, mapHeight }: TooltipProps) {
  // Доли ширины/высоты доски с учётом поля вокруг карты.
  const fx = (x: number) => (x + MAP_PAD) / (mapWidth + MAP_PAD * 2)
  const fy = (y: number) => (y + MAP_PAD) / (mapHeight + MAP_PAD * 2)
  const centerX = fx(entity.x + entity.w / 2)
  // Элементы в верхней половине карты — подсказка снизу, иначе сверху, чтобы она не выходила за карту.
  const below = entity.y + entity.h / 2 < mapHeight / 2
  const top = fy(below ? entity.y + entity.h : entity.y)
  const align = centerX < 0.25 ? 'left' : centerX > 0.75 ? 'right' : 'center'
  const left = align === 'left' ? fx(entity.x) : align === 'right' ? fx(entity.x + entity.w) : centerX

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
