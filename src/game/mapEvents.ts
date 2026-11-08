// Действия на карте → события для ведущего. Каждое перемещение героя (heroMoved) описывается понятным смыслом:
// куда подошёл, в какой комнате, что рядом (объекты и НПС с расстоянием), кто из НПС его видит (линия видимости),
// есть ли укрытие. Мелкие перемещения подряд склеиваются (StoryState.pendingMoves) и уходят ведущему вместе со
// следующей репликой игрока; значимые (правила — src/data/map-reactions.json) вызывают короткую реакцию ведущего
// сразу — не чаще одной за `cooldownSeconds`. Чистые функции; UI — App.tsx (GameScreen).
import { hasLineOfSight } from '../engine/movement'
import { findPath, pathFeet } from '../engine/pathfinding'
import { ZONE_KIND_NAMES, type CellPosition, type LocationData, type MapObjectType, type MapZone, type Npc } from '../types/location'
import type { PartyMember, PendingMove, StoryState } from '../types/story'
import { heroBlocker } from './heroMove'
import reactionsJson from '../data/map-reactions.json'
import { isInt, isObject, ValidationError } from './validation'

// ---------- Конфиг значимости ----------

/** Правила значимости перемещения: что вызывает реакцию ведущего сразу, без реплики игрока. */
export const MOVE_RULE_IDS = ['entered-room', 'adjacent-npc', 'hidden-zone', 'hid-from-sight'] as const
export type MoveRuleId = (typeof MOVE_RULE_IDS)[number]

export interface MapReactionConfig {
  /** Не чаще одной автоматической реакции ведущего за столько секунд. */
  cooldownSeconds: number
  /** «Рядом» — не дальше стольких футов. */
  nearbyFeet: number
  /** Сколько ближайших объектов и НПС перечислять. */
  nearbyLimit: number
  /** Какие объекты дают укрытие. */
  coverObjects: MapObjectType[]
  rules: { id: MoveRuleId; enabled: boolean; title: string }[]
}

export function parseMapReactions(input: unknown): MapReactionConfig {
  const problems: string[] = []
  if (!isObject(input)) throw new ValidationError('Настройки реакций карты', ['должны быть объектом'])
  for (const key of ['cooldownSeconds', 'nearbyFeet', 'nearbyLimit'] as const)
    if (!isInt(input[key]) || (input[key] as number) < 0) problems.push(`"${key}" — целое не меньше 0`)
  if (!Array.isArray(input.coverObjects) || input.coverObjects.some((t) => typeof t !== 'string')) problems.push('"coverObjects" — список типов объектов')
  const rules = Array.isArray(input.rules) ? input.rules : []
  if (!Array.isArray(input.rules)) problems.push('"rules" — список правил')
  const seen = new Set<string>()
  rules.forEach((r, i) => {
    if (!isObject(r) || !MOVE_RULE_IDS.includes(r.id as MoveRuleId)) return problems.push(`rules[${i}]: "id" — одно из ${MOVE_RULE_IDS.join(', ')}`)
    if (seen.has(r.id as string)) problems.push(`rules[${i}]: правило «${String(r.id)}» повторяется`)
    seen.add(r.id as string)
    if (typeof r.enabled !== 'boolean') problems.push(`rules[${i}]: "enabled" — true или false`)
    if (typeof r.title !== 'string' || !r.title.trim()) problems.push(`rules[${i}]: "title" — непустая строка`)
  })
  if (problems.length) throw new ValidationError('Настройки реакций карты', problems)
  return input as unknown as MapReactionConfig
}

/** Настройки из src/data/map-reactions.json (проверяются при загрузке). */
export const MAP_REACTIONS: MapReactionConfig = parseMapReactions(reactionsJson)

const ruleOn = (config: MapReactionConfig, id: MoveRuleId) => config.rules.some((r) => r.id === id && r.enabled)

/** Пора ли автоматической реакции ведущего: прошло не меньше `cooldownSeconds` с прошлой. */
export const reactionDue = (lastAt: number | null, now: number, config: Pick<MapReactionConfig, 'cooldownSeconds'>) =>
  lastAt === null || now - lastAt >= config.cooldownSeconds * 1000

// ---------- Геометрия ----------

/** Расстояние в клетках (диагональ — как шаг, правила 2024) до прямоугольника. */
function cellsTo(from: CellPosition, area: { x: number; y: number; w?: number; h?: number }): number {
  const dx = Math.max(area.x - from.x, 0, from.x - (area.x + (area.w ?? 1) - 1))
  const dy = Math.max(area.y - from.y, 0, from.y - (area.y + (area.h ?? 1) - 1))
  return Math.max(dx, dy)
}

const inRect = (c: CellPosition, r: { x: number; y: number; w?: number; h?: number }) =>
  c.x >= r.x && c.x < r.x + (r.w ?? 1) && c.y >= r.y && c.y < r.y + (r.h ?? 1)

/** Комната, в которой клетка (id и название), или null. */
export function roomAt(location: LocationData, cell: CellPosition) {
  return location.rooms.find((r) => inRect(cell, r)) ?? null
}

/** Скрытые зоны, через которые проходит путь (без начальной клетки — герой уже стоял там). */
export function zonesOnPath(location: LocationData, path: readonly CellPosition[]): MapZone[] {
  return (location.zones ?? []).filter((z) => path.some((c) => inRect(c, z)))
}

const doorsOf = (story: Pick<StoryState, 'world'>, location: LocationData) => story.world.doors[location.id] ?? {}

/** Видит ли НПС клетку (линия видимости: стены и закрытые двери перекрывают, окна и открытые — нет). */
export const npcSees = (location: LocationData, story: Pick<StoryState, 'world'>, npc: Npc, cell: CellPosition) =>
  hasLineOfSight(location, npc, cell, doorsOf(story, location))

// ---------- Где герой и что вокруг ----------

export interface HeroSurroundings {
  heroId: string
  name: string
  cell: CellPosition
  room: string | null
  /** Ближайшие объекты и НПС: название и расстояние в футах (0 — в той же клетке, стул под героем). */
  nearby: { name: string; kind: 'npc' | 'object'; feet: number }[]
  /** НПС вплотную (соседняя клетка). */
  adjacent: string[]
  /** Кто из НПС его видит и кто нет. */
  seenBy: string[]
  unseenBy: string[]
  /** Укрытие рядом: объект и от чьего взгляда закрывает (пусто — просто рядом). */
  cover: { name: string; from: string[] }[]
}

export function heroSurroundings(story: StoryState, location: LocationData, member: PartyMember, config: MapReactionConfig): HeroSurroundings {
  const at = member.position
  const feet = location.cellFeet
  const nearby = [
    ...location.npcs.map((n) => ({ name: n.name, kind: 'npc' as const, cells: cellsTo(at, n) })),
    ...location.objects.map((o) => ({ name: o.name, kind: 'object' as const, cells: cellsTo(at, o) })),
  ]
    .filter((e) => e.cells * feet <= config.nearbyFeet)
    .sort((a, b) => a.cells - b.cells || (a.kind === 'npc' ? -1 : 1))
  // Одинаковые предметы («Стул») — один раз, ближайший.
  const seenNames = new Set<string>()
  const list = nearby.filter((e) => (seenNames.has(e.name) ? false : (seenNames.add(e.name), true))).slice(0, config.nearbyLimit)
  const seenBy = location.npcs.filter((n) => npcSees(location, story, n, at))
  const cover = location.objects
    .filter((o) => config.coverObjects.includes(o.type) && cellsTo(at, o) === 1)
    .map((o) => {
      // Укрытие закрывает от НПС, если стоит между ними: в сторону НПС от героя.
      const cx = Math.min(Math.max(at.x, o.x), o.x + (o.w ?? 1) - 1) - at.x
      const cy = Math.min(Math.max(at.y, o.y), o.y + (o.h ?? 1) - 1) - at.y
      const from = seenBy.filter((n) => cx * (n.x - at.x) + cy * (n.y - at.y) > 0 && cellsTo(at, n) > 1).map((n) => n.name)
      return { name: o.name, from }
    })
  return {
    heroId: member.heroId,
    name: member.character.name,
    cell: at,
    room: roomAt(location, at)?.name ?? null,
    nearby: list.map((e) => ({ name: e.name, kind: e.kind, feet: e.cells * feet })),
    adjacent: location.npcs.filter((n) => cellsTo(at, n) === 1).map((n) => n.name),
    seenBy: seenBy.map((n) => n.name),
    unseenBy: location.npcs.filter((n) => !seenBy.includes(n)).map((n) => n.name),
    cover,
  }
}

const distance = (feet: number) => (feet === 0 ? 'здесь же' : `${feet} фт.`)

/** Строка для ведущего: «Ратибор — «Общий зал», клетка (10, 13); рядом: …; его видят: …; не видят: …; укрытие: …». */
export function surroundingsText(s: HeroSurroundings): string {
  return [
    `${s.name} — ${s.room ? `«${s.room}», ` : ''}клетка (${s.cell.x}, ${s.cell.y})`,
    s.nearby.length ? `рядом: ${s.nearby.map((e) => `${e.name} (${distance(e.feet)})`).join(', ')}` : 'рядом никого и ничего',
    s.adjacent.length ? `вплотную: ${s.adjacent.join(', ')}` : '',
    s.seenBy.length ? `его видят: ${s.seenBy.join(', ')}` : '',
    s.unseenBy.length ? `не видят (стены, закрытые двери): ${s.unseenBy.join(', ')}` : '',
    s.cover.length
      ? `укрытие рядом: ${s.cover.map((c) => (c.from.length ? `${c.name} (между ним и ${c.from.join(', ')})` : c.name)).join(', ')}`
      : 'укрытия рядом нет',
  ]
    .filter(Boolean)
    .join('; ')
}

/** Раздел состояния игры «Где герои»: позиция и обстановка каждого героя текущей локации. */
export function positionsText(story: StoryState, location: LocationData, config: MapReactionConfig): string {
  const lines = story.party.filter((m) => !m.fallen).map((m) => `- ${surroundingsText(heroSurroundings(story, location, m, config))}.`)
  return lines.length ? `## Где герои (карта; учитывай в описаниях)\n${lines.join('\n')}` : ''
}

// ---------- Перемещения: склейка и значимость ----------

/** Путь героя в клетку `to` из текущего положения (как у движка), без начальной клетки. */
function pathOf(story: StoryState, location: LocationData, member: PartyMember, to: CellPosition): CellPosition[] {
  const blocker = heroBlocker(location, story, member.heroId)
  return findPath(location, member.position, to, { doors: doorsOf(story, location), blocked: (c) => blocker(c) !== null }) ?? [to]
}

/**
 * Склеить перемещение с накопленными (применение heroMoved, до смены положения): начало — первое, конец — последнее,
 * футы суммируются, комнаты и скрытые зоны по пути — без повторов.
 */
export function mergeMove(story: StoryState, location: LocationData, heroId: string, to: CellPosition): PendingMove | null {
  const member = story.party.find((m) => m.heroId === heroId)
  if (!member) return null
  const path = pathOf(story, location, member, to)
  const prev = story.pendingMoves?.[heroId]
  const rooms = [...(prev?.rooms ?? [])]
  for (const c of path) {
    const room = roomAt(location, c)
    if (room && !rooms.includes(room.id)) rooms.push(room.id)
  }
  const zones = [...(prev?.zones ?? [])]
  for (const z of zonesOnPath(location, path)) if (!zones.includes(z.id)) zones.push(z.id)
  return {
    heroId,
    locationId: location.id,
    from: prev?.locationId === location.id ? prev.from : member.position,
    to: { x: to.x, y: to.y },
    feet: (prev?.locationId === location.id ? prev.feet : 0) + pathFeet(path, location.cellFeet),
    moves: (prev?.locationId === location.id ? prev.moves : 0) + 1,
    rooms,
    zones,
  }
}

/** Почему перемещение значимо (по включённым правилам): для ведущего (с тайным) и для игрока (без скрытых зон). */
export interface MoveSignificance {
  rules: MoveRuleId[]
  /** Для ведущего — всё, в том числе скрытые зоны. */
  master: string[]
  /** Для игрока в ленте — без того, чего герой не знает. */
  player: string[]
}

/** Значимо ли одно перемещение: сравнение состояния до и после heroMoved. */
export function moveSignificance(before: StoryState, after: StoryState, heroId: string, location: LocationData, config: MapReactionConfig): MoveSignificance {
  const result: MoveSignificance = { rules: [], master: [], player: [] }
  const was = before.party.find((m) => m.heroId === heroId)
  const now = after.party.find((m) => m.heroId === heroId)
  if (!was || !now || (was.position.x === now.position.x && was.position.y === now.position.y)) return result
  const add = (rule: MoveRuleId, master: string, player: string | null = master) => {
    if (!ruleOn(config, rule)) return
    if (!result.rules.includes(rule)) result.rules.push(rule)
    result.master.push(master)
    if (player) result.player.push(player)
  }
  const fromRoom = roomAt(location, was.position)
  const toRoom = roomAt(location, now.position)
  if (toRoom && toRoom.id !== fromRoom?.id) add('entered-room', `вошёл в «${toRoom.name ?? toRoom.id}»`)
  const near = (cell: CellPosition, n: Npc) => cellsTo(cell, n) === 1
  for (const n of location.npcs) if (near(now.position, n) && !near(was.position, n)) add('adjacent-npc', `подошёл вплотную к ${n.name}`)
  const path = pathOf(before, location, was, now.position)
  for (const z of zonesOnPath(location, path))
    add('hidden-zone', `прошёл через скрытую зону «${z.name}» (${ZONE_KIND_NAMES[z.kind]}${z.description ? `: ${z.description}` : ''})`, null)
  for (const n of location.npcs)
    if (npcSees(location, before, n, was.position) && !npcSees(location, after, n, now.position)) add('hid-from-sight', `скрылся от взгляда ${n.name}`)
  return result
}

/** Описание накопленного перемещения для ведущего: откуда, куда, сколько футов, через что, и обстановка сейчас. */
export function pendingMoveText(story: StoryState, location: LocationData, heroId: string, config: MapReactionConfig): string | null {
  const move = story.pendingMoves?.[heroId]
  const member = story.party.find((m) => m.heroId === heroId)
  if (!move || !member || move.locationId !== location.id) return null
  const roomName = (id: string) => location.rooms.find((r) => r.id === id)?.name ?? id
  const from = roomAt(location, move.from)
  const zones = (location.zones ?? []).filter((z) => move.zones.includes(z.id))
  const passed = move.rooms.filter((id) => id !== from?.id && id !== roomAt(location, move.to)?.id)
  return [
    `${member.character.name} прошёл ${move.feet} фт.${move.moves > 1 ? ` (${move.moves} перемещения подряд)` : ''} из клетки (${move.from.x}, ${move.from.y})${from ? ` («${from.name ?? from.id}»)` : ''}`,
    passed.length ? `через ${passed.map((id) => `«${roomName(id)}»`).join(', ')}` : '',
    zones.length ? `по пути — скрытые зоны: ${zones.map((z) => `«${z.name}» (${ZONE_KIND_NAMES[z.kind]})`).join(', ')}` : '',
    `Сейчас: ${surroundingsText(heroSurroundings(story, location, member, config))}.`,
  ]
    .filter(Boolean)
    .join('; ')
    .replace('; Сейчас', '. Сейчас')
}

/** Событие «значимое перемещение» для ленты и ведущего (движок): текст для игрока и заметка для ведущего. */
export function moveReportEvent(story: StoryState, location: LocationData, heroId: string, significance: MoveSignificance, config: MapReactionConfig, messageId: string) {
  const name = story.party.find((m) => m.heroId === heroId)?.character.name ?? 'Герой'
  const visible = significance.player.length ? significance.player : ['перешёл на новое место']
  return {
    type: 'heroMoveReported' as const,
    messageId,
    heroId,
    rules: significance.rules,
    text: `${name}: ${visible.join(', ')}.`,
    note: `Значимо: ${significance.master.join('; ')}. ${pendingMoveText(story, location, heroId, config) ?? ''}`.trim(),
  }
}
