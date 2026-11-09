// Новая локация от ведущего (инструмент create_location): JSON в формате docs/location-format.md.
// Проверка в два шага: схема zod (типы, перечисления, пределы — понятные ошибки по пути поля), затем parseLocation
// (стены, двери на стенах, объекты на полу и не друг на друге, достижимость) и правила созданной локации: хотя бы один
// выход, НПС не в одной клетке, id не занят. Ошибки возвращаются модели списком — она исправляет и вызывает снова.
// Схема — zod/mini: маленькая сборка, без лишнего веса в браузере. Чистые функции.
import * as z from 'zod/mini'
import {
  AMBIENT_LIGHTS,
  DISTANCE_UNITS,
  DOOR_STATES,
  EFFECT_KINDS,
  EXIT_KINDS,
  FLOOR_TYPES,
  MAP_KINDS,
  NPC_ATTITUDES,
  NPC_PERSONALITY_LIMITS,
  OBJECT_TYPES,
  WALL_MATERIALS,
  ZONE_KINDS,
  type LocationData,
} from '../types/location'
import type { StoryState } from '../types/story'
import { LocationValidationError, parseLocation } from './location'

/** Пределы созданной локации: карта не огромная, обстановки и людей — в меру (всё это идёт ведущему в запрос). */
export const CREATED_LOCATION_LIMITS = { size: 60, rooms: 30, segments: 80, objects: 120, npcs: 20, exits: 10, text: 400 } as const
/** Короткий пример верной минимальной локации — идёт модели вместе с ошибками (есть выход, объекты внутри карты). */
export const MIN_LOCATION_EXAMPLE = JSON.stringify({
  id: 'village-street',
  name: 'Деревенская улица',
  description: 'Пыльная улица между домами.',
  cellFeet: 5,
  width: 10,
  height: 8,
  floor: 'dirt',
  wallMaterial: 'stone',
  rooms: [{ id: 'street', x: 0, y: 0, w: 10, h: 8 }],
  objects: [{ id: 'well', type: 'rock', name: 'Колодец', x: 4, y: 3 }],
  npcs: [],
  exits: [{ id: 'back', kind: 'edge', name: 'Назад', x: 0, y: 4, to: 'id-места-откуда-пришли' }],
  playerStart: { x: 1, y: 4 },
})

/** Сколько ошибок возвращать модели за раз. */
export const MAX_REPORTED_PROBLEMS = 12

const L = CREATED_LOCATION_LIMITS
const text = (max: number = L.text) => z.string().check(z.minLength(1), z.maxLength(max))
const optText = (max: number = L.text) => z.optional(z.string().check(z.maxLength(max)))
const coord = () => z.int().check(z.minimum(0), z.maximum(L.size))
const size = () => z.int().check(z.minimum(1), z.maximum(L.size))
const segment = { x1: coord(), y1: coord(), x2: coord(), y2: coord() }
const cell = { x: coord(), y: coord() }
const rect = { ...cell, w: size(), h: size() }

/** Схема JSON локации от ведущего (форма; смысл — стены, пол, достижимость — проверяет parseLocation). */
export const CREATED_LOCATION_SCHEMA = z.object({
  id: z.string().check(z.regex(/^[a-z0-9]+(-[a-z0-9]+)*$/), z.maxLength(60)),
  name: text(80),
  description: text(),
  cellFeet: z.optional(z.int().check(z.minimum(1))),
  scale: z.optional(z.object({ kind: z.enum(MAP_KINDS), cell: z.number().check(z.positive()), unit: z.enum(DISTANCE_UNITS) })),
  ambientLight: z.optional(z.enum(AMBIENT_LIGHTS)),
  width: size(),
  height: size(),
  floor: z.enum(FLOOR_TYPES),
  wallMaterial: z.enum(WALL_MATERIALS),
  rooms: z.optional(z.array(z.object({ id: text(60), name: optText(80), floor: z.optional(z.enum(FLOOR_TYPES)), ...rect })).check(z.maxLength(L.rooms))),
  floorPlan: z.optional(z.array(z.string()).check(z.maxLength(L.size))),
  walls: z.optional(z.array(z.object({ ...segment, material: z.optional(z.enum(WALL_MATERIALS)) })).check(z.maxLength(L.segments))),
  openings: z.optional(z.array(z.object(segment)).check(z.maxLength(L.segments))),
  doors: z.optional(z.array(z.object({ id: text(60), name: text(80), description: optText(), state: z.enum(DOOR_STATES), ...segment })).check(z.maxLength(L.segments))),
  windows: z.optional(z.array(z.object({ id: text(60), name: optText(80), description: optText(), ...segment })).check(z.maxLength(L.segments))),
  objects: z
    .array(
      z.object({
        id: text(60),
        type: z.enum(OBJECT_TYPES),
        name: text(80),
        description: optText(),
        ...cell,
        w: z.optional(size()),
        h: z.optional(size()),
        hidden: z.optional(z.boolean()),
        light: z.optional(z.object({ bright: z.int().check(z.minimum(0)), dim: z.int().check(z.minimum(0)) })),
      }),
    )
    .check(z.maxLength(L.objects)),
  npcs: z
    .array(
      z.object({
        id: text(60),
        name: text(60),
        description: optText(),
        attitude: z.optional(z.enum(NPC_ATTITUDES)),
        ...cell,
        hidden: z.optional(z.boolean()),
        backstory: optText(NPC_PERSONALITY_LIMITS.backstory),
        goal: optText(NPC_PERSONALITY_LIMITS.goal),
        fear: optText(NPC_PERSONALITY_LIMITS.fear),
        speech: optText(NPC_PERSONALITY_LIMITS.speech),
        activity: optText(NPC_PERSONALITY_LIMITS.activity),
      }),
    )
    .check(z.maxLength(L.npcs)),
  effects: z.optional(z.array(z.object({ id: text(60), kind: z.enum(EFFECT_KINDS), name: optText(80), ...rect }))),
  zones: z.optional(z.array(z.object({ id: text(60), kind: z.enum(ZONE_KINDS), name: text(80), description: optText(), ...rect }))),
  exits: z
    .array(
      z.object({
        id: text(60),
        kind: z.enum(EXIT_KINDS),
        name: text(80),
        description: optText(),
        door: z.optional(text(60)),
        to: z.optional(text(60)),
        toExit: z.optional(text(60)),
        ...cell,
      }),
    )
    .check(z.minLength(1), z.maxLength(L.exits)),
  playerStart: z.object(cell),
})

const TYPE_NAMES: Record<string, string> = {
  string: 'строка',
  number: 'число',
  int: 'целое число',
  boolean: 'true или false',
  object: 'объект',
  array: 'массив',
}

/** Путь поля для сообщения: objects[3].x. */
function pathText(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, key) => (typeof key === 'number' ? `${acc}[${key}]` : acc ? `${acc}.${String(key)}` : String(key)), '') || 'локация'
}

/** Значение во входе по пути ошибки (zod/mini само значение в ошибку не кладёт). */
function valueAt(input: unknown, path: readonly PropertyKey[]): unknown {
  let v = input
  for (const key of path) v = v && typeof v === 'object' ? (v as Record<PropertyKey, unknown>)[key] : undefined
  return v
}

/** Ошибка схемы по-русски. */
function issueText(issue: z.core.$ZodIssue, input: unknown): string {
  const where = pathText(issue.path)
  switch (issue.code) {
    case 'invalid_type':
      return valueAt(input, issue.path) === undefined ? `${where}: нет обязательного поля` : `${where}: ожидается ${TYPE_NAMES[issue.expected] ?? issue.expected}`
    case 'invalid_value':
      return `${where}: одно из ${issue.values.map((v) => String(v)).join(', ')}`
    case 'too_small':
      return issue.origin === 'array'
        ? `${where}: нужно хотя бы ${issue.minimum} ${where === 'exits' ? '(у локации должен быть хотя бы один выход)' : 'элемент(а)'}`
        : issue.origin === 'string'
          ? `${where}: пустая строка`
          : `${where}: не меньше ${issue.minimum}`
    case 'too_big':
      return issue.origin === 'array' ? `${where}: не больше ${issue.maximum} элементов` : issue.origin === 'string' ? `${where}: не длиннее ${issue.maximum} символов` : `${where}: не больше ${issue.maximum}`
    case 'invalid_format':
      return where === 'id' ? 'id: латиница в нижнем регистре, цифры и дефисы (kebab-case)' : `${where}: неверный формат`
    default:
      return `${where}: неверное значение`
  }
}

/** Ошибки схемы (пусто — форма верная). */
export function schemaProblems(input: unknown): string[] {
  const result = CREATED_LOCATION_SCHEMA.safeParse(input)
  return result.success ? [] : result.error.issues.map((issue) => issueText(issue, input))
}

/** Правила созданной локации поверх parseLocation: выходы, НПС не в одной клетке. */
function createdRuleProblems(location: LocationData): string[] {
  const problems: string[] = []
  if (!location.exits?.length) problems.push('exits: у локации должен быть хотя бы один выход (дверь, дорога, лестница или край карты)')
  const npcCells = new Map<string, string>()
  for (const npc of location.npcs) {
    const key = `${npc.x},${npc.y}`
    const other = npcCells.get(key)
    if (other) problems.push(`npcs "${npc.id}": клетка (${npc.x}, ${npc.y}) уже занята НПС "${other}"`)
    npcCells.set(key, npc.id)
  }
  const exitCells = new Map<string, string>()
  for (const exit of location.exits ?? []) {
    const other = exitCells.get(`${exit.x},${exit.y}`)
    if (other) problems.push(`exits "${exit.id}": в клетке (${exit.x}, ${exit.y}) уже выход "${other}"`)
    exitCells.set(`${exit.x},${exit.y}`, exit.id)
  }
  return problems
}

const limited = (problems: string[]) =>
  problems.length > MAX_REPORTED_PROBLEMS ? [...problems.slice(0, MAX_REPORTED_PROBLEMS), `…и ещё ${problems.length - MAX_REPORTED_PROBLEMS}`] : problems

/** JSON модели → проверенная локация или список ошибок. */
export function parseCreatedLocation(input: unknown): { ok: true; location: LocationData } | { ok: false; problems: string[] } {
  const shape = schemaProblems(input)
  if (shape.length) return { ok: false, problems: limited(shape) }
  let location: LocationData
  try {
    location = parseLocation(input)
  } catch (error) {
    if (error instanceof LocationValidationError) return { ok: false, problems: limited(error.problems) }
    throw error
  }
  const rules = createdRuleProblems(location)
  return rules.length ? { ok: false, problems: limited(rules) } : { ok: true, location }
}

/**
 * Проверенная локация обратно в запись формата (план пола и единичные стены, без комнат: их стены уже в списке),
 * чтобы проверить её тем же parseLocation — так проверяется действие locationCreated, пришедшее откуда угодно.
 */
export function locationInputOf(location: LocationData): Record<string, unknown> {
  const { rooms: _rooms, walls, ...rest } = location
  return {
    ...rest,
    walls: walls.map((e) => ({ x1: e.x, y1: e.y, x2: e.side === 'h' ? e.x + 1 : e.x, y2: e.side === 'v' ? e.y + 1 : e.y, material: e.material })),
  }
}

/** Проверка действия locationCreated: id свободен, локация верна по формату и правилам созданной локации. */
export function createdLocationProblem(state: Pick<StoryState, 'world'>, location: LocationData): string | null {
  if (!location || typeof location !== 'object' || typeof location.id !== 'string') return 'Нет локации.'
  if (state.world.locations[location.id]) return `Локация «${location.id}» уже есть в мире этой истории — у новой нужен другой id.`
  let parsed: LocationData
  try {
    parsed = parseLocation(locationInputOf(location))
  } catch (error) {
    if (error instanceof LocationValidationError) return `Локация не проходит проверку: ${limited(error.problems).join('; ')}.`
    throw error
  }
  const rooms = location.rooms ?? []
  const roomOut = rooms.find((r) => !Number.isInteger(r.x + r.y + r.w + r.h) || r.x < 0 || r.y < 0 || r.w < 1 || r.h < 1 || r.x + r.w > parsed.width || r.y + r.h > parsed.height)
  if (roomOut) return `Комната «${roomOut.id}» выходит за пределы карты.`
  const rules = createdRuleProblems(parsed)
  return rules.length ? `Локация не проходит проверку: ${rules.join('; ')}.` : null
}
