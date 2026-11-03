// Типы локации. Формат описан в docs/location-format.md — при изменении типов обновлять документацию.

export const FLOOR_TYPES = ['wood', 'stone', 'dirt', 'grass'] as const
export const WALL_TYPES = ['stone', 'wood'] as const
export const OBJECT_TYPES = ['table', 'chair', 'bar', 'fireplace', 'barrel', 'door'] as const
export const NPC_ATTITUDES = ['friendly', 'neutral', 'hostile'] as const

export type FloorType = (typeof FLOOR_TYPES)[number]
export type WallType = (typeof WALL_TYPES)[number]
export type MapObjectType = (typeof OBJECT_TYPES)[number]
export type NpcAttitude = (typeof NPC_ATTITUDES)[number]

/** Символы плана локации. */
export const TILE_FLOOR = '.'
export const TILE_WALL = '#'
export const TILE_VOID = ' '
export type Tile = typeof TILE_FLOOR | typeof TILE_WALL | typeof TILE_VOID

/** Координаты клетки: x — столбец (0 слева), y — строка (0 сверху). */
export interface CellPosition {
  x: number
  y: number
}

export interface MapObject extends CellPosition {
  id: string
  type: MapObjectType
  name: string
  description?: string
  /** Ширина в клетках (по умолчанию 1). */
  w?: number
  /** Высота в клетках (по умолчанию 1). */
  h?: number
}

export interface Npc extends CellPosition {
  id: string
  name: string
  description?: string
  attitude?: NpcAttitude
}

export interface LocationData {
  id: string
  name: string
  description: string
  /** Размер одной клетки в футах (по правилам — 5). */
  cellFeet: number
  width: number
  height: number
  floor: FloorType
  walls: WallType
  /** План: `height` строк по `width` символов. `.` — пол, `#` — стена, пробел — пустота. */
  tiles: string[]
  objects: MapObject[]
  npcs: Npc[]
  playerStart: CellPosition
}
