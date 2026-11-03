import { useSyncExternalStore } from 'react'
import { gameStore, heroStore } from '../game/gameStore'
import type { GameState } from '../types/game'
import type { HeroRoster } from '../types/heroes'

/** Текущее состояние игры (null — игры нет); компонент перерисовывается при каждом изменении. */
export function useGameState(): GameState | null {
  return useSyncExternalStore(gameStore.subscribe, gameStore.getState)
}

/** «Мои герои» и «Зал славы». */
export function useHeroRoster(): HeroRoster {
  return useSyncExternalStore(heroStore.subscribe, heroStore.getState)
}

export { gameStore, heroStore }
