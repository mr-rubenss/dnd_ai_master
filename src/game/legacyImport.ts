// Перенос данных из localStorage (до историй) в IndexedDB без потерь:
// старое сохранение игры (версии 1–8) становится историей, «Мои герои» и «Зал славы» — таблицами.
// После успешной записи в IndexedDB старые ключи удаляются, а их копия остаётся в ai-master:legacy-backup.

import type { GameState } from '../types/game'
import type { HeroRoster } from '../types/heroes'
import type { ItemCatalog } from '../types/items'
import type { LocationData } from '../types/location'
import type { StoryState, StoryTone } from '../types/story'
import type { AdventureData } from './adventure'
import { addHero, createHeroRecord, EMPTY_ROSTER, parseRoster } from './heroes'
import { loadSavedGame, SAVE_KEY, type KeyValueStorage, type MigrationContext } from './legacySave'
import { parseGameState } from './legacyState'
import type { StoryRepository } from './repository'
import { makeAction, SYSTEM } from './storyActions'

export const LEGACY_HEROES_KEY = 'ai-master:heroes'
export const LEGACY_BACKUP_KEY = 'ai-master:legacy-backup'

export interface LegacyContext {
  catalog: ItemCatalog
  locations: Record<string, LocationData>
  /** Приключение, из которого были старые игры (таверна). */
  adventure: AdventureData
  migration: MigrationContext
}

/** Старая игра → начальное состояние истории (со всеми сообщениями и бросками). */
export function storyFromLegacyGame(game: GameState, adventure: AdventureData, locations: Record<string, LocationData>, tone: StoryTone): StoryState {
  const location = locations[game.location.id]
  return structuredClone({
    id: game.story.id,
    title: game.story.title,
    tone,
    adventureId: adventure.id,
    status: 'active' as const,
    createdAt: game.story.startedAt,
    updatedAt: game.story.startedAt,
    party: [{ heroId: game.character.id, character: game.character, inventory: game.inventory, position: game.location.player }],
    world: {
      locations: { [location.id]: location },
      currentLocationId: location.id,
      doors: { [location.id]: game.location.doors },
      facts: [],
      quests: [],
    },
    journal: [],
    messages: game.messages,
    rolls: game.rolls,
  })
}

function loadLegacyRoster(storage: KeyValueStorage, catalog: ItemCatalog): HeroRoster {
  const text = storage.getItem(LEGACY_HEROES_KEY)
  if (!text) return EMPTY_ROSTER
  try {
    return parseRoster((JSON.parse(text) as { roster?: unknown }).roster, catalog)
  } catch (error) {
    console.warn('Старый список героев повреждён — переносим без него.', error)
    return EMPTY_ROSTER
  }
}

/**
 * Переносит данные из localStorage, если они там есть. Возвращает id перенесённой истории (или null).
 * Повторный вызов ничего не делает: старых ключей уже нет.
 */
export async function importLegacy(repo: StoryRepository, storage: KeyValueStorage | null, ctx: LegacyContext, now: number = Date.now()): Promise<string | null> {
  if (!storage) return null
  const saveText = storage.getItem(SAVE_KEY)
  const heroesText = storage.getItem(LEGACY_HEROES_KEY)
  if (!saveText && !heroesText) return null

  const game = saveText ? loadSavedGame(storage, (raw) => parseGameState(raw, { catalog: ctx.catalog, locations: ctx.locations }), ctx.migration) : null
  let roster = loadLegacyRoster(storage, ctx.catalog)
  // Существующие в IndexedDB герои не теряются: старые добавляются к ним.
  const existing = await repo.loadRoster()
  const known = new Set(existing.heroes.map((h) => h.id))
  roster = {
    heroes: [...existing.heroes, ...roster.heroes.filter((h) => !known.has(h.id))],
    hallOfFame: [...existing.hallOfFame, ...roster.hallOfFame.filter((e) => !existing.hallOfFame.some((x) => x.id === e.id))],
  }

  let story: StoryState | null = null
  if (game) {
    story = storyFromLegacyGame(game, ctx.adventure, ctx.locations, ctx.adventure.defaultTone)
    const heroId = game.character.id
    if (!roster.heroes.some((h) => h.id === heroId)) {
      const added = addHero(roster, createHeroRecord({ character: game.character, inventory: game.inventory }, game.story.startedAt))
      if (added.ok) roster = added.roster
    }
    // Герой старой игры — в её истории; прочие отметки поправит reconcileRoster при загрузке.
    const storyId = story.id
    roster = { ...roster, heroes: roster.heroes.map((h) => (h.id === heroId ? { ...h, storyId } : h)) }
  }

  await repo.commit({
    story: story ? { state: story, actions: [makeAction(story.id, 0, { type: 'storyCreated', seed: story }, SYSTEM, story.updatedAt)], seq: 1 } : undefined,
    roster,
  })

  storage.setItem(LEGACY_BACKUP_KEY, JSON.stringify({ at: now, save: saveText, heroes: heroesText }))
  storage.removeItem(SAVE_KEY)
  storage.removeItem(LEGACY_HEROES_KEY)
  return story?.id ?? null
}
