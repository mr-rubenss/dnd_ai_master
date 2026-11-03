import { describe, expect, it, vi } from 'vitest'
import fighterJson from '../data/characters/fighter-ratibor.json'
import introJson from '../data/intro-messages.json'
import itemsJson from '../data/items.json'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import type { ChatMessage } from '../types/game'
import { parseCharacterSheet } from './character'
import { parseItemCatalog } from './items'
import { parseLocation } from './location'
import { roll } from '../engine/dice'
import { createNewGame, diceRolled, gameReducer, MAX_ROLL_LOG, messageAdded, parseGameState } from './state'
import { createGameStore, SAVE_KEY, SAVE_VERSION, type KeyValueStorage } from './store'

const catalog = parseItemCatalog(itemsJson)
const location = parseLocation(drunkenGriffinJson)
const locations = { [location.id]: location }
const sheet = parseCharacterSheet(fighterJson, catalog)
const newGame = () => createNewGame({ sheet, location, intro: introJson as ChatMessage[] })
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
    expect(state.location).toEqual({ id: 'drunken-griffin', player: location.playerStart })
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

describe('хранилище игры', () => {
  const createNew = (s: typeof sheet = sheet) => createNewGame({ sheet: s, location, intro: introJson as ChatMessage[] })
  const options = (storage: ReturnType<typeof memoryStorage> | null) => ({
    storage,
    createNewGame: createNew,
    parseState,
    migration: { characterTemplate: (id: string) => (id === sheet.character.id ? sheet.character : undefined) },
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
    ['неизвестная локация', JSON.stringify({ version: SAVE_VERSION, state: { ...createNew(), location: { id: 'nowhere', player: { x: 1, y: 1 } } } })],
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
    expect(store.getState()!.character).toMatchObject({ speciesId: 'human', backgroundId: 'soldier', feats: ['savage-attacker', 'alert'] })
    expect(store.getState()!.messages.at(-1)?.text).toBe('Старый ход')
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
