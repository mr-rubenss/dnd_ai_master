// Типы локации. Формат описан в docs/location-format.md — при изменении типов обновлять документацию.
//
// Стены тонкие: они лежат на границах клеток (как в Roll20 и Foundry), а не занимают клетки.
// Клетки бывают только пол или пустота. Двери и окна — отрезки на линии стены.

export const FLOOR_TYPES = ['wood', 'stone', 'dirt', 'grass'] as const
export const WALL_MATERIALS = ['stone', 'wood'] as const
export const OBJECT_TYPES = ['table', 'chair', 'bar', 'fireplace', 'barrel'] as const
export const NPC_ATTITUDES = ['friendly', 'neutral', 'hostile'] as const
export const DOOR_STATES = ['open', 'closed', 'locked'] as const

export type FloorType = (typeof FLOOR_TYPES)[number]
export type WallMaterial = (typeof WALL_MATERIALS)[number]
export type MapObjectType = (typeof OBJECT_TYPES)[number]
export type NpcAttitude = (typeof NPC_ATTITUDES)[number]
/** Дверь: открыта, закрыта, заперта (заперта — тоже закрыта, но открыть можно только ключом/взломом). */
export type DoorState = (typeof DOOR_STATES)[number]

/** Символы плана пола. */
export const TILE_FLOOR = '.'
export const TILE_VOID = ' '
export type Tile = typeof TILE_FLOOR | typeof TILE_VOID

/** Координаты клетки: x — столбец (0 слева), y — строка (0 сверху). */
export interface CellPosition {
  x: number
  y: number
}

/**
 * Отрезок по линиям сетки: от узла (x1, y1) до узла (x2, y2), строго по горизонтали или вертикали.
 * Узлы — углы клеток: узел (x, y) — левый верхний угол клетки (x, y); x от 0 до width, y от 0 до height.
 */
export interface GridSegment {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface WallSegment extends GridSegment {
  /** Материал; по умолчанию — `wallMaterial` локации. */
  material?: WallMaterial
}

export interface Door extends GridSegment {
  id: string
  name: string
  description?: string
  /** Начальное состояние двери. Текущее хранится в состоянии игры. */
  state: DoorState
}

export interface MapWindow extends GridSegment {
  id: string
  name?: string
  description?: string
}

/** Прямоугольная комната упрощённой записи: пол внутри, стены по периметру ставятся автоматически. */
export interface Room {
  id: string
  name?: string
  x: number
  y: number
  w: number
  h: number
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

/** Единичный отрезок стены: `h` — верхняя граница клетки (x, y), `v` — левая граница клетки (x, y). */
export interface WallEdge {
  side: 'h' | 'v'
  x: number
  y: number
  material: WallMaterial
}

/** Локация после проверки: всё в «полной» записи — план пола и единичные стены. */
export interface LocationData {
  id: string
  name: string
  description: string
  /** Размер одной клетки в футах (по правилам — 5). */
  cellFeet: number
  width: number
  height: number
  floor: FloorType
  wallMaterial: WallMaterial
  /** План пола: `height` строк по `width` символов. `.` — пол, пробел — пустота. */
  floorPlan: string[]
  /** Комнаты (если локация задана упрощённо) — для подписей и подсказок ведущему. */
  rooms: Room[]
  /** Все стены — единичными отрезками, включая те, где стоят двери и окна. */
  walls: WallEdge[]
  doors: Door[]
  windows: MapWindow[]
  objects: MapObject[]
  npcs: Npc[]
  playerStart: CellPosition
}
