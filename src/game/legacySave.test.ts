import { describe, expect, it, vi } from 'vitest'
import adventureJson from '../data/adventures/drunken-griffin.json'
import fighterJson from '../data/characters/fighter-ratibor.json'
import itemsJson from '../data/items.json'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import { roll } from '../engine/dice'
import type { ChatMessage, GameState } from '../types/game'
import { parseCharacterSheet } from './character'
import { parseItemCatalog } from './items'
import { loadSavedGame, SAVE_KEY, SAVE_VERSION, type KeyValueStorage } from './legacySave'
import { beginLegacyStory, createNewGame, diceRolled, gameReducer, MAX_ROLL_LOG, messageAdded, parseGameState } from './legacyState'
import { parseLocation } from './location'

// Старый формат сохранения (одна игра в localStorage, версии 1–8): проверка и миграция до версии 8.
// Перенос в истории IndexedDB проверяется в src/game/appStore.test.ts.

const catalog = parseItemCatalog(itemsJson)
const location = parseLocation(drunkenGriffinJson)
const locations = { [location.id]: location }
const intro = adventureJson.intro as ChatMessage[]
const TITLE = 'Вечер в «Пьяном грифоне»'
const sheet = parseCharacterSheet(fighterJson, catalog)
const createNew = (s: typeof sheet = sheet) => createNewGame({ sheet: s, location, intro, story: beginLegacyStory(TITLE, s.character.id) })
const newGame = () => createNew()
const parseState = (raw: unknown) => parseGameState(raw, { catalog, locations })
const migration = {
  characterTemplate: (id: string) => (id === sheet.character.id ? sheet.character : undefined),
  location: (id: string) => locations[id],
  armorTraining: (classId: string) => (classId === 'fighter' ? (['light', 'medium', 'heavy', 'shield'] as const) : undefined),
  newStory: (heroId: string) => beginLegacyStory(TITLE, heroId),
}
/** Загрузка старого сохранения с миграцией. */
const load = (storage: KeyValueStorage): GameState | null => loadSavedGame(storage, parseState, migration)

/** localStorage в памяти для тестов. */
function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  }
}

describe('состояние игры', () => {
  it('новая игра: воин в таверне на стартовой клетке и вступительные сообщения', () => {
    const state = newGame()
    expect(state.character.name).toBe('Ратибор')
    expect(state.location).toEqual({
      id: 'drunken-griffin',
      player: location.playerStart,
      doors: { entrance: 'closed', 'storage-door': 'locked' },
    })
    expect(state.messages).toHaveLength(intro.length)
    expect(parseState(state)).toBe(state)
  })

  it('новая игра не делит объекты с исходными данными', () => {
    const state = newGame()
    state.inventory.items[0].quantity = 999
    expect(sheet.inventory.items[0].quantity).not.toBe(999)
  })

  it('редьюсер добавляет сообщение, не изменяя прежнее состояние', () => {
    const state = newGame()
    const next = gameReducer(state, messageAdded('player', 'Заказываю эль'))
    expect(next.messages.at(-1)).toMatchObject({ author: 'player', text: 'Заказываю эль' })
    expect(state.messages).toHaveLength(intro.length)
  })
})

describe('журнал бросков', () => {
  it('записывает бросок с подписью и результатом движка', () => {
    const result = roll('1d20+5', { rng: () => 0.5 })
    const next = gameReducer(newGame(), diceRolled(result, 'Атака'))
    expect(next.rolls).toHaveLength(1)
    expect(next.rolls[0]).toMatchObject({ label: 'Атака', result })
    expect(parseState(next)).toBe(next)
  })

  it(`хранит не больше ${MAX_ROLL_LOG} последних бросков`, () => {
    let state = newGame()
    for (let i = 0; i < MAX_ROLL_LOG + 5; i++) state = gameReducer(state, diceRolled(roll('1d6', { rng: () => 0 }), `#${i}`))
    expect(state.rolls).toHaveLength(MAX_ROLL_LOG)
    expect(state.rolls[0].label).toBe('#5')
    expect(state.rolls.at(-1)?.label).toBe(`#${MAX_ROLL_LOG + 4}`)
  })
})

describe('перенос старых сохранений', () => {
  it.each([
    ['не JSON', '{oops'],
    ['другая версия', JSON.stringify({ version: SAVE_VERSION + 1, state: {} })],
    ['неизвестная локация', JSON.stringify({ version: SAVE_VERSION, state: { ...createNew(), location: { id: 'nowhere', player: { x: 1, y: 1 }, doors: {} } } })],
    ['неизвестная дверь', JSON.stringify({ version: SAVE_VERSION, state: { ...createNew(), location: { ...createNew().location, doors: { entrance: 'open', 'storage-door': 'locked', gate: 'open' } } } })],
    ['неверное состояние двери', JSON.stringify({ version: SAVE_VERSION, state: { ...createNew(), location: { ...createNew().location, doors: { entrance: 'ajar', 'storage-door': 'locked' } } } })],
    ['сохранение v5 в неизвестной локации', JSON.stringify({ version: 5, state: { ...createNew(), location: { id: 'nowhere', player: { x: 1, y: 1 } } } })],
  ])('при повреждённом сохранении (%s) игры нет', (_, saved) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(load(memoryStorage({ [SAVE_KEY]: saved }))).toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  /** Сохранение старой версии: убираем поля, которых тогда не было. */
  function oldSave(version: number, strip: (state: Record<string, unknown> & { character: Record<string, unknown> }) => void) {
    const state = structuredClone(gameReducer(createNew(), messageAdded('player', 'Старый ход'))) as unknown as Record<string, unknown> & {
      character: Record<string, unknown>
    }
    // До v6 стены занимали клетки, дверей в состоянии не было; (9, 12) — старая стартовая клетка таверны.
    if (version < 6) state.location = { id: 'drunken-griffin', player: { x: 9, y: 12 } }
    // До v7 владения доспехами в листе не было.
    if (version < 7) delete (state.character.proficiencies as Record<string, unknown>).armor
    // До v8 у игры не было прохождения истории.
    if (version < 8) delete state.story
    strip(state)
    return memoryStorage({ [SAVE_KEY]: JSON.stringify({ version, state }) })
  }
  const stripV4 = (s: { character: Record<string, unknown> }) => {
    for (const key of ['speciesId', 'backgroundId', 'speciesOption', 'feats', 'appearance']) delete s.character[key]
  }
  const stripV3 = (s: { character: Record<string, unknown> }) => {
    stripV4(s)
    delete s.character.proficiencies
    delete s.character.conditions
  }

  it('переносит сохранение версии 1 (без журнала бросков), не теряя прогресс', () => {
    const state = load(oldSave(1, (s) => (stripV3(s), delete s.rolls)))!
    expect(state.messages.at(-1)?.text).toBe('Старый ход')
    expect(state.rolls).toEqual([])
    expect(state.character).toEqual(sheet.character)
  })

  it('переносит сохранение версии 2: владения из шаблона персонажа, состояний нет', () => {
    const state = load(oldSave(2, stripV3))!
    expect(state.messages.at(-1)?.text).toBe('Старый ход')
    expect(state.character.proficiencies).toEqual(sheet.character.proficiencies)
    expect(state.character.conditions).toEqual([])
  })

  it('переносит сохранение версии 3: вид, предыстория и черты из шаблона', () => {
    const state = load(oldSave(3, stripV4))!
    expect(state.character).toMatchObject({
      speciesId: 'human',
      backgroundId: 'soldier',
      feats: ['savage-attacker', 'alert', 'great-weapon-fighting'],
    })
    expect(state.messages.at(-1)?.text).toBe('Старый ход')
  })

  it('переносит сохранение версии 4: руки вместо слотов «оружие/щит», инструменты и боевой стиль из шаблона', () => {
    const storage = oldSave(4, (s) => {
      const inventory = s.inventory as { equipped: Record<string, unknown> }
      inventory.equipped = { weapon: 'greatsword', armor: 'chain-mail', shield: null }
      const proficiencies = s.character.proficiencies as Record<string, unknown>
      delete proficiencies.tools
      s.character.feats = ['savage-attacker', 'alert']
    })
    const state = load(storage)!
    expect(state.inventory.equipped).toEqual({ mainHand: 'greatsword', offHand: null, armor: 'chain-mail' })
    expect(state.character.proficiencies.tools).toEqual(['dice-set'])
    expect(state.character.feats).toEqual(['savage-attacker', 'alert', 'great-weapon-fighting'])
    expect(state.messages.at(-1)?.text).toBe('Старый ход')
  })

  it('переносит сохранение версии 5 на тонкие стены: игрок на стартовой клетке перерисованной карты, двери из локации', () => {
    const state = load(oldSave(5, () => {}))!
    expect(state.location).toEqual({
      id: 'drunken-griffin',
      player: location.playerStart,
      doors: { entrance: 'closed', 'storage-door': 'locked' },
    })
    expect(state.messages.at(-1)?.text).toBe('Старый ход')
    expect(state.character).toEqual(sheet.character)
  })

  it('переносит сохранение версии 6: владение доспехами из данных класса', () => {
    const state = load(oldSave(6, () => {}))!
    expect(state.character.proficiencies.armor).toEqual(['light', 'medium', 'heavy', 'shield'])
    expect(state.messages.at(-1)?.text).toBe('Старый ход')
  })

  it('переносит сохранение версии 7: прохождение стартовой истории за героя игры', () => {
    const state = load(oldSave(7, () => {}))!
    expect(state.story).toMatchObject({ title: TITLE, heroId: sheet.character.id })
    expect(state.messages.at(-1)?.text).toBe('Старый ход')
  })

  it('отклоняет сохранение, где герой истории — не персонаж игры', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const state = { ...createNew(), story: { ...createNew().story, heroId: 'someone' } }
    expect(load(memoryStorage({ [SAVE_KEY]: JSON.stringify({ version: SAVE_VERSION, state }) }))).toBeNull()
    warn.mockRestore()
  })

  it('сохранение версии 3 неизвестного персонажа тоже загружается', () => {
    const storage = oldSave(3, (s) => {
      stripV4(s)
      s.character.id = 'someone-else'
    })
    expect(load(storage)!.character).toMatchObject({ speciesId: 'unknown', feats: [], appearance: '' })
  })

})
