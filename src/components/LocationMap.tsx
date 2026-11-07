// Карта локации — одна отрисовка для карт трёх масштабов (клеточная, частичная, общая): вид, размер клетки, единицы
// и набор объектов задаются данными карты (LocationData.scale, src/game/mapView.ts), а не отдельными компонентами.
// Слои снизу вверх: пол (узоры) → стены, окна, двери → обстановка → фишки → эффекты (свет и тьма) → интерфейс
// (подписи). Масштаб и сдвиг — useMapViewport, плавный шаг фишек — useWalks. Статичные слои мемоизированы:
// подсказки и шаги фишек их не перерисовывают.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { doorState, type DoorStates } from '../engine/movement'
import {
  ambientOf,
  DARKNESS_OPACITY,
  floorAreas,
  lightSources,
  profileOf,
  scaleLabel,
  scaleOf,
  walkPath,
  type MapLight,
} from '../game/mapView'
import { FLAT_OBJECT_TYPES, type CellPosition, type LocationData, type MapObject, type MapObjectType, type NpcAttitude } from '../types/location'
import { MapDefs } from './MapDefs'
import { MapObjectIcon } from './MapIcons'
import { DOOR_STATE_LABELS, floorPatternId, segmentBox } from './mapDrawing'
import { DoorIcon, WallLines, WindowIcon } from './MapWalls'
import { useMapViewport } from './useMapViewport'
import { useWalks } from './useWalk'

const OBJECT_TYPE_LABELS: Record<MapObjectType, string> = {
  table: 'Стол',
  chair: 'Стул',
  bar: 'Стойка',
  fireplace: 'Камин',
  barrel: 'Бочка',
  fire: 'Огонь',
  debris: 'Обломки',
  item: 'Предмет',
  bed: 'Кровать',
  chest: 'Сундук',
  shelf: 'Полка',
  rug: 'Ковёр',
  torch: 'Факел',
  candle: 'Свеча',
  tree: 'Дерево',
  rock: 'Камень',
  building: 'Строение',
}

const ATTITUDE_LABELS: Record<NpcAttitude, string> = {
  friendly: 'Дружелюбен',
  neutral: 'Нейтрален',
  hostile: 'Враждебен',
}

/** Поле вокруг карты в клетках: чтобы внешние стены на краю не обрезались. */
const MAP_PAD = 0.25
const PLAYER_ID = '@player'

/** Порядок рисования обстановки: ковры снизу, свечи — поверх столов. */
const OBJECT_ORDER = (o: MapObject) => (o.type === 'rug' ? 0 : o.type === 'candle' ? 2 : 1)

/** Элемент карты, на который можно навести или нажать. */
interface MapEntity {
  key: string
  name: string
  kindLabel: string
  description?: string
  /** Чем занят прямо сейчас (НПС) — то, что видно глазами; остальная личность — только ведущему. */
  activity?: string
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

export function LocationMap({ location, player, doors = {} }: Props) {
  const { width, height } = location
  const [active, setActive] = useState<ActiveEntity | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef<HTMLDivElement>(null)
  // Начался жест (сдвиг, масштаб) — подсказка закрывается, чтобы не отставать от карты.
  const viewport = useMapViewport(boxRef, zoomRef, () => setActive((cur) => (cur ? null : cur)))
  const scale = scaleOf(location)
  const profile = profileOf(location)
  const cols = width + MAP_PAD * 2
  const rows = height + MAP_PAD * 2

  const lights = useMemo(() => (profile.lighting ? lightSources(location) : []), [location, profile.lighting])
  const darkness = profile.lighting ? DARKNESS_OPACITY[ambientOf(location)] : 0

  // Перемещение фишек по клеткам пути (стены и закрытые двери обходятся).
  const path = useCallback((from: CellPosition, to: CellPosition) => walkPath(location, from, to, doors), [location, doors])
  const targets = useMemo(() => {
    const t: Record<string, CellPosition> = { [PLAYER_ID]: player }
    for (const npc of location.npcs) t[npc.id] = { x: npc.x, y: npc.y }
    return t
  }, [location.npcs, player])
  const walks = useWalks(targets, path)

  const entities = useMemo(() => {
    const map = new Map<string, MapEntity>()
    for (const obj of location.objects) {
      map.set(`obj:${obj.id}`, { key: `obj:${obj.id}`, name: obj.name, kindLabel: OBJECT_TYPE_LABELS[obj.type], description: obj.description, x: obj.x, y: obj.y, w: obj.w ?? 1, h: obj.h ?? 1 })
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
      map.set(`window:${win.id}`, { key: `window:${win.id}`, name: win.name ?? 'Окно', kindLabel: 'Окно', description: win.description, ...segmentBox(win, 0.3) })
    }
    for (const npc of location.npcs) {
      map.set(`npc:${npc.id}`, {
        key: `npc:${npc.id}`,
        name: npc.name,
        kindLabel: `НПС · ${ATTITUDE_LABELS[npc.attitude ?? 'neutral']}`,
        description: npc.description,
        activity: npc.activity,
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
      if (event.pointerType === 'mouse' && event.buttons === 0) setActive((cur) => (cur?.pinned ? cur : { key, pinned: false }))
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
  const objects = useMemo(() => [...location.objects].sort((a, b) => OBJECT_ORDER(a) - OBJECT_ORDER(b)), [location.objects])
  const heroPos = walks.pos[PLAYER_ID] ?? player
  const tokenR = profile.tokenRadius

  return (
    <div className="map-canvas">
      <div
        className="map-board"
        style={{ '--board-w': cols, '--board-h': rows } as CSSProperties}
        onClick={() => setActive(null)}
        data-map-kind={scale.kind}
        data-testid="map-board"
      >
        <div className="map-viewport" ref={boxRef} data-testid="map-viewport" data-zoom={viewport.view.scale.toFixed(2)}>
          <div className="map-zoom" ref={zoomRef}>
            <svg viewBox={`${-MAP_PAD} ${-MAP_PAD} ${cols} ${rows}`} className="map-svg" role="img" aria-label={`Карта: ${location.name}`}>
              <MapDefs lights={lights} />

              <FloorLayer location={location} grid={profile.grid} />

              <g className="map-layer map-layer--walls">
                <WallLines location={location} />
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

              <g className="map-layer map-layer--objects">
                {objects.map((obj) => (
                  <g key={obj.id} {...interactiveProps(`obj:${obj.id}`)} data-testid={`object-${obj.id}`} data-type={obj.type} data-flat={FLAT_OBJECT_TYPES.includes(obj.type) || undefined}>
                    <rect x={obj.x} y={obj.y} width={obj.w ?? 1} height={obj.h ?? 1} className="hit-area" />
                    <MapObjectIcon object={obj} />
                  </g>
                ))}
              </g>

              <g className="map-layer map-layer--tokens">
                {location.npcs.map((npc) => {
                  const pos = walks.pos[npc.id] ?? npc
                  return (
                    <g
                      key={npc.id}
                      {...interactiveProps(`npc:${npc.id}`)}
                      data-testid={`npc-${npc.id}`}
                      data-x={pos.x}
                      data-y={pos.y}
                      data-walking={walks.walking.has(npc.id) || undefined}
                    >
                      <g className="map-token" style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}>
                        <rect width={1} height={1} className="hit-area" />
                        <ellipse cx={0.56} cy={0.62} rx={tokenR} ry={tokenR * 0.8} className="token-shadow" />
                        <circle cx={0.5} cy={0.5} r={tokenR} className={`npc-token npc-token--${npc.attitude ?? 'neutral'}`} />
                        <text x={0.5} y={0.52} className="npc-initial">
                          {npc.name[0]}
                        </text>
                      </g>
                    </g>
                  )
                })}
                <g className="player-token" aria-label="Вы" data-testid="player-token" data-x={heroPos.x} data-y={heroPos.y} data-walking={walks.walking.has(PLAYER_ID) || undefined}>
                  <g className="map-token" style={{ transform: `translate(${heroPos.x}px, ${heroPos.y}px)` }}>
                    <ellipse cx={0.56} cy={0.64} rx={0.44} ry={0.36} className="token-shadow" />
                    <circle cx={0.5} cy={0.5} r={0.46} className="player-ring" />
                    <circle cx={0.5} cy={0.5} r={0.36} fill="url(#player-fill)" className="player-core" />
                  </g>
                </g>
              </g>

              <LightLayer width={width} height={height} lights={lights} darkness={darkness} />

              <g className="map-layer map-layer--ui" pointerEvents="none">
                {profile.labels &&
                  location.npcs.map((npc) => {
                    const pos = walks.pos[npc.id] ?? npc
                    return (
                      <g key={npc.id} className="map-token" style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}>
                        <text x={0.5} y={1.3} className="npc-label">
                          {npc.name}
                        </text>
                      </g>
                    )
                  })}
                <g className="map-token" style={{ transform: `translate(${heroPos.x}px, ${heroPos.y}px)` }}>
                  <text x={0.5} y={0.53} className="player-label">
                    Вы
                  </text>
                </g>
              </g>
            </svg>
          </div>
        </div>

        {activeEntity && (
          <MapTooltip entity={activeEntity} cols={cols} rows={rows} view={viewport.view} box={viewport.box} />
        )}

        <div className="map-controls" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="map-control" onClick={viewport.zoomIn} aria-label="Приблизить" title="Приблизить" data-testid="map-zoom-in">
            +
          </button>
          <button type="button" className="map-control" onClick={viewport.zoomOut} aria-label="Отдалить" title="Отдалить" disabled={viewport.view.scale <= 1} data-testid="map-zoom-out">
            −
          </button>
          <button
            type="button"
            className="map-control map-control--wide"
            onClick={() => viewport.centerOn(heroPos.x + 0.5 + MAP_PAD, heroPos.y + 0.5 + MAP_PAD, cols, rows)}
            data-testid="map-center-hero"
          >
            К герою
          </button>
          {viewport.view.scale > 1 && (
            <button type="button" className="map-control map-control--wide" onClick={viewport.reset} data-testid="map-reset">
              Вся карта
            </button>
          )}
        </div>

        <span className="map-scale" data-testid="map-scale">
          {scaleLabel(location)}
        </span>
      </div>
    </div>
  )
}

/** Слой пола: по одной фигуре на тип пола с узором, сетка поверх. Перерисовывается только при смене карты. */
const FloorLayer = memo(function FloorLayer({ location, grid }: { location: LocationData; grid: boolean }) {
  const areas = useMemo(() => floorAreas(location), [location])
  const outline = areas.map((a) => a.d).join('')
  return (
    <g className="map-layer map-layer--floor">
      {areas.map((a) => (
        <path key={a.floor} d={a.d} fill={`url(#${floorPatternId(a.floor)})`} className={`floor-area floor-area--${a.floor}`} data-floor={a.floor} data-cells={a.cells} />
      ))}
      {grid && (
        <>
          <clipPath id="floor-clip">
            <path d={outline} />
          </clipPath>
          <rect width={location.width} height={location.height} fill="url(#cell-grid)" clipPath="url(#floor-clip)" pointerEvents="none" className="map-grid" />
        </>
      )}
    </g>
  )
})

/**
 * Свет и тьма: вдали от источников — тень (сильнее при «тьме», слабее при «полумраке»), у источников — яркий круг
 * и тёплое свечение. Тьма «вырезается» маской с градиентом каждого света.
 */
const LightLayer = memo(function LightLayer({ width, height, lights, darkness }: { width: number; height: number; lights: MapLight[]; darkness: number }) {
  if (lights.length === 0 && darkness === 0) return null
  return (
    <g className="map-layer map-layer--effects" pointerEvents="none" data-testid="map-lighting" data-darkness={darkness} data-lights={lights.length}>
      {darkness > 0 && (
        <>
          <mask id="light-mask" maskUnits="userSpaceOnUse" x={-MAP_PAD} y={-MAP_PAD} width={width + MAP_PAD * 2} height={height + MAP_PAD * 2}>
            <rect x={-MAP_PAD} y={-MAP_PAD} width={width + MAP_PAD * 2} height={height + MAP_PAD * 2} className="light-mask-on" />
            {lights.map((l) => (
              <circle key={l.id} cx={l.x} cy={l.y} r={l.radius} fill={`url(#light-${l.id})`} />
            ))}
          </mask>
          <rect x={-MAP_PAD} y={-MAP_PAD} width={width + MAP_PAD * 2} height={height + MAP_PAD * 2} className="map-darkness" style={{ opacity: darkness }} mask="url(#light-mask)" />
        </>
      )}
      {lights.map((l) => (
        <circle key={l.id} cx={l.x} cy={l.y} r={Math.max(0.8, l.radius * 0.75)} fill="url(#warm-glow)" className="map-light-glow" data-testid={`light-${l.id}`} />
      ))}
    </g>
  )
})

function hitBox(entity: MapEntity | undefined) {
  return entity ? { x: entity.x, y: entity.y, width: entity.w, height: entity.h } : {}
}

interface TooltipProps {
  entity: MapEntity
  cols: number
  rows: number
  view: { scale: number; x: number; y: number }
  /** Размер окна карты в пикселях (сдвиг вида — в пикселях). */
  box: { w: number; h: number }
}

function MapTooltip({ entity, cols, rows, view, box }: TooltipProps) {
  // Доли ширины/высоты доски с учётом поля вокруг карты и текущего масштаба и сдвига (в долях окна).
  const { w, h } = box
  const fx = (x: number) => ((x + MAP_PAD) / cols) * view.scale + view.x / w
  const fy = (y: number) => ((y + MAP_PAD) / rows) * view.scale + view.y / h
  const centerX = fx(entity.x + entity.w / 2)
  // Элементы в верхней половине окна — подсказка снизу, иначе сверху, чтобы она не выходила за карту.
  const below = fy(entity.y + entity.h / 2) < 0.5
  const top = Math.min(1, Math.max(0, fy(below ? entity.y + entity.h : entity.y)))
  const align = centerX < 0.25 ? 'left' : centerX > 0.75 ? 'right' : 'center'
  const left = Math.min(1, Math.max(0, align === 'left' ? fx(entity.x) : align === 'right' ? fx(entity.x + entity.w) : centerX))

  return (
    <div
      className={`map-tooltip map-tooltip--${align} map-tooltip--${below ? 'below' : 'above'}`}
      style={{ left: `${left * 100}%`, top: `${top * 100}%` }}
      role="tooltip"
    >
      {entity.kindLabel !== entity.name && <span className="map-tooltip-kind">{entity.kindLabel}</span>}
      <strong className="map-tooltip-name">{entity.name}</strong>
      {entity.description && <p className="map-tooltip-text">{entity.description}</p>}
      {entity.activity && (
        <p className="map-tooltip-text map-tooltip-activity" data-testid="npc-activity">
          Сейчас: {entity.activity}
        </p>
      )}
    </div>
  )
}
