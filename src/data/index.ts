// Игровые данные из JSON, проверенные при загрузке.
import { parseCharacterSheet } from '../game/character'
import { parseItemCatalog } from '../game/items'
import type { ChatMessage } from '../types/game'
import fighterJson from './characters/fighter-ratibor.json'
import introMessagesJson from './intro-messages.json'
import itemsJson from './items.json'

export { locations, startingLocation } from './locations'

export const itemCatalog = parseItemCatalog(itemsJson)
export const startingSheet = parseCharacterSheet(fighterJson, itemCatalog)
export const introMessages = introMessagesJson as ChatMessage[]
