// Размещение на карте истории: что занимает клетку, можно ли поставить объект или НПС. Чистые функции —
// ими пользуются инструменты ведущего (понятные отказы) и проверка действий (checkAction).
import { edgeBetween, edgeContent, hasLineOfSight, isFloor } from '../engine/movement'
import { FLAT_OBJECT_TYPES, type CellPosition, type LocationData, type MapObject } from '../types/location'

/** Клетки, которые занимает объект (с учётом w × h). */
export function objectCells(o: Pick<MapObject, 'x' | 'y' | 'w' | 'h'>): CellPosition[] {
  const cells: CellPosition[] = []
  for (let dy = 0; dy < (o.h ?? 1); dy++) for (let dx = 0; dx < (o.w ?? 1); dx++) cells.push({ x: o.x + dx, y: o.y + dy })
  return cells
}

export interface PlacementIgnore {
  objectId?: string
  npcId?: string
  /** Ставим существо (НПС): на стул можно сесть — стулья не мешают. */
  creature?: boolean
  /** Плоский объект (ковёр, свеча): клетку не занимает — ложится поверх пола или стола. */
  flat?: boolean
  /** Описание для игрока: скрытый НПС или объект — «что-то», без имени. */
  playerView?: boolean
}

/** Кто или что стоит в клетке: «объект «Стол»», «НПС «Гуннар»», «герой Ратибор» или null. */
export function cellOccupant(
  location: LocationData,
  heroes: { name: string; position: CellPosition }[],
  cell: CellPosition,
  ignore: PlacementIgnore = {},
): string | null {
  const npc = location.npcs.find((n) => n.id !== ignore.npcId && n.x === cell.x && n.y === cell.y)
  if (npc) return npc.hidden && ignore.playerView ? 'что-то (не видно, но мешает)' : `НПС «${npc.name}»`
  const hero = heroes.find((h) => h.position.x === cell.x && h.position.y === cell.y)
  if (hero) return `герой ${hero.name}`
  const object = location.objects.find(
    (o) =>
      o.id !== ignore.objectId &&
      !FLAT_OBJECT_TYPES.includes(o.type) &&
      !(ignore.creature && o.type === 'chair') &&
      objectCells(o).some((c) => c.x === cell.x && c.y === cell.y),
  )
  if (object?.hidden && ignore.playerView) return 'что-то (не видно, но мешает)'
  return object ? `объект «${object.name}»` : null
}

/**
 * Почему нельзя занять область w × h с левым верхним углом (x, y): за пределами карты, не пол, поперёк стены
 * или клетка занята. null — можно.
 */
export function placementProblem(
  location: LocationData,
  heroes: { name: string; position: CellPosition }[],
  area: { x: number; y: number; w?: number; h?: number },
  ignore: PlacementIgnore = {},
): string | null {
  const w = area.w ?? 1
  const h = area.h ?? 1
  if (![area.x, area.y, w, h].every(Number.isInteger) || w < 1 || h < 1) return 'Координаты и размер — целые числа (размер не меньше 1).'
  if (area.x < 0 || area.y < 0 || area.x + w > location.width || area.y + h > location.height)
    return `Клетка (${area.x}, ${area.y})${w * h > 1 ? ` с размером ${w}×${h}` : ''} за пределами карты ${location.width}×${location.height}.`
  const cells = objectCells({ x: area.x, y: area.y, w, h })
  const notFloor = cells.find((c) => !isFloor(location, c.x, c.y))
  if (notFloor) return `Клетка (${notFloor.x}, ${notFloor.y}) — не пол.`
  for (const c of cells) {
    for (const n of [
      { x: c.x + 1, y: c.y },
      { x: c.x, y: c.y + 1 },
    ]) {
      if (n.x >= area.x + w || n.y >= area.y + h) continue
      if (edgeContent(location, edgeBetween(c, n)).kind !== 'none')
        return `Область пересекает стену между клетками (${c.x}, ${c.y}) и (${n.x}, ${n.y}).`
    }
  }
  if (ignore.flat) return null
  for (const c of cells) {
    const who = cellOccupant(location, heroes, c, ignore)
    if (who) return `Клетка (${c.x}, ${c.y}) занята: ${who}.`
  }
  return null
}

/**
 * Ближайшая свободная клетка пола у области (НПС «идёт к столу», новый посетитель «у входа»): сначала вплотную,
 * потом дальше (до `maxRing` клеток), только в прямой видимости от области — не за стеной в соседней комнате.
 * При равном расстоянии — ближе к `from` (где НПС стоит сейчас). `inside` — можно и в саму область (у двери —
 * клетки у порога). null — места рядом нет.
 */
export function freeCellNear(
  location: LocationData,
  heroes: { name: string; position: CellPosition }[],
  area: { x: number; y: number; w: number; h: number },
  ignore: PlacementIgnore = {},
  from?: CellPosition,
  { maxRing = 3, inside: allowInside = false }: { maxRing?: number; inside?: boolean } = {},
): CellPosition | null {
  const inside = (c: CellPosition) => c.x >= area.x && c.x < area.x + area.w && c.y >= area.y && c.y < area.y + area.h
  const areaCells = objectCells(area).filter((c) => isFloor(location, c.x, c.y))
  const anchor = from ?? { x: area.x + (area.w - 1) / 2, y: area.y + (area.h - 1) / 2 }
  for (let ring = allowInside ? 0 : 1; ring <= maxRing; ring++) {
    let best: { cell: CellPosition; d: number } | null = null
    for (let y = area.y - ring; y < area.y + area.h + ring; y++)
      for (let x = area.x - ring; x < area.x + area.w + ring; x++) {
        const cell = { x, y }
        const gap = Math.max(area.x - x, x - (area.x + area.w - 1), area.y - y, y - (area.y + area.h - 1))
        if (Math.max(gap, 0) !== ring || (inside(cell) && !allowInside)) continue
        if (placementProblem(location, heroes, cell, ignore)) continue
        if (areaCells.length && !areaCells.some((c) => hasLineOfSight(location, c, cell))) continue
        const d = Math.hypot(x - anchor.x, y - anchor.y)
        if (!best || d < best.d) best = { cell, d }
      }
    if (best) return best.cell
  }
  return null
}

/** Подсказка к отказу «клетка занята»: «Свободно рядом: (9, 12), (11, 12).» или пустая строка. */
export function freeCellsHint(location: LocationData, heroes: { name: string; position: CellPosition }[], cell: CellPosition, ignore: PlacementIgnore = {}): string {
  const out: CellPosition[] = []
  for (let ring = 1; ring <= 2 && out.length < 3; ring++)
    for (let y = cell.y - ring; y <= cell.y + ring; y++)
      for (let x = cell.x - ring; x <= cell.x + ring; x++) {
        if (out.length >= 3 || Math.max(Math.abs(x - cell.x), Math.abs(y - cell.y)) !== ring) continue
        if (!placementProblem(location, heroes, { x, y }, ignore)) out.push({ x, y })
      }
  return out.length ? ` Свободно рядом: ${out.map((c) => `(${c.x}, ${c.y})`).join(', ')}. Или укажи target — движок сам найдёт место.` : ''
}
