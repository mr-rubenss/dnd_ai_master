// Размещение на карте истории: что занимает клетку, можно ли поставить объект или НПС. Чистые функции —
// ими пользуются инструменты ведущего (понятные отказы) и проверка действий (checkAction).
import { edgeBetween, edgeContent, isFloor } from '../engine/movement'
import type { CellPosition, LocationData, MapObject } from '../types/location'

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
}

/** Кто или что стоит в клетке: «объект «Стол»», «НПС «Гуннар»», «герой Ратибор» или null. */
export function cellOccupant(
  location: LocationData,
  heroes: { name: string; position: CellPosition }[],
  cell: CellPosition,
  ignore: PlacementIgnore = {},
): string | null {
  const npc = location.npcs.find((n) => n.id !== ignore.npcId && n.x === cell.x && n.y === cell.y)
  if (npc) return `НПС «${npc.name}»`
  const hero = heroes.find((h) => h.position.x === cell.x && h.position.y === cell.y)
  if (hero) return `герой ${hero.name}`
  const object = location.objects.find(
    (o) => o.id !== ignore.objectId && !(ignore.creature && o.type === 'chair') && objectCells(o).some((c) => c.x === cell.x && c.y === cell.y),
  )
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
  for (const c of cells) {
    const who = cellOccupant(location, heroes, c, ignore)
    if (who) return `Клетка (${c.x}, ${c.y}) занята: ${who}.`
  }
  return null
}
