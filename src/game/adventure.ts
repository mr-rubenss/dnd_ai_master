// Приключения — готовые завязки историй (src/data/adventures/). Чистые функции.
import type { ChatMessage } from '../types/game'
import type { LocationData } from '../types/location'
import { STORY_TONES, type StoryTone } from '../types/story'
import { isNonEmptyString, isObject, isOneOf, ValidationError } from './validation'

export interface AdventureData {
  id: string
  title: string
  description: string
  /** Название новой истории по умолчанию. */
  defaultStoryTitle: string
  defaultTone: StoryTone
  /** Локации приключения: при создании истории копируются в её мир. */
  locationIds: string[]
  startLocationId: string
  /** Вступление ведущего. */
  intro: ChatMessage[]
  /** Час начала истории в День 1 (0–23); нет — 8 утра. */
  startHour?: number
}

export function parseAdventure(raw: unknown, locations: Record<string, LocationData>): AdventureData {
  const title = 'Некорректное приключение'
  if (!isObject(raw)) throw new ValidationError(title, ['приключение должно быть объектом'])
  const problems: string[] = []
  for (const key of ['id', 'title', 'description', 'defaultStoryTitle', 'startLocationId'] as const) {
    if (!isNonEmptyString(raw[key])) problems.push(`"${key}" должно быть непустой строкой`)
  }
  if (!isOneOf(STORY_TONES, raw.defaultTone)) problems.push(`"defaultTone" — одно из: ${STORY_TONES.join(', ')}`)
  const ids = Array.isArray(raw.locationIds) ? raw.locationIds : []
  if (ids.length === 0) problems.push('"locationIds" — непустой массив id локаций')
  for (const id of ids) if (typeof id !== 'string' || !locations[id]) problems.push(`неизвестная локация "${String(id)}"`)
  if (isNonEmptyString(raw.startLocationId) && !ids.includes(raw.startLocationId)) problems.push('"startLocationId" должна быть среди "locationIds"')
  const intro = Array.isArray(raw.intro) ? raw.intro : []
  intro.forEach((m: unknown, i) => {
    if (!isObject(m) || !isNonEmptyString(m.id) || m.author !== 'master' || !isNonEmptyString(m.text)) {
      problems.push(`intro[${i}]: ожидается { id, author: "master", text }`)
    }
  })
  if (raw.startHour !== undefined && !(Number.isInteger(raw.startHour) && (raw.startHour as number) >= 0 && (raw.startHour as number) <= 23))
    problems.push('"startHour" — час 0–23')
  if (problems.length > 0) throw new ValidationError(title, problems)
  return raw as unknown as AdventureData
}
