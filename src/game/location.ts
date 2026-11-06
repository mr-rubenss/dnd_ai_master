// Загрузка и валидация локаций из JSON. Чистые функции — без React и без обращений к API.
// Нужна, чтобы проверять как готовые файлы, так и локации, сгенерированные ИИ.
//
// Локацию можно задать двумя способами (и смешивать их):
// - полная запись: план пола `floorPlan` и стены-отрезки `walls`;
// - упрощённая: комнаты-прямоугольники `rooms` (стены по периметру ставятся сами),
//   перегородки `walls`, проёмы `openings` (убирают стену).
// Двери и окна — отрезки на стенах. Результат всегда в полной записи (`LocationData`).

import { edgeBetween, edgeKey, segmentEdges, type EdgeRef } from '../engine/movement'
import {
  DOOR_STATES,
  FLOOR_TYPES,
  NPC_ATTITUDES,
  NPC_PERSONALITY_FIELDS,
  NPC_PERSONALITY_LIMITS,
  OBJECT_TYPES,
  TILE_FLOOR,
  TILE_VOID,
  WALL_MATERIALS,
  type CellPosition,
  type Door,
  type GridSegment,
  type LocationData,
  type MapObject,
  type MapWindow,
  type Npc,
  type Room,
  type WallEdge,
  type WallMaterial,
} from '../types/location'
import { isInt, isNonEmptyString, isObject, isOneOf, ValidationError } from './validation'

export class LocationValidationError extends ValidationError {
  constructor(problems: string[]) {
    super('Некорректная локация', problems)
    this.name = 'LocationValidationError'
  }
}

/** Ребро как отрезок между узлами — для сообщений об ошибках. */
export function describeEdge(edge: EdgeRef): string {
  const { x, y } = edge
  return edge.side === 'h' ? `(${x}, ${y})–(${x + 1}, ${y})` : `(${x}, ${y})–(${x}, ${y + 1})`
}

const describeSegment = (s: GridSegment) => `(${s.x1}, ${s.y1})–(${s.x2}, ${s.y2})`

/** Сколько недостижимых клеток перечислять в сообщении. */
const MAX_LISTED_CELLS = 5

/** Проверяет произвольные данные (например, распарсенный JSON) и возвращает типизированную локацию. */
export function parseLocation(raw: unknown): LocationData {
  const problems: string[] = []
  const fail = (message: string) => {
    problems.push(message)
  }

  if (!isObject(raw)) throw new LocationValidationError(['локация должна быть объектом'])

  for (const key of ['id', 'name', 'description'] as const) {
    if (!isNonEmptyString(raw[key])) fail(`поле "${key}" должно быть непустой строкой`)
  }
  if (!isInt(raw.cellFeet) || raw.cellFeet <= 0) fail('"cellFeet" должно быть положительным целым числом')
  if (!isInt(raw.width) || raw.width < 1 || raw.width > 100) fail('"width" должно быть целым от 1 до 100')
  if (!isInt(raw.height) || raw.height < 1 || raw.height > 100) fail('"height" должно быть целым от 1 до 100')
  if (!isOneOf(FLOOR_TYPES, raw.floor)) fail(`"floor" должно быть одним из: ${FLOOR_TYPES.join(', ')}`)
  if (!isOneOf(WALL_MATERIALS, raw.wallMaterial)) fail(`"wallMaterial" должно быть одним из: ${WALL_MATERIALS.join(', ')}`)
  for (const key of ['floorPlan', 'rooms', 'walls', 'openings', 'doors', 'windows'] as const) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) fail(`"${key}" должно быть массивом`)
  }
  if (raw.floorPlan === undefined && raw.rooms === undefined) fail('нужен план пола "floorPlan" или комнаты "rooms"')

  // Без корректных размеров дальнейшие проверки координат бессмысленны.
  if (problems.length > 0) throw new LocationValidationError(problems)
  const width = raw.width as number
  const height = raw.height as number
  const wallMaterial = raw.wallMaterial as WallMaterial
  const list = (key: string) => (Array.isArray(raw[key]) ? (raw[key] as unknown[]) : [])

  // ---------- Пол ----------
  const floor: boolean[][] = Array.from({ length: height }, () => Array<boolean>(width).fill(false))
  const isFloorCell = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && floor[y][x]

  if (raw.floorPlan !== undefined) {
    const plan = raw.floorPlan as unknown[]
    if (plan.length !== height) fail(`"floorPlan" должно содержать ${height} строк`)
    plan.forEach((row, y) => {
      if (y >= height) return
      if (typeof row !== 'string' || row.length !== width) return fail(`floorPlan[${y}]: строка должна содержать ровно ${width} символов`)
      ;[...row].forEach((ch, x) => {
        if (ch === TILE_FLOOR) floor[y][x] = true
        else if (ch !== TILE_VOID) fail(`floorPlan[${y}]: недопустимый символ "${ch}" (разрешены "." и пробел)`)
      })
    })
  }

  const ids = new Set<string>()
  const checkId = (id: unknown, where: string) => {
    if (!isNonEmptyString(id)) return fail(`${where}: "id" должно быть непустой строкой`)
    if (ids.has(id)) fail(`${where}: повторяющийся id "${id}"`)
    ids.add(id)
  }
  const label = (value: Record<string, unknown>, base: string) => (isNonEmptyString(value.id) ? `${base} "${value.id}"` : base)
  const checkOptionalText = (value: Record<string, unknown>, key: string, where: string) => {
    if (value[key] !== undefined && typeof value[key] !== 'string') fail(`${where}: "${key}" должно быть строкой`)
  }

  /** Стены: ключ ребра → материал. */
  const walls = new Map<string, WallMaterial>()
  const wallEdges = new Map<string, EdgeRef>()
  const addWall = (edge: EdgeRef, material: WallMaterial) => {
    const key = edgeKey(edge.side, edge.x, edge.y)
    walls.set(key, material)
    wallEdges.set(key, edge)
  }

  const rooms: Room[] = []
  const roomOf: (string | null)[][] = Array.from({ length: height }, () => Array<string | null>(width).fill(null))
  list('rooms').forEach((room, i) => {
    if (!isObject(room)) return fail(`rooms[${i}]: должна быть объектом`)
    const where = label(room, `rooms[${i}]`)
    checkId(room.id, where)
    checkOptionalText(room, 'name', where)
    if (![room.x, room.y].every(isInt) || ![room.w, room.h].every((v) => isInt(v) && v >= 1)) {
      return fail(`${where}: "x", "y" — целые, "w", "h" — положительные целые`)
    }
    const { x, y, w, h } = room as unknown as Room
    if (x < 0 || y < 0 || x + w > width || y + h > height) return fail(`${where}: комната ${w}×${h} в клетке (${x}, ${y}) выходит за пределы карты ${width}×${height}`)
    for (let cy = y; cy < y + h; cy++) {
      for (let cx = x; cx < x + w; cx++) {
        const other = roomOf[cy][cx]
        if (other) return fail(`${where}: пересекается с комнатой "${other}" в клетке (${cx}, ${cy})`)
      }
    }
    for (let cy = y; cy < y + h; cy++) {
      for (let cx = x; cx < x + w; cx++) {
        roomOf[cy][cx] = room.id as string
        floor[cy][cx] = true
      }
    }
    // Стены по периметру комнаты. У соседних комнат периметры совпадают — между ними получается стена.
    for (let cx = x; cx < x + w; cx++) {
      addWall({ side: 'h', x: cx, y }, wallMaterial)
      addWall({ side: 'h', x: cx, y: y + h }, wallMaterial)
    }
    for (let cy = y; cy < y + h; cy++) {
      addWall({ side: 'v', x, y: cy }, wallMaterial)
      addWall({ side: 'v', x: x + w, y: cy }, wallMaterial)
    }
    rooms.push({ id: room.id as string, ...(isNonEmptyString(room.name) ? { name: room.name } : {}), x, y, w, h })
  })

  /** Проверяет отрезок по линиям сетки и возвращает его рёбра (или null с записанной ошибкой). */
  const checkSegment = (value: Record<string, unknown>, where: string): EdgeRef[] | null => {
    if (![value.x1, value.y1, value.x2, value.y2].every(isInt)) {
      fail(`${where}: "x1", "y1", "x2", "y2" должны быть целыми числами`)
      return null
    }
    const segment = value as unknown as GridSegment
    const edges = segmentEdges(segment)
    if (!edges) {
      fail(`${where}: отрезок ${describeSegment(segment)} должен идти строго по горизонтали или вертикали и иметь длину`)
      return null
    }
    const inside = [segment.x1, segment.x2].every((v) => v >= 0 && v <= width) && [segment.y1, segment.y2].every((v) => v >= 0 && v <= height)
    if (!inside) {
      fail(`${where}: отрезок ${describeSegment(segment)} выходит за пределы карты (узлы от (0, 0) до (${width}, ${height}))`)
      return null
    }
    return edges
  }

  // Явные стены (перегородки). Совпадая с автоматической стеной комнаты, задают ей материал.
  list('walls').forEach((wall, i) => {
    const where = `walls[${i}]`
    if (!isObject(wall)) return fail(`${where}: должна быть объектом`)
    if (wall.material !== undefined && !isOneOf(WALL_MATERIALS, wall.material)) {
      fail(`${where}: "material" должно быть одним из: ${WALL_MATERIALS.join(', ')}`)
    }
    const edges = checkSegment(wall, where)
    const material = isOneOf(WALL_MATERIALS, wall.material) ? wall.material : wallMaterial
    for (const edge of edges ?? []) addWall(edge, material)
  })

  /** Первое ребро отрезка, на котором нет стены. */
  const missingWall = (edges: EdgeRef[]) => edges.find((e) => !walls.has(edgeKey(e.side, e.x, e.y)))

  // Проёмы убирают стены.
  list('openings').forEach((opening, i) => {
    const where = `openings[${i}]`
    if (!isObject(opening)) return fail(`${where}: должен быть объектом`)
    const edges = checkSegment(opening, where)
    if (!edges) return
    const missing = missingWall(edges)
    if (missing) return fail(`${where}: проём можно сделать только в стене, а на границе ${describeEdge(missing)} стены нет`)
    for (const e of edges) {
      walls.delete(edgeKey(e.side, e.x, e.y))
      wallEdges.delete(edgeKey(e.side, e.x, e.y))
    }
  })

  /** Рёбра, уже занятые дверью или окном: ключ → описание для сообщения. */
  const fittings = new Map<string, string>()
  /** Рёбра дверей — при проверке достижимости двери считаются проходимыми. */
  const doorEdges = new Set<string>()
  const placeOnWall = (value: Record<string, unknown>, where: string, what: 'дверь должна' | 'окно должно'): EdgeRef[] => {
    const edges = checkSegment(value, where)
    if (!edges) return []
    const missing = missingWall(edges)
    if (missing) {
      fail(`${where}: ${what} стоять на стене, а на границе ${describeEdge(missing)} стены нет`)
      return []
    }
    for (const e of edges) {
      const key = edgeKey(e.side, e.x, e.y)
      const other = fittings.get(key)
      const [a, b] = e.side === 'h' ? [{ x: e.x, y: e.y - 1 }, { x: e.x, y: e.y }] : [{ x: e.x - 1, y: e.y }, { x: e.x, y: e.y }]
      const problem = other
        ? `граница ${describeEdge(e)} уже занята: ${other}`
        : !isFloorCell(a.x, a.y) && !isFloorCell(b.x, b.y)
          ? `по обе стороны границы ${describeEdge(e)} нет пола`
          : null
      if (problem) {
        fail(`${where}: ${problem}`)
        return []
      }
    }
    for (const e of edges) fittings.set(edgeKey(e.side, e.x, e.y), where)
    return edges
  }

  const doors = list('doors')
  doors.forEach((door, i) => {
    if (!isObject(door)) return fail(`doors[${i}]: должна быть объектом`)
    const where = label(door, `doors[${i}]`)
    checkId(door.id, where)
    if (!isNonEmptyString(door.name)) fail(`${where}: "name" должно быть непустой строкой`)
    checkOptionalText(door, 'description', where)
    if (!isOneOf(DOOR_STATES, door.state)) fail(`${where}: "state" должно быть одним из: ${DOOR_STATES.join(', ')}`)
    for (const e of placeOnWall(door, where, 'дверь должна')) doorEdges.add(edgeKey(e.side, e.x, e.y))
  })

  const windows = list('windows')
  windows.forEach((win, i) => {
    if (!isObject(win)) return fail(`windows[${i}]: должно быть объектом`)
    const where = label(win, `windows[${i}]`)
    checkId(win.id, where)
    checkOptionalText(win, 'name', where)
    checkOptionalText(win, 'description', where)
    placeOnWall(win, where, 'окно должно')
  })

  if (!floor.some((row) => row.some(Boolean))) fail('на карте нет ни одной клетки пола')

  const checkCell = (value: Record<string, unknown>, where: string): value is Record<string, unknown> & CellPosition => {
    if (!isInt(value.x) || !isInt(value.y)) {
      fail(`${where}: "x" и "y" должны быть целыми числами`)
      return false
    }
    if (value.x < 0 || value.y < 0 || value.x >= width || value.y >= height) {
      fail(`${where}: клетка (${value.x}, ${value.y}) за пределами карты ${width}×${height}`)
      return false
    }
    return true
  }

  // ---------- Объекты ----------
  if (!Array.isArray(raw.objects)) fail('"objects" должно быть массивом')
  const objects = list('objects')
  /** Какой объект занимает клетку: "x,y" → описание объекта для сообщения об ошибке. */
  const occupied = new Map<string, string>()
  objects.forEach((obj, i) => {
    if (!isObject(obj)) return fail(`objects[${i}]: должен быть объектом`)
    const where = label(obj, `objects[${i}]`)
    checkId(obj.id, where)
    if (!isOneOf(OBJECT_TYPES, obj.type)) {
      const hint = obj.type === 'door' ? ' (двери теперь задаются в "doors" — отрезком на стене)' : ''
      fail(`${where}: "type" должно быть одним из: ${OBJECT_TYPES.join(', ')}${hint}`)
    }
    if (!isNonEmptyString(obj.name)) fail(`${where}: "name" должно быть непустой строкой`)
    checkOptionalText(obj, 'description', where)
    let sizeOk = true
    for (const key of ['w', 'h'] as const) {
      if (obj[key] !== undefined && (!isInt(obj[key]) || (obj[key] as number) < 1)) {
        fail(`${where}: "${key}" должно быть положительным целым числом`)
        sizeOk = false
      }
    }
    if (!checkCell(obj, where) || !sizeOk) return
    const w = (obj.w as number | undefined) ?? 1
    const h = (obj.h as number | undefined) ?? 1
    if (obj.x + w > width || obj.y + h > height) {
      return fail(`${where}: объект размером ${w}×${h} в клетке (${obj.x}, ${obj.y}) выходит за пределы карты ${width}×${height}`)
    }

    const cells: CellPosition[] = []
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) cells.push({ x: obj.x + dx, y: obj.y + dy })
    const notFloor = cells.find((c) => !isFloorCell(c.x, c.y))
    if (notFloor) return fail(`${where}: объект должен стоять на полу, а клетка (${notFloor.x}, ${notFloor.y}) — не пол`)
    // Большой объект не может стоять поперёк стены.
    for (const c of cells) {
      for (const n of [{ x: c.x + 1, y: c.y }, { x: c.x, y: c.y + 1 }]) {
        if (n.x >= obj.x + w || n.y >= obj.y + h) continue
        const e = edgeBetween(c, n)
        if (walls.has(edgeKey(e.side, e.x, e.y))) return fail(`${where}: объект пересекает стену на границе ${describeEdge(e)}`)
      }
    }
    for (const c of cells) {
      const other = occupied.get(`${c.x},${c.y}`)
      if (other) return fail(`${where}: клетка (${c.x}, ${c.y}) уже занята объектом ${other}`)
    }
    for (const c of cells) occupied.set(`${c.x},${c.y}`, where)
  })

  // ---------- НПС ----------
  if (!Array.isArray(raw.npcs)) fail('"npcs" должно быть массивом')
  const npcs = list('npcs')
  npcs.forEach((npc, i) => {
    if (!isObject(npc)) return fail(`npcs[${i}]: должен быть объектом`)
    const where = label(npc, `npcs[${i}]`)
    checkId(npc.id, where)
    if (!isNonEmptyString(npc.name)) fail(`${where}: "name" должно быть непустой строкой`)
    checkOptionalText(npc, 'description', where)
    for (const key of NPC_PERSONALITY_FIELDS) {
      checkOptionalText(npc, key, where)
      if (typeof npc[key] === 'string' && (npc[key] as string).length > NPC_PERSONALITY_LIMITS[key]) fail(`${where}: "${key}" — не длиннее ${NPC_PERSONALITY_LIMITS[key]} символов`)
    }
    if (npc.attitude !== undefined && !isOneOf(NPC_ATTITUDES, npc.attitude)) {
      fail(`${where}: "attitude" должно быть одним из: ${NPC_ATTITUDES.join(', ')}`)
    }
    if (checkCell(npc, where) && !isFloorCell(npc.x, npc.y)) fail(`${where}: НПС должен стоять на полу, а клетка (${npc.x}, ${npc.y}) — пустота`)
  })

  // ---------- Вход и достижимость ----------
  let start: CellPosition | null = null
  if (!isObject(raw.playerStart)) {
    fail('"playerStart" должно быть объектом { "x", "y" }')
  } else if (checkCell(raw.playerStart, 'playerStart')) {
    if (isFloorCell(raw.playerStart.x, raw.playerStart.y)) start = { x: raw.playerStart.x, y: raw.playerStart.y }
    else fail('playerStart: игрок должен стоять на полу')
  }

  if (start) {
    // Двери считаем проходимыми в любом состоянии: закрытую открывают, запертую — отпирают или взламывают.
    const passable = (a: CellPosition, b: CellPosition) => {
      if (!isFloorCell(b.x, b.y)) return false
      const e = edgeBetween(a, b)
      const key = edgeKey(e.side, e.x, e.y)
      return !walls.has(key) || doorEdges.has(key)
    }
    const seen = new Set([`${start.x},${start.y}`])
    const queue = [start]
    while (queue.length > 0) {
      const cell = queue.shift() as CellPosition
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = { x: cell.x + dx, y: cell.y + dy }
        const key = `${next.x},${next.y}`
        if (!seen.has(key) && passable(cell, next)) {
          seen.add(key)
          queue.push(next)
        }
      }
    }
    const unreachable: string[] = []
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (floor[y][x] && !seen.has(`${x},${y}`)) unreachable.push(`(${x}, ${y})`)
    if (unreachable.length > 0) {
      const listed = unreachable.slice(0, MAX_LISTED_CELLS).join(', ') + (unreachable.length > MAX_LISTED_CELLS ? ', …' : '')
      fail(`клетки пола недостижимы от входа playerStart (всего ${unreachable.length}): ${listed} — добавьте проём или дверь`)
    }
  }

  if (problems.length > 0) throw new LocationValidationError(problems)

  const wallList: WallEdge[] = [...wallEdges.entries()]
    .map(([key, e]) => ({ ...e, material: walls.get(key) as WallMaterial }))
    .sort((a, b) => a.side.localeCompare(b.side) || a.y - b.y || a.x - b.x)

  const pick = <T extends object>(value: unknown, keys: (keyof T)[]): T => {
    const source = value as Record<string, unknown>
    return Object.fromEntries(keys.filter((k) => source[k as string] !== undefined).map((k) => [k, source[k as string]])) as T
  }

  return {
    id: raw.id as string,
    name: raw.name as string,
    description: raw.description as string,
    cellFeet: raw.cellFeet as number,
    width,
    height,
    floor: raw.floor as LocationData['floor'],
    wallMaterial,
    floorPlan: floor.map((row) => row.map((f) => (f ? TILE_FLOOR : TILE_VOID)).join('')),
    rooms,
    walls: wallList,
    doors: doors.map((d) => pick<Door>(d, ['id', 'name', 'description', 'state', 'x1', 'y1', 'x2', 'y2'])),
    windows: windows.map((w) => pick<MapWindow>(w, ['id', 'name', 'description', 'x1', 'y1', 'x2', 'y2'])),
    objects: objects as MapObject[],
    npcs: npcs as Npc[],
    playerStart: start as CellPosition,
  }
}
