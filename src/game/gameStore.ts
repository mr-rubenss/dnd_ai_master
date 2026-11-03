// Единственный экземпляр хранилища игры, связанный с реальными данными и localStorage браузера.
import { introMessages, itemCatalog, locations, startingLocation, startingSheet } from '../data'
import { createNewGame, parseGameState } from './state'
import { createGameStore, type KeyValueStorage } from './store'

function browserStorage(): KeyValueStorage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export const gameStore = createGameStore({
  storage: browserStorage(),
  createNewGame: () => createNewGame({ sheet: startingSheet, location: startingLocation, intro: introMessages }),
  parseState: (raw) => parseGameState(raw, { catalog: itemCatalog, locations }),
})
