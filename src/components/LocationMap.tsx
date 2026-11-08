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
  MAX_WALK_STEPS,
  walkPath,
  type MapLight,
} from '../game/mapView'
import type { MapPing } from '../types/story'
import { useMapChanges } from './useMapChanges'
import { EFFECT_KIND_NAMES, FLAT_OBJECT_TYPES, type MapEffect, type CellPosition, type DoorState, type LocationData, type MapObject, type MapObjectType, type NpcAttitude } from '../types/location'
import type { HeroMovePlan } from '../game/heroMove'
import { entityActions } from '../game/mapActions'
import { MapDefs } from './MapDefs'
import { MapObjectIcon } from './MapIcons'
import { DOOR_STATE_LABELS, floorPatternId, segmentBox } from './mapDrawing'
import { DoorIcon, WallLines, WindowIcon } from './MapWalls'
import { useMapViewport } from './useMapViewport'
import { useWalks, WALK_STEP_MS } from './useWalk'

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
  /** Что это — для меню действий. */
  kind: 'npc' | 'object' | 'door' | 'window'
  /** Вид объекта (для «Взять») или состояние двери (для «Открыть/Закрыть»). */
  type?: MapObjectType
  doorState?: DoorState
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

/** Перемещение героя игроком (пути и проверки — src/game/heroMove.ts; запись — действие heroMoved через хранилище). */
export interface HeroMovement {
  /** Путь и длина или причина, почему туда нельзя. */
  plan: (to: CellPosition) => HeroMovePlan | string
  /** Клетки, куда герой может дойти (ключ «x,y»). */
  reachable: () => Set<string>
  /** Путь героя для анимации (с учётом занятых клеток). */
  path: (from: CellPosition, to: CellPosition) => CellPosition[] | null
  /** Передвинуть героя (действие хранилища); причина отказа или null. */
  move: (to: CellPosition) => string | null
  /** «Подойти»: встать рядом с областью; причина отказа или null. */
  approach: (area: { x: number; y: number; w: number; h: number }) => string | null
}

/** Действия героя из меню карты — сообщение ведущему от имени героя. */
export interface MapActions {
  send: (text: string) => void
  /** Ведущий отвечает или история только для чтения — действия недоступны. */
  disabled: boolean
}

interface Props {
  location: LocationData
  player: CellPosition
  /** Текущие состояния дверей (из состояния игры). */
  doors?: DoorStates
  movement?: HeroMovement
  actions?: MapActions
  /** Подсветка ведущего (ping): показывается несколько секунд, если появилась при открытой карте. */
  ping?: MapPing
}

/** Сколько ушедший НПС стоит у выхода, прежде чем исчезнуть, мс. */
const LEAVE_LINGER_MS = 900
/** Сколько видна подсветка ведущего, мс. */
export const PING_MS = 4000

/** Перетаскивание токена героя: клетка под пальцем или курсором, путь до неё или причина отказа. */
interface DragState {
  target: CellPosition | null
  plan: HeroMovePlan | string | null
  reachable: Set<string>
}

export function LocationMap({ location, player, doors = {}, movement, actions, ping }: Props) {
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
  const path = useCallback(
    (from: CellPosition, to: CellPosition, id: string) => (id === PLAYER_ID && movement ? movement.path(from, to) : walkPath(location, from, to, doors)),
    [location, doors, movement],
  )
  // Изменения от ведущего: новые НПС идут от входа, ушедшие — к выходу; объекты проявляются и тают; скрытых не видно.
  const exit = location.playerStart
  const changes = useMapChanges(location, (npc) => {
    const steps = walkPath(location, npc, exit, doors)?.length ?? 1
    // Дойти до выхода и ещё немного постоять у двери — чтобы уход было видно.
    return Math.min(steps, MAX_WALK_STEPS) * WALK_STEP_MS + LEAVE_LINGER_MS
  })
  const spawned = changes.spawned
  const spawn = useCallback((id: string) => (spawned.has(id) ? exit : null), [spawned, exit])
  const targets = useMemo(() => {
    const t: Record<string, CellPosition> = { [PLAYER_ID]: player }
    for (const npc of changes.npcs) t[npc.id] = { x: npc.x, y: npc.y }
    for (const npc of changes.leavingNpcs) t[npc.id] = exit
    return t
  }, [changes.npcs, changes.leavingNpcs, player, exit])
  const walks = useWalks(targets, path, spawn)

  // Подсветка ведущего: только новая (не та, что была при открытии карты), на PING_MS.
  const [pingSeen, setPingSeen] = useState(ping?.id ?? null)
  const [shownPing, setShownPing] = useState<MapPing | null>(null)
  if ((ping?.id ?? null) !== pingSeen) {
    setPingSeen(ping?.id ?? null)
    setShownPing(ping && ping.locationId === location.id ? ping : null)
  }
  useEffect(() => {
    if (!shownPing) return
    const timer = window.setTimeout(() => setShownPing(null), PING_MS)
    return () => window.clearTimeout(timer)
  }, [shownPing])

  const entities = useMemo(() => {
    const map = new Map<string, MapEntity>()
    for (const obj of changes.objects) {
      map.set(`obj:${obj.id}`, { key: `obj:${obj.id}`, kind: 'object', type: obj.type, name: obj.name, kindLabel: OBJECT_TYPE_LABELS[obj.type], description: obj.description, x: obj.x, y: obj.y, w: obj.w ?? 1, h: obj.h ?? 1 })
    }
    for (const door of location.doors) {
      map.set(`door:${door.id}`, {
        key: `door:${door.id}`,
        kind: 'door',
        doorState: doorState(door, doors),
        name: door.name,
        kindLabel: `Дверь · ${DOOR_STATE_LABELS[doorState(door, doors)]}`,
        description: door.description,
        ...segmentBox(door, 0.3),
      })
    }
    for (const win of location.windows) {
      map.set(`window:${win.id}`, { key: `window:${win.id}`, kind: 'window', name: win.name ?? 'Окно', kindLabel: 'Окно', description: win.description, ...segmentBox(win, 0.3) })
    }
    for (const npc of changes.npcs) {
      map.set(`npc:${npc.id}`, {
        key: `npc:${npc.id}`,
        kind: 'npc',
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
  }, [location, doors, changes.objects, changes.npcs])

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

  // ---------- Перемещение героя: перетаскивание токена и нажатие на клетку ----------
  const svgRef = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(noticeTimer.current), [])
  const say = useCallback((text: string) => {
    setNotice(text)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2600)
  }, [])

  /** Клетка под точкой экрана (с учётом масштаба и сдвига карты). */
  const cellAt = useCallback(
    (clientX: number, clientY: number): CellPosition | null => {
      // Экранные координаты → координаты карты: учитывают масштаб, сдвиг и поля вокруг вписанного SVG.
      const svg = svgRef.current
      const m = svg?.getScreenCTM()
      if (!svg || !m) return null
      const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse())
      const x = Math.floor(p.x)
      const y = Math.floor(p.y)
      return x >= 0 && y >= 0 && x < width && y < height ? { x, y } : null
    },
    [width, height],
  )

  const tryMove = useCallback(
    (to: CellPosition) => {
      if (!movement) return
      const plan = movement.plan(to)
      if (typeof plan === 'string') return say(plan)
      if (plan.path.length === 0) return
      const reason = movement.move(to)
      if (reason) say(reason)
    },
    [movement, say],
  )

  const startDrag = (event: PointerEvent) => {
    if (!movement || (event.pointerType === 'mouse' && event.button !== 0)) return
    event.stopPropagation()
    event.preventDefault()
    setActive(null)
    const box = boxRef.current
    if (box) box.dataset.tokenDrag = '1'
    let state: DragState = { target: null, plan: null, reachable: movement.reachable() }
    let moved = false
    setDrag(state)
    const onMove = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== event.pointerId) return
      const cell = cellAt(e.clientX, e.clientY)
      if (!cell || (state.target && cell.x === state.target.x && cell.y === state.target.y)) return
      moved = moved || cell.x !== heroPos.x || cell.y !== heroPos.y
      state = { ...state, target: cell, plan: movement.plan(cell) }
      setDrag(state)
    }
    const finish = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== event.pointerId) return
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      if (box) delete box.dataset.tokenDrag
      setDrag(null)
      if (e.type === 'pointercancel' || !moved || !state.target) return
      // Отпустить токен в стену, на занятую клетку или за закрытую дверь нельзя — герой остаётся на месте.
      if (typeof state.plan === 'string') say(state.plan)
      else tryMove(state.target)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  /** Нажатие на пустое место карты: закрыть меню, а если меню не было — идти в эту клетку. */
  const onBoardClick = (event: React.MouseEvent) => {
    if (active) return setActive(null)
    if (!movement) return
    const cell = cellAt(event.clientX, event.clientY)
    if (cell && !(cell.x === heroPos.x && cell.y === heroPos.y)) tryMove(cell)
  }

  /** Действие из меню: «Подойти» — сначала шаги героя, затем сообщение ведущему от имени героя. */
  const runAction = (entity: MapEntity, action: { id: string; text: string }) => {
    setActive(null)
    if (!actions || actions.disabled) return
    if (action.id === 'approach' && movement) {
      const reason = movement.approach({ x: entity.x, y: entity.y, w: entity.w, h: entity.h })
      if (reason) return say(reason)
    }
    actions.send(action.text)
  }
  const objects = useMemo(() => [...changes.objects].sort((a, b) => OBJECT_ORDER(a) - OBJECT_ORDER(b)), [changes.objects])
  const heroPos = walks.pos[PLAYER_ID] ?? player
  const tokenR = profile.tokenRadius

  return (
    <div className="map-canvas">
      <div
        className="map-board"
        style={{ '--board-w': cols, '--board-h': rows } as CSSProperties}
        onClick={onBoardClick}
        data-map-kind={scale.kind}
        data-testid="map-board"
      >
        <div className="map-viewport" ref={boxRef} data-testid="map-viewport" data-zoom={viewport.view.scale.toFixed(2)}>
          <div className="map-zoom" ref={zoomRef}>
            <svg ref={svgRef} viewBox={`${-MAP_PAD} ${-MAP_PAD} ${cols} ${rows}`} className="map-svg" role="img" aria-label={`Карта: ${location.name}`}>
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
                  <g
                    key={obj.id}
                    {...interactiveProps(`obj:${obj.id}`)}
                    data-testid={`object-${obj.id}`}
                    data-type={obj.type}
                    data-x={obj.x}
                    data-y={obj.y}
                    data-flat={FLAT_OBJECT_TYPES.includes(obj.type) || undefined}
                    data-fresh={changes.fresh.has(obj.id) || undefined}
                  >
                    {/* Сдвиг объекта (update_object) — плавный переход, а не прыжок. */}
                    <g className={`map-object-pos${changes.fresh.has(obj.id) ? ' is-appearing' : ''}`} style={{ transform: `translate(${obj.x}px, ${obj.y}px)` }}>
                      <rect width={obj.w ?? 1} height={obj.h ?? 1} className="hit-area" />
                      <MapObjectIcon object={{ ...obj, x: 0, y: 0 }} />
                    </g>
                  </g>
                ))}
                {changes.leavingObjects.map((obj) => (
                  <g key={`gone-${obj.id}`} className="map-object-pos is-leaving" style={{ transform: `translate(${obj.x}px, ${obj.y}px)` }} data-testid={`object-leaving-${obj.id}`} pointerEvents="none">
                    <MapObjectIcon object={{ ...obj, x: 0, y: 0 }} />
                  </g>
                ))}
              </g>

              <g className="map-layer map-layer--tokens">
                {changes.leavingNpcs.map((npc) => {
                  const pos = walks.pos[npc.id] ?? npc
                  return (
                    <g key={`gone-${npc.id}`} className="npc-leaving" data-testid={`npc-leaving-${npc.id}`} data-x={pos.x} data-y={pos.y} pointerEvents="none">
                      <g className="map-token" style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}>
                        <circle cx={0.5} cy={0.5} r={tokenR} className={`npc-token npc-token--${npc.attitude ?? 'neutral'}`} />
                        <text x={0.5} y={0.52} className="npc-initial">
                          {npc.name[0]}
                        </text>
                      </g>
                    </g>
                  )
                })}
                {changes.npcs.map((npc) => {
                  const pos = walks.pos[npc.id] ?? npc
                  return (
                    <g
                      key={npc.id}
                      {...interactiveProps(`npc:${npc.id}`)}
                      data-testid={`npc-${npc.id}`}
                      data-x={pos.x}
                      data-y={pos.y}
                      data-walking={walks.walking.has(npc.id) || undefined}
                      data-fresh={changes.fresh.has(npc.id) || undefined}
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
                <g
                  className={`player-token${movement ? ' is-draggable' : ''}${drag ? ' is-dragging' : ''}`}
                  aria-label="Вы"
                  data-testid="player-token"
                  data-x={heroPos.x}
                  data-y={heroPos.y}
                  data-walking={walks.walking.has(PLAYER_ID) || undefined}
                  data-draggable={movement ? 'true' : undefined}
                  onPointerDown={movement ? startDrag : undefined}
                  onClick={(e) => e.stopPropagation()}
                >
                  <g className="map-token" style={{ transform: `translate(${heroPos.x}px, ${heroPos.y}px)` }}>
                    <ellipse cx={0.56} cy={0.64} rx={0.44} ry={0.36} className="token-shadow" />
                    <circle cx={0.5} cy={0.5} r={0.46} className="player-ring" />
                    <circle cx={0.5} cy={0.5} r={0.36} fill="url(#player-fill)" className="player-core" />
                  </g>
                </g>
              </g>

              <EffectLayer effects={location.effects} />

              <LightLayer width={width} height={height} lights={lights} darkness={darkness} />

              <g className="map-layer map-layer--ui" pointerEvents="none">
                {drag && <DragOverlay location={location} drag={drag} hero={heroPos} />}
                {shownPing && <PingMarker key={shownPing.id} ping={shownPing} />}
                {profile.labels &&
                  changes.npcs.map((npc) => {
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
          <MapTooltip
            entity={activeEntity}
            cols={cols}
            rows={rows}
            view={viewport.view}
            box={viewport.box}
            menu={active?.pinned && actions ? { disabled: actions.disabled, run: (a) => runAction(activeEntity, a) } : undefined}
          />
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

        {notice && (
          <p className="map-notice" role="status" data-testid="map-notice">
            {notice}
          </p>
        )}

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

/** Эффекты ведущего (огонь, дым, тьма, лужа, свечение) — области поверх обстановки и фишек. */
const EffectLayer = memo(function EffectLayer({ effects }: { effects?: MapEffect[] }) {
  if (!effects?.length) return null
  return (
    <g className="map-layer map-layer--map-effects" pointerEvents="none">
      {effects.map((e) => (
        <rect
          key={e.id}
          x={e.x + 0.05}
          y={e.y + 0.05}
          width={e.w - 0.1}
          height={e.h - 0.1}
          rx={Math.min(0.45, e.w / 2, e.h / 2)}
          className={`map-effect map-effect--${e.kind}`}
          data-testid={`effect-${e.id}`}
          data-kind={e.kind}
        >
          <title>{e.name ?? EFFECT_KIND_NAMES[e.kind]}</title>
        </rect>
      ))}
    </g>
  )
})

/** Подсветка ведущего: пульсирующая рамка вокруг цели и подпись. */
function PingMarker({ ping }: { ping: MapPing }) {
  const cx = ping.x + ping.w / 2
  const cy = ping.y + ping.h / 2
  return (
    <g className="map-ping" data-testid="map-ping" data-x={ping.x} data-y={ping.y}>
      <rect x={ping.x - 0.1} y={ping.y - 0.1} width={ping.w + 0.2} height={ping.h + 0.2} rx={0.25} className="map-ping-frame" />
      <circle cx={cx} cy={cy} r={Math.max(ping.w, ping.h) / 2 + 0.3} className="map-ping-wave" />
      {ping.label && (
        <text x={cx} y={ping.y - 0.35} className="drag-label map-ping-label">
          {ping.label}
        </text>
      )}
    </g>
  )
}

/** Подсветка при перетаскивании: недоступные клетки, путь по центрам клеток, длина в футах, тень токена в цели. */
function DragOverlay({ location, drag, hero }: { location: LocationData; drag: DragState; hero: CellPosition }) {
  const blocked = useMemo(() => {
    let d = ''
    for (let y = 0; y < location.height; y++)
      for (let x = 0; x < location.width; x++) if (location.floorPlan[y][x] === '.' && !drag.reachable.has(`${x},${y}`)) d += `M${x} ${y}h1v1h-1z`
    return d
  }, [location, drag.reachable])
  const ok = drag.plan !== null && typeof drag.plan !== 'string'
  const t = drag.target
  const points = ok ? [hero, ...(drag.plan as HeroMovePlan).path].map((c) => `${c.x + 0.5},${c.y + 0.5}`).join(' ') : ''
  return (
    <g className="drag-overlay" data-testid="drag-overlay">
      {blocked && <path d={blocked} className="map-unreachable" data-testid="map-unreachable" />}
      {ok && <polyline points={points} className="drag-path" data-testid="drag-path" data-steps={(drag.plan as HeroMovePlan).path.length} />}
      {t && (
        <g className={`drag-target${ok ? '' : ' is-invalid'}`} data-testid="drag-target" data-valid={ok} data-x={t.x} data-y={t.y}>
          <circle cx={t.x + 0.5} cy={t.y + 0.5} r={0.4} className="drag-ghost" />
          <text x={t.x + 0.5} y={t.y - 0.25} className="drag-label" data-testid="drag-distance">
            {ok ? `${(drag.plan as HeroMovePlan).feet} фт.` : 'нельзя'}
          </text>
        </g>
      )}
    </g>
  )
}

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
  /** Меню действий (у закреплённой подсказки). */
  menu?: { disabled: boolean; run: (action: { id: string; text: string }) => void }
}

function MapTooltip({ entity, cols, rows, view, box, menu }: TooltipProps) {
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
      className={`map-tooltip map-tooltip--${align} map-tooltip--${below ? 'below' : 'above'}${menu ? ' map-tooltip--menu' : ''}`}
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
      {menu && (
        <div className="map-actions" role="group" aria-label="Действия" data-testid="map-actions" onClick={(e) => e.stopPropagation()}>
          {entityActions(entity).map((a) => (
            <button key={a.id} type="button" className="map-action" disabled={menu.disabled} onClick={() => menu.run(a)} data-action={a.id}>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
