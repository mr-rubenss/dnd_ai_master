// Типы локации. Формат описан в docs/location-format.md — при изменении типов обновлять документацию.
//
// Стены тонкие: они лежат на границах клеток (как в Roll20 и Foundry), а не занимают клетки.
// Клетки бывают только пол или пустота. Двери и окна — отрезки на линии стены.

/** Пол: доски, камень, плитка, земля, трава — у карты целиком и (необязательно) у каждой комнаты. */
export const FLOOR_TYPES = ['wood', 'stone', 'tile', 'dirt', 'grass'] as const
export const WALL_MATERIALS = ['stone', 'wood'] as const
/**
 * Объекты обстановки; fire — огонь, debris — обломки и завал, item — прочий предмет; torch и candle — источники
 * света; rug и candle — «плоские»: лежат поверх пола или стола и клетку не занимают; tree, rock, building — для карт
 * местности (частичной и общей).
 */
export const OBJECT_TYPES = [
  'table', 'chair', 'bar', 'fireplace', 'barrel', 'fire', 'debris', 'item',
  'bed', 'chest', 'shelf', 'rug', 'torch', 'candle', 'tree', 'rock', 'building',
] as const
/** Объекты, которые не занимают клетку (на ковре стоят столы, свеча — на столе). */
export const FLAT_OBJECT_TYPES: readonly MapObjectType[] = ['rug', 'candle']

/**
 * Масштаб карты: клеточная (бой и помещения, клетка 5 футов), частичная (окрестности, квартал — клетка в десятки
 * футов) и общая (регион — клетка в милях). Отрисовка одна; от вида зависят сетка, свет, размер фишек и какие
 * объекты допустимы.
 */
export const MAP_KINDS = ['tactical', 'area', 'region'] as const
export type MapKind = (typeof MAP_KINDS)[number]
export const DISTANCE_UNITS = ['ft', 'mi'] as const
export type DistanceUnit = (typeof DISTANCE_UNITS)[number]

/** Какие объекты бывают на картах каждого масштаба. */
export const MAP_KIND_OBJECTS: Record<MapKind, readonly MapObjectType[]> = {
  tactical: OBJECT_TYPES,
  area: ['tree', 'rock', 'building', 'fire', 'debris', 'item', 'barrel', 'chest', 'torch', 'table', 'chair'],
  region: ['tree', 'rock', 'building'],
}

export interface MapScale {
  kind: MapKind
  /** Сколько единиц в одной клетке. */
  cell: number
  unit: DistanceUnit
}

/** Общий свет на карте без учёта источников: ярко (день, открыто), полумрак (помещение), тьма (подвал, ночь). */
export const AMBIENT_LIGHTS = ['bright', 'dim', 'dark'] as const
export type AmbientLight = (typeof AMBIENT_LIGHTS)[number]

/** Свет источника в футах (SRD 5.2.1): яркий радиус и ещё столько же тусклого. */
export interface LightRadius {
  bright: number
  dim: number
}

/** Свет по умолчанию: факел — 20/20 футов (SRD), свеча — 5/5 (SRD), камин — 15/15, огонь на полу — 10/10. */
export const DEFAULT_LIGHTS: Partial<Record<MapObjectType, LightRadius>> = {
  torch: { bright: 20, dim: 20 },
  candle: { bright: 5, dim: 5 },
  fireplace: { bright: 15, dim: 15 },
  fire: { bright: 10, dim: 10 },
}
export const NPC_ATTITUDES = ['friendly', 'neutral', 'hostile'] as const
/**
 * Скрытые зоны — знает только ведущий, игроку на карте не видны: ловушка, засада, опасное место (скрипучие половицы,
 * гнилой пол), тайник. Если путь героя проходит через зону — ведущий сразу получает событие и реагирует.
 */
export const ZONE_KINDS = ['trap', 'ambush', 'hazard', 'secret'] as const
export type ZoneKind = (typeof ZONE_KINDS)[number]
export const ZONE_KIND_NAMES: Record<ZoneKind, string> = { trap: 'ловушка', ambush: 'засада', hazard: 'опасное место', secret: 'тайник' }

/** Скрытая зона — прямоугольник клеток. */
export interface MapZone {
  id: string
  kind: ZoneKind
  name: string
  /** Что там на самом деле (заметка ведущего). */
  description?: string
  x: number
  y: number
  w: number
  h: number
}
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
  /** Пол комнаты, если отличается от пола карты (кладовая с камнем в деревянной таверне). */
  floor?: FloorType
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
  /** Свет, если объект светит иначе, чем обычно для своего типа (`DEFAULT_LIGHTS`), в футах; 0/0 — погашен. */
  light?: LightRadius
}

export interface Npc extends CellPosition, NpcPersonality {
  id: string
  name: string
  description?: string
  attitude?: NpcAttitude
}

/**
 * Личность НПС — заметки ведущего, коротко (поля необязательны; у старых НПС их нет). В запрос ведущему идут только
 * у НПС текущей локации. Игроку на карте виден лишь `activity` (чем занят) — остальное он узнаёт из разговоров.
 */
export interface NpcPersonality {
  /** Предыстория: 2–3 предложения — откуда, что пережил, почему здесь. */
  backstory?: string
  /** Чего хочет прямо сейчас. */
  goal?: string
  /** Страх или слабость. */
  fear?: string
  /** Манера речи: 2–3 черты — словечки, темп, как обращается к героям. */
  speech?: string
  /** Чем занят прямо сейчас. */
  activity?: string
}

/** Поля личности НПС и предельная длина каждого (чтобы не раздувать запрос). */
export const NPC_PERSONALITY_LIMITS: Record<keyof NpcPersonality, number> = {
  backstory: 400,
  goal: 160,
  fear: 160,
  speech: 200,
  activity: 160,
}
export const NPC_PERSONALITY_FIELDS = Object.keys(NPC_PERSONALITY_LIMITS) as (keyof NpcPersonality)[]

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
  /** Размер одной клетки в футах (по правилам — 5); у общей карты — мили, переведённые в футы. */
  cellFeet: number
  /** Масштаб: вид карты, размер клетки и единицы. Нет поля (старые истории) — клеточная, `cellFeet` футов. */
  scale?: MapScale
  /** Общий свет без источников. Нет поля — по виду карты и источникам (`ambientOf` в src/game/mapView.ts). */
  ambientLight?: AmbientLight
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
  /** Скрытые зоны (ловушки, засады) — только для ведущего. Нет поля — зон нет. */
  zones?: MapZone[]
  playerStart: CellPosition
}
