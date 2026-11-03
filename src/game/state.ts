// Состояние игры: создание, изменения (редьюсер) и проверка сохранений. Чистые функции.
// Состояние меняется только через gameReducer — ни UI, ни ИИ не правят его напрямую.

import type { CharacterSheet } from '../types/character'
import type { RollResult } from '../engine/dice'
import type { Equipment } from '../types/character'
import type { ChatMessage, GameState, MessageAuthor, RollRecord, StoryProgress } from '../types/game'
import type { ItemCatalog } from '../types/items'
import { DOOR_STATES, type DoorState, type LocationData } from '../types/location'
import { parseCharacterSheet } from './character'
import { equipItem, unequipSlot, type EquipmentSlot } from './equipment'
import { isFloor } from '../engine/movement'
import { isNonEmptyString, isObject, isOneOf, ValidationError } from './validation'

const MESSAGE_AUTHORS: readonly MessageAuthor[] = ['master', 'player', 'system']

export interface NewGameData {
  sheet: CharacterSheet
  location: LocationData
  intro: ChatMessage[]
  story: StoryProgress
}

/** Новая игра из стартовых данных. Данные копируются, чтобы изменения состояния не задевали исходный JSON. */
export function createNewGame({ sheet, location, intro, story }: NewGameData): GameState {
  return structuredClone({
    story,
    character: sheet.character,
    inventory: sheet.inventory,
    location: { id: location.id, player: location.playerStart, doors: initialDoorStates(location) },
    messages: intro,
    rolls: [],
  })
}

/** Начальные состояния дверей локации (из её JSON). */
export function initialDoorStates(location: LocationData): Record<string, DoorState> {
  return Object.fromEntries(location.doors.map((door) => [door.id, door.state]))
}

/** Сколько последних бросков хранить в журнале. */
export const MAX_ROLL_LOG = 100

export type GameAction =
  | { type: 'messageAdded'; message: ChatMessage }
  | { type: 'diceRolled'; roll: RollRecord }
  /** Смена экипировки: новое состояние слотов и что именно изменилось (для ведущего и журнала). */
  | { type: 'equipmentChanged'; equipped: Equipment; change: EquipmentChange }
  /** Игрок переименовал героя (в «Моих героях»). */
  | { type: 'characterRenamed'; name: string }
  | { type: 'gameReset'; state: GameState }

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'messageAdded':
      return { ...state, messages: [...state.messages, action.message] }
    case 'diceRolled':
      return { ...state, rolls: [...state.rolls, action.roll].slice(-MAX_ROLL_LOG) }
    case 'equipmentChanged':
      return { ...state, inventory: { ...state.inventory, equipped: action.equipped } }
    case 'characterRenamed':
      return { ...state, character: { ...state.character, name: action.name } }
    case 'gameReset':
      return action.state
  }
}

/** Создаёт действие «добавить сообщение» с новым id. */
export function messageAdded(author: MessageAuthor, text: string): GameAction {
  return { type: 'messageAdded', message: { id: crypto.randomUUID(), author, text } }
}

/** Создаёт действие «записать бросок в журнал». Сам бросок делает движок (src/engine/dice.ts). */
export function diceRolled(result: RollResult, label?: string): Extract<GameAction, { type: 'diceRolled' }> {
  return { type: 'diceRolled', roll: { id: crypto.randomUUID(), label, timestamp: Date.now(), result } }
}

export type EquipmentChange = { kind: 'equip'; itemId: string; slot: EquipmentSlot } | { kind: 'unequip'; slot: EquipmentSlot }

/**
 * Проверяет смену экипировки по правилам и возвращает действие для хранилища
 * или причину, по которой сменить нельзя. Состояние меняет только редьюсер.
 */
export function changeEquipment(
  state: GameState,
  catalog: ItemCatalog,
  change: EquipmentChange,
): { ok: true; action: GameAction } | { ok: false; reason: string } {
  if (change.kind === 'unequip') {
    return { ok: true, action: { type: 'equipmentChanged', equipped: unequipSlot(state.inventory.equipped, change.slot), change } }
  }
  const result = equipItem(state.inventory, catalog, change.itemId, change.slot)
  if (!result.ok) return result
  return { ok: true, action: { type: 'equipmentChanged', equipped: result.equipped, change } }
}

export interface GameStateContext {
  catalog: ItemCatalog
  locations: Record<string, LocationData>
}

/** Проверяет состояние игры (например, загруженное из localStorage). */
export function parseGameState(raw: unknown, { catalog, locations }: GameStateContext): GameState {
  const title = 'Некорректное состояние игры'
  if (!isObject(raw)) throw new ValidationError(title, ['состояние должно быть объектом'])
  const problems: string[] = []

  try {
    parseCharacterSheet({ character: raw.character, inventory: raw.inventory }, catalog)
  } catch (error) {
    if (error instanceof ValidationError) problems.push(...error.problems)
    else throw error
  }

  const story = raw.story
  if (
    !isObject(story) ||
    !isNonEmptyString(story.id) ||
    !isNonEmptyString(story.storyId) ||
    !isNonEmptyString(story.title) ||
    !isNonEmptyString(story.heroId) ||
    typeof story.startedAt !== 'number'
  ) {
    problems.push('story: ожидается { id, storyId, title, heroId, startedAt }')
  } else if (isObject(raw.character) && story.heroId !== raw.character.id) {
    problems.push('story.heroId: должен совпадать с id персонажа')
  }

  const loc = raw.location
  if (!isObject(loc) || typeof loc.id !== 'string' || !locations[loc.id]) {
    problems.push('location.id: неизвестная локация')
  } else {
    const p = loc.player
    if (!isObject(p) || !Number.isInteger(p.x) || !Number.isInteger(p.y)) {
      problems.push('location.player: ожидаются целые x и y')
    } else if (!isFloor(locations[loc.id], p.x as number, p.y as number)) {
      problems.push('location.player: игрок должен стоять на полу')
    }
    const doors = loc.doors
    const doorIds = new Set(locations[loc.id].doors.map((d) => d.id))
    if (!isObject(doors)) {
      problems.push('location.doors: ожидается объект { id двери: состояние }')
    } else {
      for (const [id, value] of Object.entries(doors)) {
        if (!doorIds.has(id)) problems.push(`location.doors: в локации нет двери "${id}"`)
        else if (!isOneOf(DOOR_STATES, value)) problems.push(`location.doors["${id}"]: состояние должно быть одним из: ${DOOR_STATES.join(', ')}`)
      }
      for (const id of doorIds) if (!(id in doors)) problems.push(`location.doors: нет состояния двери "${id}"`)
    }
  }

  if (!Array.isArray(raw.messages)) {
    problems.push('messages: должно быть массивом')
  } else {
    raw.messages.forEach((m: unknown, i) => {
      if (!isObject(m) || !isNonEmptyString(m.id) || !isOneOf(MESSAGE_AUTHORS, m.author) || typeof m.text !== 'string') {
        problems.push(`messages[${i}]: ожидается { id, author: master|player|system, text }`)
      }
    })
  }

  if (!Array.isArray(raw.rolls)) {
    problems.push('rolls: должно быть массивом')
  } else {
    raw.rolls.forEach((r: unknown, i) => {
      const result = isObject(r) ? r.result : undefined
      if (
        !isObject(r) ||
        !isNonEmptyString(r.id) ||
        typeof r.timestamp !== 'number' ||
        !isObject(result) ||
        typeof result.notation !== 'string' ||
        typeof result.total !== 'number' ||
        !Array.isArray(result.groups)
      ) {
        problems.push(`rolls[${i}]: ожидается { id, timestamp, result: { notation, total, groups } }`)
      }
    })
  }

  if (problems.length > 0) throw new ValidationError(title, problems)
  return raw as unknown as GameState
}
