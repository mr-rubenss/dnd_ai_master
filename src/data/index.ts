// Игровые данные из JSON, проверенные при загрузке.
import { parsePrices } from '../game/prices'
import { parseAdventure, type AdventureData } from '../game/adventure'
import { parseCharacterSheet } from '../game/character'
import { parseItemCatalog } from '../game/items'
import { parseRulesData } from '../game/rulesData'
import fighterJson from './characters/fighter-ratibor.json'
import itemsJson from './items.json'
import pricesJson from './prices.json'
import backgroundsJson from './rules/backgrounds.json'
import classesJson from './rules/classes.json'
import featsJson from './rules/feats.json'
import packsJson from './rules/packs.json'
import speciesJson from './rules/species.json'
import drunkenGriffinAdventureJson from './adventures/drunken-griffin.json'
import { locations } from './locations'

export { locations } from './locations'
/** Приключения для новых историй. Таверна «Пьяный грифон» — по умолчанию. */
export const defaultAdventure = parseAdventure(drunkenGriffinAdventureJson, locations)
export const adventures: Record<string, AdventureData> = { [defaultAdventure.id]: defaultAdventure }

export const itemCatalog = parseItemCatalog(itemsJson)
/** Прейскурант еды, ночлега и услуг (SRD 5.2). */
export const priceList = parsePrices(pricesJson)
export const rulesData = parseRulesData(
  { classes: classesJson, backgrounds: backgroundsJson, species: speciesJson, feats: featsJson, packs: packsJson },
  itemCatalog,
)
/** Готовый персонаж для быстрого старта. */
export const startingSheet = parseCharacterSheet(fighterJson, itemCatalog)
