// События магии в истории: выбор заклинаний старым заклинателем, подготовка, сотворение.
import { describe, expect, it } from 'vitest'
import { defaultAdventure, itemCatalog, locations, rulesData, startingSheet } from '../data'
import type { CharacterMagic } from '../types/spells'
import type { StoryEvent, StoryState } from '../types/story'
import { applyAction, checkAction, makeAction, MASTER, newStorySeed, player } from './storyActions'

const ctx = { catalog: itemCatalog, rules: rulesData }
const HERO = startingSheet.character.id

/** Старое сохранение: волшебник без выбранных заклинаний. */
function oldWizard(): StoryState {
  const sheet = structuredClone(startingSheet)
  sheet.character = { ...sheet.character, classId: 'wizard', className: 'Волшебник', feats: [] }
  return newStorySeed({ id: 's', title: 'Т', tone: 'detective', adventure: defaultAdventure, locations, party: [sheet], now: 1 })
}

const magic: CharacterMagic = {
  cantrips: ['fire-bolt', 'light', 'mage-hand'],
  spellbook: ['magic-missile', 'shield', 'sleep', 'detect-magic', 'mage-armor', 'identify'],
  prepared: ['magic-missile', 'shield', 'sleep', 'mage-armor'],
  slotsUsed: {},
}

let seq = 1
function act(state: StoryState, event: StoryEvent, author = player(HERO)) {
  const action = makeAction(state.id, seq++, event, author, 10, `a${seq}`)
  const reason = checkAction(state, action, ctx)
  return reason ? { reason, state } : { reason: null, state: applyAction(state, action) }
}

describe('события магии', () => {
  it('старому заклинателю — выбор заклинаний; повторно выбрать нельзя', () => {
    const s = oldWizard()
    expect(act(s, { type: 'spellsChosen', heroId: HERO, magic: { ...magic, cantrips: ['fire-bolt'] } }).reason).toBe('Заговоры: выберите 3 (выбрано 1)')
    const chosen = act(s, { type: 'spellsChosen', heroId: HERO, magic })
    expect(chosen.reason).toBeNull()
    expect(chosen.state.party[0].character.magic).toEqual(magic)
    expect(act(chosen.state, { type: 'spellsChosen', heroId: HERO, magic }).reason).toBe('Заклинания этого героя уже выбраны.')
  })

  it('подготовленные — в пределах лимита и из книги', () => {
    const s = act(oldWizard(), { type: 'spellsChosen', heroId: HERO, magic }).state
    expect(act(s, { type: 'preparedSpellsChanged', heroId: HERO, prepared: ['magic-missile', 'shield', 'sleep', 'mage-armor', 'identify'] }).reason).toBe(
      'Подготовленные заклинания: выберите 4 (выбрано 5)',
    )
    expect(act(s, { type: 'preparedSpellsChanged', heroId: HERO, prepared: ['magic-missile', 'shield', 'sleep', 'grease'] }).reason).toBe('«Скользкая поверхность» нет в книге заклинаний')
    const next = act(s, { type: 'preparedSpellsChanged', heroId: HERO, prepared: ['magic-missile', 'shield', 'sleep', 'identify'] })
    expect(next.reason).toBeNull()
    expect(next.state.party[0].character.magic?.prepared).toContain('identify')
    expect(act(s, { type: 'preparedSpellsChanged', heroId: HERO, prepared: magic.prepared }, MASTER).reason).toBe('Подготовленные заклинания меняет игрок.')
  })

  it('сотворение проверяется: ячейка тратится, лишнюю потратить нельзя', () => {
    let s = act(oldWizard(), { type: 'spellsChosen', heroId: HERO, magic }).state
    const cast: StoryEvent = { type: 'spellCast', heroId: HERO, spellId: 'magic-missile', slotLevel: 1, freeKey: null, ritual: false }
    s = act(s, cast, MASTER).state
    s = act(s, cast, MASTER).state
    expect(s.party[0].character.magic?.slotsUsed).toEqual({ 1: 2 })
    expect(act(s, cast, MASTER).reason).toBe('Ячейки 1-го круга потрачены.')
    expect(act(s, { ...cast, spellId: 'cure-wounds' }, MASTER).reason).toMatch(/не знает заклинания/)
    expect(act(s, { ...cast, spellId: 'fire-bolt', slotLevel: null }, MASTER).reason).toBeNull()
  })

  it('без правил магии события заклинаний отклоняются', () => {
    const s = oldWizard()
    const action = makeAction(s.id, 1, { type: 'spellsChosen', heroId: HERO, magic }, player(HERO), 1, 'x')
    expect(checkAction(s, action, { catalog: itemCatalog })).toBe('Нет данных правил магии.')
  })
})

describe('строка изменений за ход', () => {
  it('потраченная ячейка видна в строке изменений', async () => {
    const { changeList, ledgerOf, turnDelta } = await import('./turnChanges')
    const before = act(oldWizard(), { type: 'spellsChosen', heroId: HERO, magic }).state
    const after = act(before, { type: 'spellCast', heroId: HERO, spellId: 'sleep', slotLevel: 1, freeKey: null, ritual: false }, MASTER).state
    const changes = changeList(turnDelta(ledgerOf(before, itemCatalog), ledgerOf(after, itemCatalog)), after, itemCatalog)
    expect(changes).toEqual([{ heroId: HERO, kind: 'spell', text: '−1 ячейка 1-го круга', tone: 'loss' }])
  })
})
