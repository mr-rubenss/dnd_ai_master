// Общая отрисовка карт трёх масштабов (клеточная, частичная, общая) — чистые расчёты без React: профиль вида
// карты (сетка, свет, размер фишек), области пола по типам, источники света, подпись масштаба, путь фишки по клеткам
// и математика масштабирования и сдвига. Компоненты — src/components/LocationMap.tsx и соседние файлы карты.
import { isFloor, type DoorStates } from '../engine/movement'
import { findPath } from '../engine/pathfinding'
import {
  DEFAULT_LIGHTS,
  type AmbientLight,
  type CellPosition,
  type FloorType,
  type LocationData,
  type MapKind,
  type MapObject,
  type MapScale,
} from '../types/location'

/** Как рисуется карта каждого масштаба. */
export interface MapProfile {
  label: string
  /** Рисовать сетку клеток. */
  grid: boolean
  /** Свет и тьма (источники света, тёмные углы). */
  lighting: boolean
  /** Радиус фишки в клетках. */
  tokenRadius: number
  /** Подписи под фишками. */
  labels: boolean
}

export const MAP_PROFILES: Record<MapKind, MapProfile> = {
  tactical: { label: 'Клеточная карта', grid: true, lighting: true, tokenRadius: 0.4, labels: true },
  area: { label: 'Частичная карта', grid: false, lighting: true, tokenRadius: 0.45, labels: true },
  region: { label: 'Общая карта', grid: false, lighting: false, tokenRadius: 0.48, labels: true },
}

/** Масштаб карты (у старых историй поля нет — клеточная, cellFeet футов). */
export const scaleOf = (location: Pick<LocationData, 'scale' | 'cellFeet'>): MapScale =>
  location.scale ?? { kind: 'tactical', cell: location.cellFeet, unit: 'ft' }

export const profileOf = (location: Pick<LocationData, 'scale' | 'cellFeet'>) => MAP_PROFILES[scaleOf(location).kind]

const UNIT_LABELS = { ft: 'фт.', mi: 'мили' } as const
/** «1 клетка = 5 фт.», «1 клетка = 6 миль». */
export function scaleLabel(location: Pick<LocationData, 'scale' | 'cellFeet'>): string {
  const s = scaleOf(location)
  const unit = s.unit === 'mi' ? (s.cell % 10 === 1 && s.cell % 100 !== 11 ? 'миля' : 'миль') : UNIT_LABELS.ft
  return `1 клетка = ${s.cell} ${unit}`
}

/** Пол каждой клетки: пол комнаты, если задан, иначе пол карты; null — пустота. */
export function floorTypeAt(location: LocationData, x: number, y: number): FloorType | null {
  if (!isFloor(location, x, y)) return null
  const room = location.rooms.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)
  return room?.floor ?? location.floor
}

/**
 * Области пола по типам — по одному контуру (path) на тип: так узор рисуется одной фигурой, а не сотнями клеток
 * (быстро и на телефоне). Соседние клетки строки склеиваются в полосы.
 */
export function floorAreas(location: LocationData): { floor: FloorType; d: string; cells: number }[] {
  const areas = new Map<FloorType, { d: string; cells: number }>()
  for (let y = 0; y < location.height; y++) {
    let x = 0
    while (x < location.width) {
      const type = floorTypeAt(location, x, y)
      if (!type) {
        x++
        continue
      }
      let end = x + 1
      while (end < location.width && floorTypeAt(location, end, y) === type) end++
      const area = areas.get(type) ?? { d: '', cells: 0 }
      area.d += `M${x} ${y}h${end - x}v1h${x - end}z`
      area.cells += end - x
      areas.set(type, area)
      x = end
    }
  }
  return [...areas.entries()].map(([floor, a]) => ({ floor, ...a }))
}

/** Источник света в клетках: центр, яркий и полный радиус. */
export interface MapLight {
  id: string
  x: number
  y: number
  bright: number
  radius: number
}

/** Источники света карты: объекты со светом (камин, факел, свеча, огонь) или с заданным `light`. */
export function lightSources(location: LocationData): MapLight[] {
  const feet = scaleOf(location).unit === 'ft' ? location.cellFeet : Infinity
  return location.objects.flatMap((o: MapObject) => {
    // Скрытый объект не выдаёт себя светом.
    if (o.hidden) return []
    const light = o.light ?? DEFAULT_LIGHTS[o.type]
    if (!light || light.bright + light.dim <= 0 || !Number.isFinite(feet)) return []
    const w = o.w ?? 1
    const h = o.h ?? 1
    return [{ id: o.id, x: o.x + w / 2, y: o.y + h / 2, bright: light.bright / feet, radius: (light.bright + light.dim) / feet }]
  })
}

/** Общий свет: задан в данных или по виду карты — в помещении со светильниками полумрак, без них и снаружи светло. */
export function ambientOf(location: LocationData): AmbientLight {
  if (location.ambientLight) return location.ambientLight
  if (!profileOf(location).lighting) return 'bright'
  return lightSources(location).length > 0 ? 'dim' : 'bright'
}

/** Насколько темно вдали от света (непрозрачность тени). */
export const DARKNESS_OPACITY: Record<AmbientLight, number> = { bright: 0, dim: 0.5, dark: 0.82 }

// ---------- Путь фишки ----------

/** Самый длинный путь, который анимируется по клеткам; дальше фишка переходит сразу. */
export const MAX_WALK_STEPS = 24

/**
 * Кратчайший путь по клеткам (A*, с диагоналями) с учётом стен и закрытых дверей — для анимации перемещения фишки.
 * Без начальной клетки; null — пути нет. `blocked` — занятые клетки (для героя — НПС и мебель).
 */
export function walkPath(
  location: LocationData,
  from: CellPosition,
  to: CellPosition,
  doors: DoorStates = {},
  blocked?: (cell: CellPosition) => boolean,
): CellPosition[] | null {
  return findPath(location, from, to, { doors, blocked })
}

// ---------- Масштаб и сдвиг ----------

/** Вид: масштаб относительно «вся карта в окне» (1) и сдвиг в пикселях окна. */
export interface MapViewport {
  scale: number
  x: number
  y: number
}

export const MIN_ZOOM = 1
export const MAX_ZOOM = 5
export const FIT_VIEW: MapViewport = { scale: 1, x: 0, y: 0 }

/** Сдвиг не уводит карту из окна: при масштабе 1 — на месте, при большем — края не отрываются. */
export function clampView(view: MapViewport, width: number, height: number): MapViewport {
  const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.scale))
  const clamp = (v: number, size: number) => Math.min(0, Math.max(size - size * scale, v))
  return { scale, x: clamp(view.x, width), y: clamp(view.y, height) }
}

/** Масштаб с неподвижной точкой (px, py) — под курсором или между пальцами. */
export function zoomAt(view: MapViewport, nextScale: number, px: number, py: number, width: number, height: number): MapViewport {
  const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextScale))
  const k = scale / view.scale
  return clampView({ scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k }, width, height)
}

/** «К герою»: клетка (cx, cy) в центре окна; масштаб — не меньше `minScale`. */
export function centerOn(view: MapViewport, cx: number, cy: number, cols: number, rows: number, width: number, height: number, minScale = 2): MapViewport {
  const scale = Math.max(view.scale, minScale)
  return clampView({ scale, x: width / 2 - (cx / cols) * width * scale, y: height / 2 - (cy / rows) * height * scale }, width, height)
}
