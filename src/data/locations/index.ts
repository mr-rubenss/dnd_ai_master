// Реестр локаций. Каждая локация проходит валидацию при загрузке модуля.
import { parseLocation } from '../../game/location'
import drunkenGriffinJson from './drunken-griffin.json'

export const drunkenGriffin = parseLocation(drunkenGriffinJson)
