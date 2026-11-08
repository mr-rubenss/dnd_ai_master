// Области воздействия на карте локации: расчёт движка (src/engine/areas.ts) с полом, стенами, окнами и дверями
// в текущем состоянии, и кто из героев и НПС задет. Общая часть для шаблонов игрока на карте, инструмента ведущего
// show_area, а дальше — боя и заклинаний. Чистые функции.
import { areaCells, areaLabel, occupantsInArea, type AreaTemplate, type CellRect } from '../engine/areas'
import { isFloor, segmentBlocked, type DoorStates } from '../engine/movement'
import type { CellPosition, LocationData } from '../types/location'
import type { PartyMember } from '../types/story'

/** Клетки пола, задетые областью: прямые от точки начала перекрывают стены, окна и закрытые двери (полное укрытие). */
export function mapAreaCells(location: LocationData, template: AreaTemplate, doors: DoorStates = {}): CellPosition[] {
  return areaCells(template, {
    width: location.width,
    height: location.height,
    cellFeet: location.cellFeet,
    blocked: (a, b) => segmentBlocked(location, a, b, doors, 'solid'),
    cellAllowed: (x, y) => isFloor(location, x, y),
  })
}

/** Существо на карте для списка задетых. */
export interface AreaCreature {
  kind: 'hero' | 'npc'
  id: string
  name: string
  space: CellRect
  /** Скрытый НПС: игрок его не видит (ведущему — с пометкой). */
  hidden?: boolean
}

/** Существа локации: живые герои отряда и НПС. */
export function mapCreatures(location: LocationData, party: readonly PartyMember[]): AreaCreature[] {
  return [
    ...party.filter((m) => !m.fallen).map((m) => ({ kind: 'hero' as const, id: m.heroId, name: m.character.name, space: { x: m.position.x, y: m.position.y, w: 1, h: 1 } })),
    ...location.npcs.map((n) => ({ kind: 'npc' as const, id: n.id, name: n.name, space: { x: n.x, y: n.y, w: 1, h: 1 }, ...(n.hidden ? { hidden: true } : {}) })),
  ]
}

export interface MapAreaResult {
  cells: CellPosition[]
  creatures: AreaCreature[]
}

/** Клетки и задетые существа. */
export function mapAreaResult(location: LocationData, party: readonly PartyMember[], template: AreaTemplate, doors: DoorStates = {}): MapAreaResult {
  const cells = mapAreaCells(location, template, doors)
  return { cells, creatures: occupantsInArea(cells, mapCreatures(location, party)) }
}

/** Строка для ведущего: «Сфера 20 фт.: 45 клеток. Задеты: Ратибор, Шнырь (скрыт от игрока).» */
export function areaResultText(template: AreaTemplate, result: MapAreaResult): string {
  const who = result.creatures.map((c) => (c.hidden ? `${c.name} (скрыт от игрока)` : c.name))
  return `${areaLabel(template)}: ${result.cells.length} кл. ${who.length ? `Задеты: ${who.join(', ')}.` : 'Никого не задевает.'}`
}
