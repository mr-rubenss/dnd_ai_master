import { useSyncExternalStore } from 'react'
import { gameStore } from '../game/gameStore'
import type { GameState } from '../types/game'

/** Текущее состояние игры (null — игры нет); компонент перерисовывается при каждом изменении. */
export function useGameState(): GameState | null {
  return useSyncExternalStore(gameStore.subscribe, gameStore.getState)
}

export { gameStore }
