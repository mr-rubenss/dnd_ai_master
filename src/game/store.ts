// Единое хранилище состояния игры с сохранением в localStorage.

import type { Proficiencies } from '../engine/checks'
import type { GameState } from '../types/game'
import { gameReducer, type GameAction } from './state'

export const SAVE_KEY = 'ai-master:save'
export const SAVE_VERSION = 3

/** Минимальный интерфейс хранилища (совместим с window.localStorage). */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface GameStore {
  getState(): GameState
  subscribe(listener: () => void): () => void
  dispatch(action: GameAction): void
  /** Начать новую игру, стерев сохранение. */
  newGame(): void
}

export interface GameStoreOptions {
  storage: KeyValueStorage | null
  createNewGame: () => GameState
  /** Проверка загруженного состояния; бросает исключение, если сохранение некорректно. */
  parseState: (raw: unknown) => GameState
  migration?: MigrationContext
}

/**
 * Переносит сохранение старой версии на текущую. Каждый шаг — переход на одну версию.
 * Возвращает null, если версия неизвестна.
 */
export function migrateSave(save: unknown, context: MigrationContext = {}): unknown | null {
  if (typeof save !== 'object' || save === null) return null
  let { version, state } = save as { version?: unknown; state?: unknown }
  if (version === 1) {
    // v2: добавлен журнал бросков.
    state = { ...(state as object), rolls: [] }
    version = 2
  }
  if (version === 2) {
    // v3: у персонажа появились владения и состояния. Владения берём из стартового шаблона персонажа.
    const s = state as { character?: { id?: unknown } }
    const id = typeof s.character?.id === 'string' ? s.character.id : ''
    const proficiencies = context.proficienciesFor?.(id) ?? { savingThrows: [], skills: {} }
    state = { ...s, character: { ...s.character, proficiencies: structuredClone(proficiencies), conditions: [] } }
    version = 3
  }
  return version === SAVE_VERSION ? state : null
}

export interface MigrationContext {
  /** Владения персонажа по id — для сохранений, сделанных до их появления (v2 → v3). */
  proficienciesFor?: (characterId: string) => Proficiencies | undefined
}

export function loadSavedGame(
  storage: KeyValueStorage | null,
  parseState: (raw: unknown) => GameState,
  migration: MigrationContext = {},
): GameState | null {
  if (!storage) return null
  try {
    const text = storage.getItem(SAVE_KEY)
    if (!text) return null
    const state = migrateSave(JSON.parse(text), migration)
    if (state === null) throw new Error('неподдерживаемая версия сохранения')
    return parseState(state)
  } catch (error) {
    console.warn('Сохранение повреждено или устарело, начинаем новую игру.', error)
    return null
  }
}

export function saveGame(storage: KeyValueStorage | null, state: GameState): void {
  if (!storage) return
  try {
    storage.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, state }))
  } catch (error) {
    // Переполнение или запрет хранилища (приватный режим) не должны ломать игру.
    console.warn('Не удалось сохранить игру.', error)
  }
}

export function createGameStore({ storage, createNewGame, parseState, migration }: GameStoreOptions): GameStore {
  let state = loadSavedGame(storage, parseState, migration) ?? createNewGame()
  const listeners = new Set<() => void>()

  const setState = (next: GameState) => {
    if (next === state) return
    state = next
    saveGame(storage, state)
    listeners.forEach((listener) => listener())
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispatch(action) {
      setState(gameReducer(state, action))
    },
    newGame() {
      setState(createNewGame())
    },
  }
}
