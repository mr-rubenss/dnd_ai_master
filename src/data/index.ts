// Игровые данные из JSON, проверенные при загрузке.
import { parseCharacterSheet } from '../game/character'
import { parseItemCatalog } from '../game/items'
import { parseRulesData } from '../game/rulesData'
import type { ChatMessage } from '../types/game'
import fighterJson from './characters/fighter-ratibor.json'
import introMessagesJson from './intro-messages.json'
import itemsJson from './items.json'
import backgroundsJson from './rules/backgrounds.json'
import classesJson from './rules/classes.json'
import featsJson from './rules/feats.json'
import packsJson from './rules/packs.json'
import speciesJson from './rules/species.json'

export { locations, startingLocation } from './locations'

export const itemCatalog = parseItemCatalog(itemsJson)
export const rulesData = parseRulesData(
  { classes: classesJson, backgrounds: backgroundsJson, species: speciesJson, feats: featsJson, packs: packsJson },
  itemCatalog,
)
/** Готовый персонаж для быстрого старта. */
export const startingSheet = parseCharacterSheet(fighterJson, itemCatalog)
export const introMessages = introMessagesJson as ChatMessage[]
