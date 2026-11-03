// Истории (сюжеты) и начало прохождения. Чистые функции.
import type { StoryProgress } from '../types/game'
import type { LocationData } from '../types/location'
import { isNonEmptyString, isObject, ValidationError } from './validation'

/** История из данных: с чего начинается и как называется. */
export interface StoryData {
  id: string
  title: string
  /** Стартовая локация. */
  locationId: string
}

export function parseStory(raw: unknown, locations: Record<string, LocationData>): StoryData {
  const problems: string[] = []
  if (!isObject(raw)) throw new ValidationError('Некорректная история', ['история должна быть объектом'])
  for (const key of ['id', 'title', 'locationId'] as const) {
    if (!isNonEmptyString(raw[key])) problems.push(`"${key}" должно быть непустой строкой`)
  }
  if (isNonEmptyString(raw.locationId) && !locations[raw.locationId]) problems.push(`неизвестная локация "${raw.locationId}"`)
  if (problems.length > 0) throw new ValidationError('Некорректная история', problems)
  return { id: raw.id as string, title: raw.title as string, locationId: raw.locationId as string }
}

/** Новое прохождение истории за героя. */
export function beginStory(story: StoryData, heroId: string, now: number = Date.now()): StoryProgress {
  return { id: crypto.randomUUID(), storyId: story.id, title: story.title, heroId, startedAt: now }
}
