// Реестр локаций. Каждая локация проходит валидацию при загрузке модуля.
import { parseLocation } from '../../game/location'
import type { LocationData } from '../../types/location'
import drunkenGriffinJson from './drunken-griffin.json'

export const drunkenGriffin = parseLocation(drunkenGriffinJson)

export const locations: Record<string, LocationData> = {
  [drunkenGriffin.id]: drunkenGriffin,
}

