// Три масштаба карт, вложенные друг в друга (6.2): общая (регион, мили) → частичная (окрестности, район) →
// клеточная (5 фт., здания, подземелья, бой). У карты — масштаб `scale`, карта уровнем выше `parent` и места `places`,
// открывающие карты уровнем ниже. Чистые функции: путь над картой, где отряд на уровнях выше, смена уровня отряда
// (инструмент ведущего set_map_view → действие движка mapLevelChanged), связь места с картой (placeLinked),
// проверки и тексты для ведущего. Отрисовка общая для всех масштабов — src/components/LocationMap.tsx.
import { MAP_KIND_RANK, PLACE_KIND_NAMES, type CellPosition, type LocationData, type MapKind, type MapPlace } from '../types/location'
import type { StoryEvent, StoryState } from '../types/story'
import { MAP_PROFILES, scaleLabel, scaleOf } from './mapView'
import { arrivalCells, trailOf } from './travel'
import { cellOccupant } from './mapPlacement'
import { isFloor } from '../engine/movement'

type Locations = Record<string, LocationData>

export const kindOf = (location: Pick<LocationData, 'scale' | 'cellFeet'>): MapKind => scaleOf(location).kind
const rankOf = (location: Pick<LocationData, 'scale' | 'cellFeet'>) => MAP_KIND_RANK[kindOf(location)]

/** Название масштаба для игрока и ведущего: «общая карта», «частичная карта», «клеточная карта». */
export const kindLabel = (kind: MapKind) => MAP_PROFILES[kind].label.toLowerCase()

/** Карты уровнем выше — от самой верхней до родителя (без самой карты). Цикл в данных обрывается. */
export function ancestorsOf(locations: Locations, id: string): LocationData[] {
  const chain: LocationData[] = []
  const seen = new Set([id])
  let parent = locations[id]?.parent
  while (parent && locations[parent] && !seen.has(parent)) {
    seen.add(parent)
    chain.unshift(locations[parent])
    parent = locations[parent].parent
  }
  return chain
}

export const isAncestor = (locations: Locations, ancestorId: string, id: string) => ancestorsOf(locations, id).some((l) => l.id === ancestorId)

/** Место карты `on`, ведущее в карту `childId`. */
export const placeFor = (on: LocationData, childId: string): MapPlace | undefined => (on.places ?? []).find((p) => p.map === childId)

/**
 * Где отряд на карте `viewId`, если он на карте `currentId`: место этой карты, которое ведёт в текущую карту или в одну
 * из карт над ней (на общей карте отряд в таверне — у места «Деревня»). null — карта не над отрядом или место не отмечено.
 */
export function partyPlaceOn(locations: Locations, viewId: string, currentId: string): MapPlace | null {
  const view = locations[viewId]
  if (!view || viewId === currentId) return null
  const chain = [...ancestorsOf(locations, currentId), locations[currentId]].filter(Boolean)
  const index = chain.findIndex((l) => l.id === viewId)
  if (index < 0) return null
  const below = chain[index + 1]
  if (!below) return null
  // Своего места у карты может не быть (улица у таверны) — тогда место соседней карты, куда ведут её выходы.
  return placeFor(view, below.id) ?? (below.exits ?? []).map((e) => (e.to ? placeFor(view, e.to) : undefined)).find(Boolean) ?? null
}

/** Следующая карта вниз от `viewId` к карте отряда (кнопка «Приблизить», когда смотрят на карту над отрядом). */
export function zoomInTarget(locations: Locations, viewId: string, currentId: string): string | null {
  if (viewId === currentId) return null
  const chain = [...ancestorsOf(locations, currentId), locations[currentId]].filter(Boolean)
  const index = chain.findIndex((l) => l.id === viewId)
  return index >= 0 ? chain[index + 1].id : null
}

/** Пункт пути над картой: уровень (можно перейти) или карта того же уровня из пути отряда. */
export interface MapPathItem {
  id: string
  name: string
  /** level — карта уровнем выше (нажать — посмотреть её), trail — пройденная карта того же уровня. */
  kind: 'level' | 'trail'
  /** Карта, которая сейчас на экране. */
  current: boolean
}

/**
 * Путь над картой: карты уровнем выше («Королевство → Лес Шепчущих Дубов»), затем на карте отряда — пройденные карты
 * того же уровня («Таверна › Улица у таверны»; путь отряда `world.trail` с 6.6, без повторного показа уровней).
 */
export function mapPath(state: Pick<StoryState, 'world'>, viewId: string): MapPathItem[] {
  const { locations, currentLocationId } = state.world
  const view = locations[viewId] ?? locations[currentLocationId]
  const levels = ancestorsOf(locations, view.id).map((l): MapPathItem => ({ id: l.id, name: l.name, kind: 'level', current: false }))
  if (view.id !== currentLocationId) return [...levels, { id: view.id, name: view.name, kind: 'level', current: true }]
  // Хвост пути отряда — подряд идущие карты с тем же уровнем выше, что у текущей.
  const trail = trailOf(state)
  let start = trail.length - 1
  while (start > 0 && locations[trail[start - 1]] && locations[trail[start - 1]].parent === view.parent && kindOf(locations[trail[start - 1]]) === kindOf(view)) start--
  const tail = trail.slice(start).map((id, i, all): MapPathItem => ({ id, name: locations[id]?.name ?? id, kind: 'trail', current: i === all.length - 1 }))
  return [...levels, ...tail]
}

/** Ошибки связей новой карты с картами мира: карта уровнем выше и места уровнем ниже. */
export function hierarchyProblems(locations: Locations, location: LocationData): string[] {
  const problems: string[] = []
  if (location.parent) {
    const parent = locations[location.parent]
    if (!parent) problems.push(`parent: карты [${location.parent}] нет в мире истории (сначала создай её или не указывай parent)`)
    else if (rankOf(parent) >= rankOf(location))
      problems.push(`parent: «${parent.name}» — ${kindLabel(kindOf(parent))}; карта уровнем выше должна быть крупнее (общая → частичная → клеточная)`)
  }
  for (const place of location.places ?? []) {
    if (!place.map) continue
    const child = locations[place.map]
    if (!child) problems.push(`places "${place.id}": карты [${place.map}] нет в мире истории — не указывай map, её создадут позже`)
    else if (rankOf(child) <= rankOf(location)) problems.push(`places "${place.id}": «${child.name}» — ${kindLabel(kindOf(child))}; место открывает карту уровнем ниже`)
    else if (child.parent && child.parent !== location.id) problems.push(`places "${place.id}": у «${child.name}» уже есть карта уровнем выше [${child.parent}]`)
  }
  return problems
}

/** Проверка placeLinked: место на карте есть и ещё никуда не ведёт, карта ниже — мельче и без другого родителя. */
export function placeLinkedProblem(state: Pick<StoryState, 'world'>, e: Extract<StoryEvent, { type: 'placeLinked' }>): string | null {
  const on = state.world.locations[e.locationId]
  if (!on) return 'В мире этой истории нет такой локации.'
  const place = (on.places ?? []).find((p) => p.id === e.placeId)
  if (!place) return `На карте «${on.name}» нет места [${e.placeId}].`
  const child = state.world.locations[e.map]
  if (!child) return `Карты [${e.map}] нет в мире истории.`
  if (place.map && place.map !== e.map) return `Место «${place.name}» уже открывает карту [${place.map}].`
  if (rankOf(child) <= rankOf(on)) return `«${child.name}» — ${kindLabel(kindOf(child))}: место «${place.name}» открывает карту уровнем ниже.`
  if (child.parent && child.parent !== on.id) return `У «${child.name}» уже есть карта уровнем выше [${child.parent}].`
  if (isAncestor(state.world.locations, child.id, on.id)) return 'Карта не может лежать внутри самой себя.'
  return null
}

export interface LevelPlan {
  events: StoryEvent[]
  from: LocationData
  to: LocationData
  /** Клетка ведущего героя на новой карте. */
  at: CellPosition
  /** Место новой карты, у которого встал отряд (при подъёме на уровень выше). */
  place?: MapPlace
}

/**
 * Смена уровня отряда (set_map_view): на карту выше (отряд встаёт у места, ведущего вниз, к прежней карте) или на карту
 * ниже (у её входа playerStart). В бою карта закреплена. Причина отказа строкой.
 */
export function levelPlan(state: StoryState, targetId: string, reason: string): LevelPlan | string {
  const { locations, currentLocationId } = state.world
  const from = locations[currentLocationId]
  const to = locations[targetId]
  if (!to)
    return (
      `Карты [${targetId}] нет. Создай её create_location со scale (region — общая, area — частичная, tactical — клеточная) и parent ` +
      `(или place — место текущей карты, которое она открывает), затем вызови set_map_view.`
    )
  if (to.id === from.id) return `Отряд и так на карте «${from.name}».`
  if (state.combat) return 'Идёт бой: карта закреплена на клеточной. Сначала закончи бой (set_combat end).'
  const up = isAncestor(locations, to.id, from.id)
  const down = isAncestor(locations, from.id, to.id)
  if (!up && !down) {
    const sameKind = kindOf(to) === kindOf(from)
    return sameKind
      ? `«${to.name}» — карта того же масштаба: туда ведёт выход (travel), а не смена масштаба.`
      : `«${to.name}» не лежит ни над «${from.name}», ни внутри неё. Сначала подними отряд на общую для них карту (set_map_view), потом спустись.`
  }
  const place = up ? (partyPlaceOn(locations, to.id, from.id) ?? undefined) : undefined
  const start = place ?? to.playerStart
  const heroes = state.party.filter((m) => !m.fallen)
  const cells = arrivalCells(to, state.world.doors[to.id] ?? {}, { x: start.x, y: start.y }, heroes.length)
  if (!cells) return `На карте «${to.name}» нет свободного места для отряда.`
  const positions = Object.fromEntries(heroes.map((m, i) => [m.heroId, cells[i]]))
  return {
    events: [{ type: 'mapLevelChanged', from: from.id, to: to.id, reason, positions }],
    from,
    to,
    at: cells[0],
    ...(place ? { place } : {}),
  }
}

/** Проверка mapLevelChanged: из текущей карты на карту выше или ниже по иерархии, не в бою, герои на свободном полу. */
export function levelChangedProblem(state: StoryState, e: Extract<StoryEvent, { type: 'mapLevelChanged' }>): string | null {
  const { locations } = state.world
  if (e.from !== state.world.currentLocationId) return 'Отряд меняет масштаб только с текущей карты.'
  const to = locations[e.to]
  if (!to) return 'В мире этой истории нет такой локации.'
  if (to.id === e.from) return 'Отряд и так на этой карте.'
  if (state.combat) return 'Идёт бой: карта закреплена на клеточной.'
  if (!isAncestor(locations, to.id, e.from) && !isAncestor(locations, e.from, to.id)) return 'Масштаб меняется только на карту выше или ниже по вложенности.'
  if (typeof e.reason !== 'string' || !e.reason.trim() || e.reason.length > 200) return 'Нужна причина смены масштаба (до 200 символов).'
  const taken: CellPosition[] = []
  for (const m of state.party.filter((h) => !h.fallen)) {
    const p = e.positions?.[m.heroId]
    if (!p || !Number.isInteger(p.x) || !Number.isInteger(p.y) || !isFloor(to, p.x, p.y)) return `Герою ${m.character.name} нужна клетка на новой карте.`
    const who = cellOccupant(to, [], p, { creature: true })
    if (who) return `Клетка (${p.x}, ${p.y}) на новой карте занята: ${who}.`
    if (taken.some((t) => t.x === p.x && t.y === p.y)) return 'Два героя не могут встать в одну клетку.'
    taken.push(p)
  }
  return null
}

/** Ответ ведущему после set_map_view. */
export function levelNote(plan: LevelPlan, lead: string): string {
  const where = plan.place ? `у места «${plan.place.name}»` : 'у входа'
  return (
    `Отряд теперь на карте «${plan.to.name}» [${plan.to.id}] — ${kindLabel(kindOf(plan.to))} (${scaleLabel(plan.to)}). ` +
    `${lead} — ${where}, клетка (${plan.at.x}, ${plan.at.y}). Опиши, что видно на этом масштабе.`
  )
}

const placeText = (place: MapPlace, locations: Locations) =>
  `«${place.name}» [${place.id}]${place.kind ? ` (${PLACE_KIND_NAMES[place.kind]})` : ''} (${place.x}, ${place.y}) → ` +
  (place.map && locations[place.map] ? `карта [${place.map}]` : 'карты нет')

/** Раздел «Масштаб карты» в состоянии игры: где отряд на каждом уровне и места текущей карты. */
export function levelText(state: Pick<StoryState, 'world' | 'combat'>): string {
  const { locations, currentLocationId } = state.world
  const current = locations[currentLocationId]
  const lines = [`Отряд на карте «${current.name}» [${current.id}] — ${kindLabel(kindOf(current))} (${scaleLabel(current)}).`]
  const chain = ancestorsOf(locations, current.id)
  if (chain.length) {
    const above = [...chain].reverse().map((map) => {
      const place = partyPlaceOn(locations, map.id, current.id)
      return `«${map.name}» [${map.id}] (${kindLabel(kindOf(map))}) — ${place ? `отряд у места «${place.name}» (${place.x}, ${place.y})` : 'место отряда не отмечено'}`
    })
    lines.push(`Выше: ${above.join('; ')}.`)
  } else lines.push('Карты уровнем выше нет.')
  const places = current.places ?? []
  if (places.length) lines.push(`Места на этой карте: ${places.map((p) => placeText(p, locations)).join('; ')}.`)
  if (state.combat) lines.push('Идёт бой: карта закреплена на клеточной.')
  return lines.join('\n')
}

/** Начало заметки «подробнее о месте» — по нему видно, что игрок ждёт карту места. */
export const PLACE_DETAIL_MARK = 'хочет рассмотреть подробнее'

/** Заметка ведущему: игрок хочет подробнее рассмотреть место, а карты уровнем ниже нет. */
export function placeDetailNote(on: LocationData, place: MapPlace, lead: string): string {
  const child: MapKind = kindOf(on) === 'region' ? 'area' : 'tactical'
  return (
    `${lead} ${PLACE_DETAIL_MARK} место «${place.name}» [${place.id}] на карте «${on.name}» (${kindLabel(kindOf(on))}). Карты уровнем ниже нет. ` +
    `Если место стоит подробной карты — создай её create_location (scale.kind: ${child}, parent: "${on.id}", place: "${place.id}"); ` +
    `отряд туда не переходит, пока ты не вызовешь set_map_view. Опиши, что о месте известно.`
  )
}

/** Заметка ведущему: игрок хочет отдалить карту, а карты уровнем выше нет. */
export function zoomOutNote(current: LocationData, lead: string): string {
  return (
    `${lead} хочет взглянуть на окрестности шире, но карты уровнем выше «${current.name}» нет. Если она уместна — создай её ` +
    `create_location (scale.kind: ${kindOf(current) === 'tactical' ? 'area' : 'region'}) с местом, ведущим сюда (places: [{…, map: "${current.id}"}]); ` +
    `отряд остаётся на месте. Коротко опиши окрестности.`
  )
}
