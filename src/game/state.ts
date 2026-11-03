// Состояние игры: создание, изменения (редьюсер) и проверка сохранений. Чистые функции.
// Состояние меняется только через gameReducer — ни UI, ни ИИ не правят его напрямую.

import type { CharacterSheet } from '../types/character'
import type { RollResult } from '../engine/dice'
import type { ChatMessage, GameState, MessageAuthor, RollRecord } from '../types/game'
import type { ItemCatalog } from '../types/items'
import type { LocationData } from '../types/location'
import { parseCharacterSheet } from './character'
import { tileAt } from './location'
import { isNonEmptyString, isObject, isOneOf, ValidationError } from './validation'

const MESSAGE_AUTHORS: readonly MessageAuthor[] = ['master', 'player', 'system']

export interface NewGameData {
  sheet: CharacterSheet
  location: LocationData
  intro: ChatMessage[]
}

/** Новая игра из стартовых данных. Данные копируются, чтобы изменения состояния не задевали исходный JSON. */
export function createNewGame({ sheet, location, intro }: NewGameData): GameState {
  return structuredClone({
    character: sheet.character,
    inventory: sheet.inventory,
    location: { id: location.id, player: location.playerStart },
    messages: intro,
    rolls: [],
  })
}

/** Сколько последних бросков хранить в журнале. */
export const MAX_ROLL_LOG = 100

export type GameAction =
  | { type: 'messageAdded'; message: ChatMessage }
  | { type: 'diceRolled'; roll: RollRecord }
  | { type: 'gameReset'; state: GameState }

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'messageAdded':
      return { ...state, messages: [...state.messages, action.message] }
    case 'diceRolled':
      return { ...state, rolls: [...state.rolls, action.roll].slice(-MAX_ROLL_LOG) }
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

  const loc = raw.location
  if (!isObject(loc) || typeof loc.id !== 'string' || !locations[loc.id]) {
    problems.push('location.id: неизвестная локация')
  } else {
    const p = loc.player
    if (!isObject(p) || !Number.isInteger(p.x) || !Number.isInteger(p.y)) {
      problems.push('location.player: ожидаются целые x и y')
    } else if (tileAt(locations[loc.id], p.x as number, p.y as number) !== '.') {
      problems.push('location.player: игрок должен стоять на полу')
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
