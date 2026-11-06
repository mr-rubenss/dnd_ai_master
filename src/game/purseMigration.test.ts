// Миграция сохранений: золото числом (старый формат) → кошелёк монетами — в листах героев, в начале истории,
// в снимках и при воспроизведении старых goldChanged.
import { describe, expect, it } from 'vitest'
import { itemCatalog } from '../data'
import adventureJson from '../data/adventures/drunken-griffin.json'
import fighterJson from '../data/characters/fighter-ratibor.json'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import type { StoryState } from '../types/story'
import { parseAdventure } from './adventure'
import { migrateSheet, parseCharacterSheet } from './character'
import { parseLocation } from './location'
import { checkAction, makeAction, MASTER, migrateStory, newStorySeed, replay } from './storyActions'

const location = parseLocation(drunkenGriffinJson)
const locations = { [location.id]: location }
const adventure = parseAdventure(adventureJson, locations)
const ratibor = parseCharacterSheet(fighterJson, itemCatalog)

/** Как выглядел отряд в старом сохранении: inventory.gold числом, без coins. */
function oldFormat(state: StoryState, gold: number): StoryState {
  return {
    ...state,
    party: state.party.map((m) => {
      const { coins: _coins, ...inv } = m.inventory
      return { ...m, inventory: { ...inv, gold } as unknown as typeof m.inventory }
    }),
  }
}

describe('миграция кошелька', () => {
  it('лист героя: gold 15.55 → 15 зм 5 см 5 мм', () => {
    const { coins: _c, ...inv } = ratibor.inventory
    const old = { ...ratibor, inventory: { ...inv, gold: 15.55 } }
    expect(parseCharacterSheet(old, itemCatalog).inventory.coins).toEqual({ gp: 15, sp: 5, cp: 5 })
    expect(migrateSheet(ratibor)).toEqual(ratibor)
  })

  it('старый журнал: начало истории с золотом числом и goldChanged в зм воспроизводятся в монеты', () => {
    const seed = oldFormat(newStorySeed({ id: 's1', title: 'Старая', tone: 'detective', adventure, locations, party: [ratibor], now: 1 }), 18)
    const actions = [
      makeAction('s1', 1, { type: 'storyCreated', seed }, { kind: 'system' }, 1, 'a1'),
      makeAction('s1', 2, { type: 'goldChanged', heroId: 'ratibor', delta: -0.04 }, MASTER, 2, 'a2'),
      makeAction('s1', 3, { type: 'goldChanged', heroId: 'ratibor', delta: 2.5 }, MASTER, 3, 'a3'),
    ]
    const state = replay(actions, null)
    expect(state.party[0].inventory.coins).toEqual({ gp: 19, sp: 14, cp: 6 })
    expect('gold' in state.party[0].inventory).toBe(false)
    // Новые изменения — уже монетами.
    const pay = makeAction('s1', 4, { type: 'moneyChanged', heroId: 'ratibor', delta: -4, coins: { gp: 19, sp: 14, cp: 2 } }, MASTER, 4, 'a4')
    expect(checkAction(state, pay, { catalog: itemCatalog })).toBeNull()
    const cheat = makeAction('s1', 4, { type: 'moneyChanged', heroId: 'ratibor', delta: -4, coins: { gp: 30, sp: 0, cp: 0 } }, MASTER, 4, 'a4')
    expect(checkAction(state, cheat, { catalog: itemCatalog })).toBe('Кошелёк после оплаты не сходится с суммой.')
  })

  it('старый снимок истории → монеты', () => {
    const state = oldFormat(newStorySeed({ id: 's1', title: 'Старая', tone: 'detective', adventure, locations, party: [ratibor], now: 1 }), 7.3)
    expect(migrateStory(state).party[0].inventory.coins).toEqual({ gp: 7, sp: 3, cp: 0 })
  })
})
