// Хранилище «Моих героев» и «Зала славы» с сохранением в localStorage (отдельно от сохранения игры).
import type { GameState } from '../types/game'
import type { HeroRoster } from '../types/heroes'
import { EMPTY_ROSTER, reconcileRoster, type RosterResult } from './heroes'
import type { KeyValueStorage } from './store'

export const HEROES_KEY = 'ai-master:heroes'
export const HEROES_VERSION = 1

export interface HeroStore {
  getState(): HeroRoster
  subscribe(listener: () => void): () => void
  /** Применяет изменение (чистую функцию из heroes.ts). Возвращает причину отказа или null. */
  update(change: (roster: HeroRoster) => RosterResult): string | null
}

export interface HeroStoreOptions {
  storage: KeyValueStorage | null
  parseRoster: (raw: unknown) => HeroRoster
  /** Сохранённая игра на момент загрузки — чтобы согласовать с ней список героев. */
  game: GameState | null
}

export function loadRoster(storage: KeyValueStorage | null, parseRoster: (raw: unknown) => HeroRoster): HeroRoster {
  if (!storage) return EMPTY_ROSTER
  try {
    const text = storage.getItem(HEROES_KEY)
    if (!text) return EMPTY_ROSTER
    const saved = JSON.parse(text) as { version?: unknown; roster?: unknown }
    if (saved.version !== HEROES_VERSION) throw new Error('неподдерживаемая версия списка героев')
    return parseRoster(saved.roster)
  } catch (error) {
    console.warn('Список героев повреждён, начинаем с пустого.', error)
    return EMPTY_ROSTER
  }
}

function saveRoster(storage: KeyValueStorage | null, roster: HeroRoster) {
  try {
    storage?.setItem(HEROES_KEY, JSON.stringify({ version: HEROES_VERSION, roster }))
  } catch (error) {
    console.warn('Не удалось сохранить список героев.', error)
  }
}

export function createHeroStore({ storage, parseRoster, game }: HeroStoreOptions): HeroStore {
  const loaded = loadRoster(storage, parseRoster)
  let roster = reconcileRoster(loaded, game)
  if (roster !== loaded) saveRoster(storage, roster)
  const listeners = new Set<() => void>()

  return {
    getState: () => roster,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    update(change) {
      const result = change(roster)
      if (!result.ok) return result.reason
      roster = result.roster
      saveRoster(storage, roster)
      listeners.forEach((listener) => listener())
      return null
    },
  }
}
