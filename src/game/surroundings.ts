// Окрестности здания: при выходе из здания через дверь движок сам строит карту снаружи — каркас, а не пустую
// маленькую карту от модели. Каркас: контур здания по размерам его внутренней карты (стены по периметру, входная дверь
// там же, где изнутри), двор и дорога перед входом, забор по краям карты, дороги за край карты (выходы). Модель только
// дополняет: объекты, эффекты, НПС, выходы. Если модель прислала свою карту окрестностей, движок вставляет в неё контур
// здания (stampBuilding) — затереть его нельзя. Чистые функции.
import { edgeKey, segmentEdges, type EdgeRef } from '../engine/movement'
import { outdoorLight, type GameTime } from '../engine/time'
import { TILE_FLOOR, TILE_VOID, type AmbientLight, type CellPosition, type Door, type DoorState, type LocationData, type MapExit, type WallEdge } from '../types/location'

/** Окрестности — не меньше SURROUNDINGS_FACTOR размеров здания по каждой стороне и не меньше SURROUNDINGS_MIN. */
export const SURROUNDINGS_FACTOR = 3
export const SURROUNDINGS_MIN = { width: 32, height: 24 } as const
/** Карта не больше этого (предел формата локаций). */
export const SURROUNDINGS_MAX = 100
/** Ширина дороги перед входом, клеток. */
const ROAD_WIDTH = 3

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
type Side = 'north' | 'south' | 'west' | 'east'

/** Контур здания — прямоугольник, охватывающий весь пол его внутренней карты. */
export function buildingFootprint(building: LocationData): Rect {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -1
  let y1 = -1
  building.floorPlan.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (c !== TILE_FLOOR) return
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }),
  )
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** Размер карты окрестностей: 3 размера здания по каждой стороне, не меньше 32×24, не больше 100. */
export function surroundingsSize(building: LocationData): { width: number; height: number } {
  const f = buildingFootprint(building)
  const size = (n: number, min: number) => Math.min(SURROUNDINGS_MAX, Math.max(min, n * SURROUNDINGS_FACTOR))
  return { width: size(f.w, SURROUNDINGS_MIN.width), height: size(f.h, SURROUNDINGS_MIN.height) }
}

/** Ребро двери выхода, через которое герой выходит из здания, и клетка снаружи за ним (в координатах здания). */
function doorwayOf(building: LocationData, exit: MapExit): { door: Door; edge: EdgeRef; outside: CellPosition; side: Side } | null {
  const door = building.doors.find((d) => d.id === exit.door)
  if (!door) return null
  for (const edge of segmentEdges(door) ?? []) {
    const [a, b] = edge.side === 'h' ? [{ x: edge.x, y: edge.y - 1 }, { x: edge.x, y: edge.y }] : [{ x: edge.x - 1, y: edge.y }, { x: edge.x, y: edge.y }]
    const inside = a.x === exit.x && a.y === exit.y ? a : b.x === exit.x && b.y === exit.y ? b : null
    if (!inside) continue
    const outside = inside === a ? b : a
    const side: Side = edge.side === 'h' ? (outside.y > inside.y ? 'south' : 'north') : outside.x > inside.x ? 'east' : 'west'
    return { door, edge, outside, side }
  }
  return null
}

/**
 * Здание из выхода — дверь наружу? Выход-дверь на клеточной карте, клетка за дверью — за краем карты здания или пустота.
 * Пустота за дверью, когда выход уже ведёт в существующее место, — это не здание, а контур здания на карте
 * окрестностей (дверь ведёт внутрь): такой выход зданием не считается.
 */
export function isBuildingDoorExit(building: LocationData, exit: MapExit, locations?: Record<string, LocationData>): boolean {
  if (exit.kind !== 'door' || (building.scale?.kind ?? 'tactical') !== 'tactical') return false
  const way = doorwayOf(building, exit)
  if (!way) return false
  const { x, y } = way.outside
  const inMap = y >= 0 && y < building.height && x >= 0 && x < building.width
  if (!inMap) return true
  if (building.floorPlan[y][x] === TILE_FLOOR) return false
  return !(exit.to && (locations ? locations[exit.to] : true))
}

/** Где здание встанет на карте окрестностей размера width × height: по центру (по краям — поле не меньше здания). */
export function buildingPlacement(building: LocationData, width: number, height: number): Rect {
  const f = buildingFootprint(building)
  return { x: Math.floor((width - f.w) / 2), y: Math.floor((height - f.h) / 2), w: f.w, h: f.h }
}

export interface StampOptions {
  /** Текущее состояние двери здания (снаружи она такая же). */
  doorState: DoorState
}

/** Что каркас здания занимает на карте окрестностей: контур, дверь, клетка у входа, выход назад. */
export interface BuildingFrame {
  rect: Rect
  door: Door
  /** Клетка снаружи у двери — сюда приходит отряд и отсюда уходит обратно. */
  entrance: CellPosition
  exit: MapExit
  side: Side
}

/** Каркас здания на карте окрестностей (без изменения карты): положение, дверь, вход, выход назад. */
export function buildingFrame(location: Pick<LocationData, 'width' | 'height'>, building: LocationData, buildingExit: MapExit, options: StampOptions): BuildingFrame | null {
  const way = doorwayOf(building, buildingExit)
  if (!way) return null
  const f = buildingFootprint(building)
  const rect = buildingPlacement(building, location.width, location.height)
  const dx = rect.x - f.x
  const dy = rect.y - f.y
  const entrance = { x: way.outside.x + dx, y: way.outside.y + dy }
  if (entrance.x < 0 || entrance.y < 0 || entrance.x >= location.width || entrance.y >= location.height) return null
  const d = way.door
  const door: Door = {
    id: `${building.id}-door`,
    name: d.name,
    ...(d.description ? { description: d.description } : {}),
    state: options.doorState,
    x1: d.x1 + dx,
    y1: d.y1 + dy,
    x2: d.x2 + dx,
    y2: d.y2 + dy,
  }
  const exit: MapExit = {
    id: `to-${building.id}`,
    kind: 'door',
    name: `${d.name} (${building.name})`,
    door: door.id,
    x: entrance.x,
    y: entrance.y,
    to: building.id,
    toExit: buildingExit.id,
  }
  return { rect, door, entrance, exit, side: way.side }
}

const inRect = (c: CellPosition, r: Rect) => c.x >= r.x && c.x < r.x + r.w && c.y >= r.y && c.y < r.y + r.h
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
/** Клетки по обе стороны единичного ребра. */
const edgeCells = (e: { side: 'h' | 'v'; x: number; y: number }): [CellPosition, CellPosition] =>
  e.side === 'h' ? [{ x: e.x, y: e.y - 1 }, { x: e.x, y: e.y }] : [{ x: e.x - 1, y: e.y }, { x: e.x, y: e.y }]

/** Стоит ли уже каркас этого здания на карте (контур — пустота, дверь и выход назад на месте). */
export function hasBuildingFrame(location: LocationData, frame: BuildingFrame): boolean {
  const { rect } = frame
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) if (location.floorPlan[y]?.[x] !== TILE_VOID) return false
  const door = location.doors.find((d) => d.id === frame.door.id)
  const exit = location.exits?.find((e) => e.id === frame.exit.id)
  return Boolean(door && door.x1 === frame.door.x1 && door.y1 === frame.door.y1 && exit && exit.x === frame.entrance.x && exit.y === frame.entrance.y && exit.to === frame.exit.to)
}

/**
 * Вставить контур здания в карту окрестностей: клетки здания — не пол (снаружи туда не войти), по периметру — стены
 * материала здания, на стене — входная дверь, у неё снаружи — свободная клетка пола и выход назад в здание.
 * Всё, что модель поставила на место здания и у двери (объекты, НПС, эффекты, зоны, стены, двери, выходы), убирается;
 * другие выходы в это здание заменяются выходом к нарисованной двери. Возвращает карту и что убрано.
 */
export function stampBuilding(location: LocationData, building: LocationData, buildingExit: MapExit, options: StampOptions): { location: LocationData; removed: string[] } | null {
  const frame = buildingFrame(location, building, buildingExit, options)
  if (!frame) return null
  const { rect, entrance } = frame
  const removed: string[] = []
  const blocked = (r: Rect) => overlaps(r, rect) || inRect(entrance, r)
  const area = (o: { x: number; y: number; w?: number; h?: number }): Rect => ({ x: o.x, y: o.y, w: o.w ?? 1, h: o.h ?? 1 })
  const keep = <T extends { id: string; name?: string; x: number; y: number; w?: number; h?: number }>(list: T[] | undefined, what: string) =>
    (list ?? []).filter((o) => {
      if (!blocked(area(o))) return true
      removed.push(`${what} «${o.name ?? o.id}»`)
      return false
    })

  const floorPlan = location.floorPlan.map((row, y) => [...row].map((c, x) => (inRect({ x, y }, rect) ? TILE_VOID : inRect({ x, y }, { ...entrance, w: 1, h: 1 }) ? TILE_FLOOR : c)).join(''))
  // Стены и двери модели на контуре и внутри здания — прочь; контур — стенами здания.
  const touches = (e: { side: 'h' | 'v'; x: number; y: number }) => edgeCells(e).some((c) => inRect(c, rect))
  const walls: WallEdge[] = location.walls.filter((e) => !touches(e))
  const material = building.wallMaterial
  for (let x = rect.x; x < rect.x + rect.w; x++) {
    walls.push({ side: 'h', x, y: rect.y, material }, { side: 'h', x, y: rect.y + rect.h, material })
  }
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    walls.push({ side: 'v', x: rect.x, y, material }, { side: 'v', x: rect.x + rect.w, y, material })
  }
  // Ребро на краю карты — у самого края стоит здание: на карте окрестностей оно всегда с полем, но на всякий случай.
  const inMap = (e: WallEdge) => (e.side === 'h' ? e.y >= 0 && e.y <= location.height && e.x >= 0 && e.x < location.width : e.x >= 0 && e.x <= location.width && e.y >= 0 && e.y < location.height)
  const unique = new Map(walls.filter(inMap).map((e) => [edgeKey(e.side, e.x, e.y), e]))
  const doorTouches = (d: Door) => (segmentEdges(d) ?? []).some(touches)
  const doors = [...location.doors.filter((d) => {
    if (!doorTouches(d) && d.id !== frame.door.id) return true
    removed.push(`дверь «${d.name}»`)
    return false
  }), frame.door]
  const windows = location.windows.filter((w) => !(segmentEdges(w) ?? []).some(touches))
  const objects = keep(location.objects, 'объект')
  const npcs = keep(location.npcs, 'НПС')
  const effects = location.effects ? keep(location.effects, 'эффект') : undefined
  const zones = location.zones ? keep(location.zones, 'зона') : undefined
  const exits = [
    ...(location.exits ?? []).filter((e) => {
      if (e.to === building.id || e.id === frame.exit.id || inRect(e, rect) || (e.x === entrance.x && e.y === entrance.y)) {
        removed.push(`выход «${e.name}»`)
        return false
      }
      return true
    }),
    frame.exit,
  ]
  const start = inRect(location.playerStart, rect) ? entrance : location.playerStart
  return {
    location: {
      ...location,
      floorPlan,
      rooms: location.rooms.filter((r) => !(r.x >= rect.x && r.y >= rect.y && r.x + r.w <= rect.x + rect.w && r.y + r.h <= rect.y + rect.h)),
      walls: [...unique.values()].sort((a, b) => a.side.localeCompare(b.side) || a.y - b.y || a.x - b.x),
      doors,
      windows,
      objects,
      npcs,
      ...(effects ? { effects } : {}),
      ...(zones ? { zones } : {}),
      exits,
      playerStart: start,
    },
    removed,
  }
}

/** Свет под открытым небом по игровому времени (в терминах карты). */
export function outdoorAmbient(time: GameTime): AmbientLight {
  const light = outdoorLight(time)
  return light === 'darkness' ? 'dark' : light
}

const SIDE_NAMES = { north: ['запад', 'восток'], south: ['запад', 'восток'], west: ['север', 'юг'], east: ['север', 'юг'] } as const

/**
 * Каркас окрестностей здания, построенный движком: трава вокруг, контур здания по центру, двор (земля) у входа,
 * дорога поперёк карты перед входом с выходами за край карты, деревянный забор по краям (кроме концов дороги).
 */
export function buildSurroundings(building: LocationData, buildingExit: MapExit, options: StampOptions & { id: string; time: GameTime }): LocationData | null {
  const { width, height } = surroundingsSize(building)
  const frame = buildingFrame({ width, height }, building, buildingExit, options)
  if (!frame) return null
  const { rect, entrance, side } = frame
  const vertical = side === 'north' || side === 'south'
  // Дорога — посередине поля между зданием и краем карты на стороне входа; двор — от двери до дороги.
  const gap = side === 'south' ? height - (rect.y + rect.h) : side === 'north' ? rect.y : side === 'east' ? width - (rect.x + rect.w) : rect.x
  const roadOffset = Math.max(1, Math.floor((gap - ROAD_WIDTH) / 2))
  const road: Rect = vertical
    ? { x: 0, y: side === 'south' ? rect.y + rect.h + roadOffset : rect.y - roadOffset - ROAD_WIDTH, w: width, h: ROAD_WIDTH }
    : { x: side === 'east' ? rect.x + rect.w + roadOffset : rect.x - roadOffset - ROAD_WIDTH, y: 0, w: ROAD_WIDTH, h: height }
  const yard: Rect = vertical
    ? { x: entrance.x - 1, y: side === 'south' ? entrance.y : road.y + road.h, w: 3, h: side === 'south' ? road.y - entrance.y : entrance.y - (road.y + road.h) + 1 }
    : { x: side === 'east' ? entrance.x : road.x + road.w, y: entrance.y - 1, w: side === 'east' ? road.x - entrance.x : entrance.x - (road.x + road.w) + 1, h: 3 }
  const mid = vertical ? road.y + 1 : road.x + 1
  const [nameA, nameB] = SIDE_NAMES[side]
  const ends: MapExit[] = vertical
    ? [
        { id: 'road-a', kind: 'edge', name: `Дорога на ${nameA}`, x: 0, y: mid },
        { id: 'road-b', kind: 'edge', name: `Дорога на ${nameB}`, x: width - 1, y: mid },
      ]
    : [
        { id: 'road-a', kind: 'edge', name: `Дорога на ${nameA}`, x: mid, y: 0 },
        { id: 'road-b', kind: 'edge', name: `Дорога на ${nameB}`, x: mid, y: height - 1 },
      ]
  // Забор по краю карты; у концов дороги — проход.
  const fence: WallEdge[] = []
  const onRoad = (c: CellPosition) => inRect(c, road)
  for (let x = 0; x < width; x++) {
    if (!onRoad({ x, y: 0 })) fence.push({ side: 'h', x, y: 0, material: 'wood' })
    if (!onRoad({ x, y: height - 1 })) fence.push({ side: 'h', x, y: height, material: 'wood' })
  }
  for (let y = 0; y < height; y++) {
    if (!onRoad({ x: 0, y })) fence.push({ side: 'v', x: 0, y, material: 'wood' })
    if (!onRoad({ x: width - 1, y })) fence.push({ side: 'v', x: width, y, material: 'wood' })
  }
  const base: LocationData = {
    id: options.id,
    name: `Снаружи: ${building.name}`,
    description: `Двор и дорога у входа в «${building.name}», вокруг — трава и ограда.`,
    cellFeet: building.cellFeet,
    scale: { kind: 'tactical', cell: building.cellFeet, unit: 'ft' },
    // Окрестности — на том же уровне, что и здание (у той же карты уровнем выше).
    ...(building.parent ? { parent: building.parent } : {}),
    ambientLight: outdoorAmbient(options.time),
    width,
    height,
    floor: 'grass',
    wallMaterial: 'wood',
    floorPlan: Array.from({ length: height }, () => TILE_FLOOR.repeat(width)),
    rooms: [
      { id: 'road', name: 'Дорога', floor: 'dirt', ...road },
      { id: 'yard', name: `Двор у входа`, floor: 'dirt', ...yard },
    ],
    walls: fence,
    doors: [],
    windows: [],
    objects: [],
    npcs: [],
    exits: ends,
    playerStart: entrance,
  }
  return stampBuilding(base, building, buildingExit, options)?.location ?? null
}

/**
 * Здание, окрестности которого — эта карта: выход карты ведёт (`to`) в существующую локацию, а та выходит наружу
 * через дверь (её выход `toExit`, или ведущий сюда, или первый выход-дверь наружу). null — карта не окрестности здания.
 */
export function buildingLinkOf(locations: Record<string, LocationData>, location: Pick<LocationData, 'id' | 'exits'>): { building: LocationData; exit: MapExit } | null {
  for (const e of location.exits ?? []) {
    const building = e.to ? locations[e.to] : undefined
    if (!building) continue
    const candidates = [
      ...(building.exits ?? []).filter((b) => b.id === e.toExit || b.to === location.id),
      ...(building.exits ?? []),
    ]
    const exit = candidates.find((b) => isBuildingDoorExit(building, b, locations))
    if (exit) return { building, exit }
  }
  return null
}

/** Слишком маленькая карта окрестностей здания — понятная подсказка, или null. */
export function surroundingsSizeProblem(building: LocationData, exit: MapExit, size: { width: number; height: number }): string | null {
  const need = surroundingsSize(building)
  if (size.width >= need.width && size.height >= need.height) return null
  const f = buildingFootprint(building)
  return (
    `Это окрестности здания «${building.name}» (выход «${exit.name}»): карта не меньше ${need.width}×${need.height} клеток — ` +
    `${SURROUNDINGS_FACTOR} размера здания (${f.w}×${f.h}) по каждой стороне и не меньше ${SURROUNDINGS_MIN.width}×${SURROUNDINGS_MIN.height}; у тебя ${size.width}×${size.height}. ` +
    `Проще не создавать её: travel через «${exit.name}» сам построит каркас (здание, двор, дорога, забор) — потом дополни его add_object, add_effect, add_npc, add_exit.`
  )
}
