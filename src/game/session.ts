// Связка двух хранилищ — игры и «Моих героев»: начать и завершить историю, сохранить и переименовать героя.
// Каждое действие проверяется правилами из heroes.ts; возвращается причина отказа или null.
import type { CharacterSheet } from '../types/character'
import type { HeroFate } from '../types/heroes'
import { addHero, createHeroRecord, joinStory, leaveStory, renameHero, retireHero } from './heroes'
import type { HeroStore } from './heroStore'
import type { GameStore } from './store'

export interface Stores {
  game: GameStore
  heroes: HeroStore
}

/** Сохранить нового героя в «Мои герои» (после создания персонажа). */
export function saveHero({ heroes }: Stores, sheet: CharacterSheet): string | null {
  return heroes.update((roster) => addHero(roster, createHeroRecord(sheet)))
}

/**
 * Начать историю за героя из списка. Если идёт другая история, она прерывается:
 * её герой возвращается в список вместе с тем, что получил в ней.
 */
export function startStory({ game, heroes }: Stores, heroId: string): string | null {
  const hero = heroes.getState().heroes.find((h) => h.id === heroId)
  if (!hero) return 'Такого героя нет в списке.'
  const current = game.getState()
  if (hero.storyId && hero.storyId !== current?.story.id) return `${hero.sheet.character.name} уже участвует в другой незавершённой истории.`
  if (current) {
    const reason = heroes.update((roster) => leaveStory(roster, current.character.id, { character: current.character, inventory: current.inventory }))
    if (reason) return reason
  }
  const sheet = heroes.getState().heroes.find((h) => h.id === heroId)!.sheet
  game.startGame(sheet)
  return heroes.update((roster) => joinStory(roster, heroId, game.getState()!.story.id))
}

/** Быстрый старт: готовый герой (из списка, если он там уже есть) начинает историю. */
export function quickStart(stores: Stores, template: CharacterSheet): string | null {
  if (!stores.heroes.getState().heroes.some((h) => h.id === template.character.id)) {
    const reason = saveHero(stores, template)
    if (reason) return reason
  }
  return startStory(stores, template.character.id)
}

/** История закончилась (гибелью или завершением): герой уходит в «Зал славы», игра заканчивается. */
export function endStory({ game, heroes }: Stores, fate: HeroFate): string | null {
  const state = game.getState()
  if (!state) return 'Сейчас нет начатой истории.'
  const reason = heroes.update((roster) => retireHero(roster, state, fate))
  if (reason) return reason
  game.endGame()
  return null
}

/** Переименовать героя — в списке и, если он сейчас в игре, в её состоянии. */
export function renameEverywhere({ game, heroes }: Stores, heroId: string, name: string): string | null {
  const reason = heroes.update((roster) => renameHero(roster, heroId, name))
  if (reason) return reason
  if (game.getState()?.character.id === heroId) game.dispatch({ type: 'characterRenamed', name: name.trim() })
  return null
}
