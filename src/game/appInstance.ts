// Единственный экземпляр хранилища приложения: IndexedDB браузера и перенос старых данных из localStorage.
import { defaultAdventure, adventures, itemCatalog, locations, rulesData, startingSheet } from '../data'
import { createAppStore } from './appStore'
import { beginLegacyStory } from './legacyState'
import { AiMasterDb, StoryRepository } from './repository'

function browserStorage() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export const appStore = createAppStore({
  repo: new StoryRepository(new AiMasterDb()),
  catalog: itemCatalog,
  locations,
  adventures,
  legacyStorage: browserStorage(),
  legacy: {
    catalog: itemCatalog,
    locations,
    adventure: defaultAdventure,
    migration: {
      characterTemplate: (id) => (id === startingSheet.character.id ? startingSheet.character : undefined),
      location: (id) => locations[id],
      armorTraining: (classId) => rulesData.classes[classId]?.armorTraining,
      newStory: (heroId) => beginLegacyStory(defaultAdventure.defaultStoryTitle, heroId),
    },
  },
})

/** Отладочный доступ (e2e-тесты): включается флагом localStorage ai-master:debug = 1. */
if (browserStorage()?.getItem('ai-master:debug') === '1') {
  ;(window as unknown as { __aiMaster: unknown }).__aiMaster = appStore
}
