// Загрузка и валидация локаций из JSON. Чистые функции — без React и без обращений к API.
// Нужна, чтобы проверять как готовые файлы, так и локации, сгенерированные ИИ.

import {
  FLOOR_TYPES,
  NPC_ATTITUDES,
  OBJECT_TYPES,
  TILE_FLOOR,
  TILE_VOID,
  TILE_WALL,
  WALL_TYPES,
  type CellPosition,
  type LocationData,
  type MapObject,
  type Npc,
  type Tile,
} from '../types/location'

export class LocationValidationError extends Error {
  readonly problems: string[]

  constructor(problems: string[]) {
    super(`Некорректная локация:\n- ${problems.join('\n- ')}`)
    this.name = 'LocationValidationError'
    this.problems = problems
  }
}

const VALID_TILES = new Set<string>([TILE_FLOOR, TILE_WALL, TILE_VOID])

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isInt = (value: unknown): value is number => Number.isInteger(value)
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''
const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value)

/** Клетка плана по координатам; за пределами карты — пустота. */
export function tileAt(location: LocationData, x: number, y: number): Tile {
  return (location.tiles[y]?.[x] ?? TILE_VOID) as Tile
}

/** Проверяет произвольные данные (например, распарсенный JSON) и возвращает типизированную локацию. */
export function parseLocation(raw: unknown): LocationData {
  const problems: string[] = []
  const fail = (message: string) => problems.push(message)

  if (!isObject(raw)) throw new LocationValidationError(['локация должна быть объектом'])

  for (const key of ['id', 'name', 'description'] as const) {
    if (!isNonEmptyString(raw[key])) fail(`поле "${key}" должно быть непустой строкой`)
  }
  if (!isInt(raw.cellFeet) || raw.cellFeet <= 0) fail('"cellFeet" должно быть положительным целым числом')
  if (!isInt(raw.width) || raw.width < 1 || raw.width > 100) fail('"width" должно быть целым от 1 до 100')
  if (!isInt(raw.height) || raw.height < 1 || raw.height > 100) fail('"height" должно быть целым от 1 до 100')
  if (!isOneOf(FLOOR_TYPES, raw.floor)) fail(`"floor" должно быть одним из: ${FLOOR_TYPES.join(', ')}`)
  if (!isOneOf(WALL_TYPES, raw.walls)) fail(`"walls" должно быть одним из: ${WALL_TYPES.join(', ')}`)

  // Без корректных размеров и плана дальнейшие проверки координат бессмысленны.
  if (problems.length > 0) throw new LocationValidationError(problems)
  const width = raw.width as number
  const height = raw.height as number

  if (!Array.isArray(raw.tiles) || raw.tiles.length !== height) {
    throw new LocationValidationError([`"tiles" должно быть массивом из ${height} строк`])
  }
  raw.tiles.forEach((row, y) => {
    if (typeof row !== 'string' || row.length !== width) {
      fail(`tiles[${y}]: строка должна содержать ровно ${width} символов`)
      return
    }
    const bad = [...row].find((ch) => !VALID_TILES.has(ch))
    if (bad !== undefined) fail(`tiles[${y}]: недопустимый символ "${bad}" (разрешены ".", "#", пробел)`)
  })
  if (problems.length > 0) throw new LocationValidationError(problems)
  const tiles = raw.tiles as string[]
  const tile = (x: number, y: number) => tiles[y][x]

  const ids = new Set<string>()
  const checkId = (id: unknown, where: string) => {
    if (!isNonEmptyString(id)) return fail(`${where}: "id" должно быть непустой строкой`)
    if (ids.has(id)) fail(`${where}: повторяющийся id "${id}"`)
    ids.add(id)
  }
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

  // Объекты
  if (!Array.isArray(raw.objects)) fail('"objects" должно быть массивом')
  const objects = (Array.isArray(raw.objects) ? raw.objects : []) as unknown[]
  objects.forEach((obj, i) => {
    const where = `objects[${i}]`
    if (!isObject(obj)) return fail(`${where}: должен быть объектом`)
    checkId(obj.id, where)
    if (!isOneOf(OBJECT_TYPES, obj.type)) fail(`${where}: "type" должно быть одним из: ${OBJECT_TYPES.join(', ')}`)
    if (!isNonEmptyString(obj.name)) fail(`${where}: "name" должно быть непустой строкой`)
    if (obj.description !== undefined && typeof obj.description !== 'string') fail(`${where}: "description" должно быть строкой`)
    for (const key of ['w', 'h'] as const) {
      if (obj[key] !== undefined && (!isInt(obj[key]) || (obj[key] as number) < 1)) {
        fail(`${where}: "${key}" должно быть положительным целым числом`)
      }
    }
    if (!checkCell(obj, where)) return
    const w = (obj.w as number | undefined) ?? 1
    const h = (obj.h as number | undefined) ?? 1
    if (obj.x + w > width || obj.y + h > height) fail(`${where}: объект выходит за пределы карты`)
    if (obj.type === 'door') {
      if (tile(obj.x, obj.y) !== TILE_WALL) fail(`${where}: дверь должна стоять на клетке стены "#"`)
    } else {
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          if (tile(obj.x + dx, obj.y + dy) !== TILE_FLOOR) {
            fail(`${where}: объект должен стоять на полу "." (клетка ${obj.x + dx}, ${obj.y + dy})`)
            return
          }
        }
      }
    }
  })

  // НПС
  if (!Array.isArray(raw.npcs)) fail('"npcs" должно быть массивом')
  const npcs = (Array.isArray(raw.npcs) ? raw.npcs : []) as unknown[]
  npcs.forEach((npc, i) => {
    const where = `npcs[${i}]`
    if (!isObject(npc)) return fail(`${where}: должен быть объектом`)
    checkId(npc.id, where)
    if (!isNonEmptyString(npc.name)) fail(`${where}: "name" должно быть непустой строкой`)
    if (npc.description !== undefined && typeof npc.description !== 'string') fail(`${where}: "description" должно быть строкой`)
    if (npc.attitude !== undefined && !isOneOf(NPC_ATTITUDES, npc.attitude)) {
      fail(`${where}: "attitude" должно быть одним из: ${NPC_ATTITUDES.join(', ')}`)
    }
    if (checkCell(npc, where) && tile(npc.x, npc.y) !== TILE_FLOOR) fail(`${where}: НПС должен стоять на полу "."`)
  })

  // Стартовая позиция игрока
  if (!isObject(raw.playerStart)) {
    fail('"playerStart" должно быть объектом { "x", "y" }')
  } else if (checkCell(raw.playerStart, 'playerStart') && tile(raw.playerStart.x, raw.playerStart.y) !== TILE_FLOOR) {
    fail('playerStart: игрок должен стоять на полу "."')
  }

  if (problems.length > 0) throw new LocationValidationError(problems)

  return {
    id: raw.id as string,
    name: raw.name as string,
    description: raw.description as string,
    cellFeet: raw.cellFeet as number,
    width,
    height,
    floor: raw.floor as LocationData['floor'],
    walls: raw.walls as LocationData['walls'],
    tiles,
    objects: objects as MapObject[],
    npcs: npcs as Npc[],
    playerStart: raw.playerStart as unknown as CellPosition,
  }
}
