// Единое хранилище состояния игры с сохранением в localStorage.

import type { Character, CharacterSheet } from '../types/character'
import type { GameState } from '../types/game'
import type { LocationData } from '../types/location'
import { gameReducer, initialDoorStates, type GameAction } from './state'

export const SAVE_KEY = 'ai-master:save'
export const SAVE_VERSION = 6

/** Минимальный интерфейс хранилища (совместим с window.localStorage). */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface GameStore {
  /** Текущая игра или null, если игры нет (тогда показывается создание персонажа). */
  getState(): GameState | null
  subscribe(listener: () => void): () => void
  /** Изменить состояние идущей игры; без игры — ничего не делает. */
  dispatch(action: GameAction): void
  /** Начать игру за готового персонажа и сразу сохранить её. */
  startGame(sheet: CharacterSheet): void
  /** Завершить игру и стереть сохранение — дальше снова создание персонажа. */
  endGame(): void
}

export interface GameStoreOptions {
  storage: KeyValueStorage | null
  createNewGame: (sheet: CharacterSheet) => GameState
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
    const proficiencies = context.characterTemplate?.(id)?.proficiencies ?? { savingThrows: [], skills: {} }
    state = { ...s, character: { ...s.character, proficiencies: structuredClone(proficiencies), conditions: [] } }
    version = 3
  }
  if (version === 3) {
    // v4: вид, предыстория, черты и внешность (появились вместе с созданием персонажа).
    const s = state as { character?: { id?: unknown } }
    const id = typeof s.character?.id === 'string' ? s.character.id : ''
    const template = context.characterTemplate?.(id)
    state = {
      ...s,
      character: {
        ...s.character,
        speciesId: template?.speciesId ?? 'unknown',
        backgroundId: template?.backgroundId ?? 'unknown',
        speciesOption: template?.speciesOption ?? null,
        feats: structuredClone(template?.feats ?? []),
        appearance: template?.appearance ?? '',
      },
    }
    version = 4
  }
  if (version === 4) {
    // v5: руки вместо слотов «оружие/щит», владение инструментами. Ратибор (по шаблону) получает
    // новые черты шаблона (боевой стиль); остальные персонажи — только переименование слотов.
    const s = state as { character?: { id?: unknown; proficiencies?: object; feats?: unknown }; inventory?: { equipped?: Record<string, unknown> } }
    const id = typeof s.character?.id === 'string' ? s.character.id : ''
    const template = context.characterTemplate?.(id)
    const old = s.inventory?.equipped ?? {}
    const feats = Array.isArray(s.character?.feats) ? (s.character.feats as string[]) : []
    state = {
      ...s,
      character: {
        ...s.character,
        proficiencies: { ...s.character?.proficiencies, tools: structuredClone(template?.proficiencies.tools ?? []) },
        feats: [...new Set([...feats, ...(template?.feats ?? [])])],
      },
      inventory: { ...s.inventory, equipped: { mainHand: old.weapon ?? null, offHand: old.shield ?? null, armor: old.armor ?? null } },
    }
    version = 5
  }
  if (version === 5) {
    // v6: тонкие стены по границам клеток вместо стен-клеток. Карты перерисованы, старые координаты
    // больше ничего не значат — игрок возвращается на стартовую клетку локации. Появились двери с состоянием.
    const s = state as { location?: { id?: unknown } }
    const id = typeof s.location?.id === 'string' ? s.location.id : ''
    const location = context.location?.(id)
    if (!location) return null
    state = {
      ...s,
      location: {
        id,
        player: { ...location.playerStart },
        doors: initialDoorStates(location),
      },
    }
    version = 6
  }
  return version === SAVE_VERSION ? state : null
}

export interface MigrationContext {
  /** Стартовый шаблон персонажа по id — источник полей, которых не было в старых сохранениях. */
  characterTemplate?: (characterId: string) => Character | undefined
  /** Локация по id — для переноса позиции и дверей на новый формат карт. */
  location?: (locationId: string) => LocationData | undefined
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

export function clearSave(storage: KeyValueStorage | null): void {
  try {
    storage?.removeItem(SAVE_KEY)
  } catch (error) {
    console.warn('Не удалось удалить сохранение.', error)
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
  let state: GameState | null = loadSavedGame(storage, parseState, migration)
  const listeners = new Set<() => void>()

  const setState = (next: GameState | null) => {
    if (next === state) return
    state = next
    if (state) saveGame(storage, state)
    else clearSave(storage)
    listeners.forEach((listener) => listener())
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispatch(action) {
      if (state) setState(gameReducer(state, action))
    },
    startGame(sheet) {
      setState(createNewGame(sheet))
    },
    endGame() {
      setState(null)
    },
  }
}
