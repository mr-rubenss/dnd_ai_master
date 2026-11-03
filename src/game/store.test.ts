import { describe, expect, it, vi } from 'vitest'
import fighterJson from '../data/characters/fighter-ratibor.json'
import introJson from '../data/intro-messages.json'
import itemsJson from '../data/items.json'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import type { ChatMessage } from '../types/game'
import { parseCharacterSheet } from './character'
import { parseItemCatalog } from './items'
import { parseLocation } from './location'
import storyJson from '../data/story.json'
import { beginStory, parseStory } from './story'
import { roll } from '../engine/dice'
import { changeEquipment, createNewGame, diceRolled, gameReducer, MAX_ROLL_LOG, messageAdded, parseGameState } from './state'
import { createGameStore, SAVE_KEY, SAVE_VERSION, type KeyValueStorage } from './store'

const catalog = parseItemCatalog(itemsJson)
const location = parseLocation(drunkenGriffinJson)
const locations = { [location.id]: location }
const story = parseStory(storyJson, locations)
const sheet = parseCharacterSheet(fighterJson, catalog)
const newGame = () => createNewGame({ sheet, location, intro: introJson as ChatMessage[], story: beginStory(story, sheet.character.id) })
const parseState = (raw: unknown) => parseGameState(raw, { catalog, locations })

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
    expect(state.messages).toHaveLength(introJson.length)
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
    expect(state.messages).toHaveLength(introJson.length)
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

describe('смена экипировки через хранилище', () => {
  it('правила проверяются до действия; редьюсер применяет новую экипировку', () => {
    const state = newGame()
    const take = changeEquipment(state, catalog, { kind: 'equip', itemId: 'flail', slot: 'mainHand' })
    expect(take.ok).toBe(true)
    if (!take.ok) return
    expect(take.action).toEqual({
      type: 'equipmentChanged',
      equipped: { mainHand: 'flail', offHand: null, armor: 'chain-mail' },
      change: { kind: 'equip', itemId: 'flail', slot: 'mainHand' },
    })
    const next = gameReducer(state, take.action)
    expect(next.inventory.equipped.mainHand).toBe('flail')
    expect(state.inventory.equipped.mainHand).toBe('greatsword')
    expect(parseState(next)).toBe(next)
  })

  it('нарушение правил — причина вместо действия', () => {
    expect(changeEquipment(newGame(), catalog, { kind: 'equip', itemId: 'javelin', slot: 'offHand' })).toEqual({
      ok: false,
      reason: '«Метательное копьё» не лёгкое — во вторую руку можно взять только лёгкое оружие',
    })
  })

  it('«Убрать» освобождает слот', () => {
    const result = changeEquipment(newGame(), catalog, { kind: 'unequip', slot: 'armor' })
    expect(result.ok && gameReducer(newGame(), result.action).inventory.equipped.armor).toBeNull()
  })
})

describe('хранилище игры', () => {
  const createNew = (s: typeof sheet = sheet) => createNewGame({ sheet: s, location, intro: introJson as ChatMessage[], story: beginStory(story, s.character.id) })
  const options = (storage: ReturnType<typeof memoryStorage> | null) => ({
    storage,
    createNewGame: createNew,
    parseState,
    migration: {
      characterTemplate: (id: string) => (id === sheet.character.id ? sheet.character : undefined),
      location: (id: string) => locations[id],
      armorTraining: (classId: string) => (classId === 'fighter' ? (['light', 'medium', 'heavy', 'shield'] as const) : undefined),
      newStory: (heroId: string) => beginStory(story, heroId),
    },
  })
  /** Хранилище с уже начатой игрой. */
  const started = (storage: ReturnType<typeof memoryStorage> | null = memoryStorage()) => {
    const store = createGameStore(options(storage))
    store.startGame(sheet)
    return store
  }

  it('без сохранения игры нет — показывается создание персонажа', () => {
    const storage = memoryStorage()
    const store = createGameStore(options(storage))
    expect(store.getState()).toBeNull()
    store.dispatch(messageAdded('player', 'В пустоту'))
    expect(store.getState()).toBeNull()
    expect(storage.data.has(SAVE_KEY)).toBe(false)
  })

  it('startGame начинает игру за персонажа и сразу сохраняет её', () => {
    const storage = memoryStorage()
    const store = createGameStore(options(storage))
    const listener = vi.fn()
    store.subscribe(listener)
    store.startGame(sheet)
    expect(listener).toHaveBeenCalledOnce()
    expect(store.getState()!.character.name).toBe('Ратибор')
    expect(store.getState()!.messages).toHaveLength(introJson.length)
    expect(JSON.parse(storage.data.get(SAVE_KEY)!).version).toBe(SAVE_VERSION)
  })

  it('сохраняет каждое изменение и восстанавливает его после «перезагрузки»', () => {
    const storage = memoryStorage()
    const store = started(storage)
    store.dispatch(messageAdded('player', 'Подхожу к стойке'))
    const reloaded = createGameStore(options(storage))
    expect(reloaded.getState()).toEqual(store.getState())
    expect(reloaded.getState()!.messages.at(-1)?.text).toBe('Подхожу к стойке')
  })

  it('endGame стирает сохранение — после перезагрузки снова создание персонажа', () => {
    const storage = memoryStorage()
    const store = started(storage)
    store.endGame()
    expect(store.getState()).toBeNull()
    expect(storage.data.has(SAVE_KEY)).toBe(false)
    expect(createGameStore(options(storage)).getState()).toBeNull()
  })

  it.each([
    ['не JSON', '{oops'],
    ['другая версия', JSON.stringify({ version: SAVE_VERSION + 1, state: {} })],
    ['неизвестная локация', JSON.stringify({ version: SAVE_VERSION, state: { ...createNew(), location: { id: 'nowhere', player: { x: 1, y: 1 }, doors: {} } } })],
    ['неизвестная дверь', JSON.stringify({ version: SAVE_VERSION, state: { ...createNew(), location: { ...createNew().location, doors: { entrance: 'open', 'storage-door': 'locked', gate: 'open' } } } })],
    ['неверное состояние двери', JSON.stringify({ version: SAVE_VERSION, state: { ...createNew(), location: { ...createNew().location, doors: { entrance: 'ajar', 'storage-door': 'locked' } } } })],
    ['сохранение v5 в неизвестной локации', JSON.stringify({ version: 5, state: { ...createNew(), location: { id: 'nowhere', player: { x: 1, y: 1 } } } })],
  ])('при повреждённом сохранении (%s) игры нет', (_, saved) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = createGameStore(options(memoryStorage({ [SAVE_KEY]: saved })))
    expect(store.getState()).toBeNull()
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
    const store = createGameStore(options(oldSave(1, (s) => (stripV3(s), delete s.rolls))))
    expect(store.getState()!.messages.at(-1)?.text).toBe('Старый ход')
    expect(store.getState()!.rolls).toEqual([])
    expect(store.getState()!.character).toEqual(sheet.character)
  })

  it('переносит сохранение версии 2: владения из шаблона персонажа, состояний нет', () => {
    const store = createGameStore(options(oldSave(2, stripV3)))
    expect(store.getState()!.messages.at(-1)?.text).toBe('Старый ход')
    expect(store.getState()!.character.proficiencies).toEqual(sheet.character.proficiencies)
    expect(store.getState()!.character.conditions).toEqual([])
  })

  it('переносит сохранение версии 3: вид, предыстория и черты из шаблона', () => {
    const store = createGameStore(options(oldSave(3, stripV4)))
    expect(store.getState()!.character).toMatchObject({
      speciesId: 'human',
      backgroundId: 'soldier',
      feats: ['savage-attacker', 'alert', 'great-weapon-fighting'],
    })
    expect(store.getState()!.messages.at(-1)?.text).toBe('Старый ход')
  })

  it('переносит сохранение версии 4: руки вместо слотов «оружие/щит», инструменты и боевой стиль из шаблона', () => {
    const storage = oldSave(4, (s) => {
      const inventory = s.inventory as { equipped: Record<string, unknown> }
      inventory.equipped = { weapon: 'greatsword', armor: 'chain-mail', shield: null }
      const proficiencies = s.character.proficiencies as Record<string, unknown>
      delete proficiencies.tools
      s.character.feats = ['savage-attacker', 'alert']
    })
    const state = createGameStore(options(storage)).getState()!
    expect(state.inventory.equipped).toEqual({ mainHand: 'greatsword', offHand: null, armor: 'chain-mail' })
    expect(state.character.proficiencies.tools).toEqual(['dice-set'])
    expect(state.character.feats).toEqual(['savage-attacker', 'alert', 'great-weapon-fighting'])
    expect(state.messages.at(-1)?.text).toBe('Старый ход')
  })

  it('переносит сохранение версии 5 на тонкие стены: игрок на стартовой клетке перерисованной карты, двери из локации', () => {
    const state = createGameStore(options(oldSave(5, () => {}))).getState()!
    expect(state.location).toEqual({
      id: 'drunken-griffin',
      player: location.playerStart,
      doors: { entrance: 'closed', 'storage-door': 'locked' },
    })
    expect(state.messages.at(-1)?.text).toBe('Старый ход')
    expect(state.character).toEqual(sheet.character)
  })

  it('переносит сохранение версии 6: владение доспехами из данных класса', () => {
    const state = createGameStore(options(oldSave(6, () => {}))).getState()!
    expect(state.character.proficiencies.armor).toEqual(['light', 'medium', 'heavy', 'shield'])
    expect(state.messages.at(-1)?.text).toBe('Старый ход')
  })

  it('переносит сохранение версии 7: прохождение стартовой истории за героя игры', () => {
    const state = createGameStore(options(oldSave(7, () => {}))).getState()!
    expect(state.story).toMatchObject({ storyId: 'griffin-evening', title: 'Вечер в «Пьяном грифоне»', heroId: sheet.character.id })
    expect(state.messages.at(-1)?.text).toBe('Старый ход')
  })

  it('отклоняет сохранение, где герой истории — не персонаж игры', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const state = { ...createNew(), story: { ...createNew().story, heroId: 'someone' } }
    expect(createGameStore(options(memoryStorage({ [SAVE_KEY]: JSON.stringify({ version: SAVE_VERSION, state }) }))).getState()).toBeNull()
    warn.mockRestore()
  })

  it('открытая дверь сохраняется в состоянии и переживает перезагрузку', () => {
    const storage = memoryStorage()
    const store = started(storage)
    const s = store.getState()!
    store.dispatch({ type: 'gameReset', state: { ...s, location: { ...s.location, doors: { ...s.location.doors, entrance: 'open' } } } })
    expect(createGameStore(options(storage)).getState()!.location.doors.entrance).toBe('open')
  })

  it('сохранение версии 3 неизвестного персонажа тоже загружается', () => {
    const storage = oldSave(3, (s) => {
      stripV4(s)
      s.character.id = 'someone-else'
    })
    expect(createGameStore(options(storage)).getState()!.character).toMatchObject({ speciesId: 'unknown', feats: [], appearance: '' })
  })

  it('сохраняет броски и восстанавливает их после перезагрузки', () => {
    const storage = memoryStorage()
    started(storage).dispatch(diceRolled(roll('4d6kh3', { rng: () => 0.99 }), 'Сила'))
    expect(createGameStore(options(storage)).getState()!.rolls[0].result.total).toBe(18)
  })

  it('работает без доступа к хранилищу', () => {
    const store = started(null)
    store.dispatch(messageAdded('player', 'Тест'))
    expect(store.getState()!.messages.at(-1)?.text).toBe('Тест')
  })
})
