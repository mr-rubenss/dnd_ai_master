// Единственный экземпляр хранилища игры, связанный с реальными данными и localStorage браузера.
import { introMessages, itemCatalog, locations, rulesData, startingSheet, startingStory } from '../data'
import { beginStory } from './story'
import { createNewGame, parseGameState } from './state'
import { parseRoster } from './heroes'
import { createHeroStore } from './heroStore'
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
  createNewGame: (sheet) =>
    createNewGame({ sheet, location: locations[startingStory.locationId], intro: introMessages, story: beginStory(startingStory, sheet.character.id) }),
  parseState: (raw) => parseGameState(raw, { catalog: itemCatalog, locations }),
  migration: {
    characterTemplate: (id) => (id === startingSheet.character.id ? startingSheet.character : undefined),
    location: (id) => locations[id],
    armorTraining: (classId) => rulesData.classes[classId]?.armorTraining,
    newStory: (heroId) => beginStory(startingStory, heroId),
  },
})

/** «Мои герои» и «Зал славы»; при загрузке согласуются с сохранённой игрой. */
export const heroStore = createHeroStore({
  storage: browserStorage(),
  parseRoster: (raw) => parseRoster(raw, itemCatalog),
  game: gameStore.getState(),
})
