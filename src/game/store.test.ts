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
  it('без сохранения начинает новую игру', () => {
    const store = createGameStore({ storage: memoryStorage(), createNewGame: newGame, parseState })
    expect(store.getState().messages).toHaveLength(introJson.length)
  })

  it('сохраняет каждое изменение и восстанавливает его после «перезагрузки»', () => {
    const storage = memoryStorage()
    const store = createGameStore({ storage, createNewGame: newGame, parseState })
    const listener = vi.fn()
    store.subscribe(listener)
    store.dispatch(messageAdded('player', 'Подхожу к стойке'))
    expect(listener).toHaveBeenCalledOnce()

    const reloaded = createGameStore({ storage, createNewGame: newGame, parseState })
    expect(reloaded.getState()).toEqual(store.getState())
    expect(reloaded.getState().messages.at(-1)?.text).toBe('Подхожу к стойке')
  })

  it('новая игра заменяет сохранение', () => {
    const storage = memoryStorage()
    const store = createGameStore({ storage, createNewGame: newGame, parseState })
    store.dispatch(messageAdded('player', 'Привет'))
    store.newGame()
    const saved = JSON.parse(storage.data.get(SAVE_KEY)!)
    expect(saved.state.messages).toHaveLength(introJson.length)
  })

  it.each([
    ['не JSON', '{oops'],
    ['другая версия', JSON.stringify({ version: SAVE_VERSION + 1, state: {} })],
    ['неизвестная локация', JSON.stringify({ version: SAVE_VERSION, state: { ...newGame(), location: { id: 'nowhere', player: { x: 1, y: 1 } } } })],
  ])('при повреждённом сохранении (%s) начинает новую игру', (_, saved) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = createGameStore({ storage: memoryStorage({ [SAVE_KEY]: saved }), createNewGame: newGame, parseState })
    expect(store.getState()).toEqual(newGame())
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('переносит сохранение версии 1 (без журнала бросков), не теряя прогресс', () => {
    const { rolls: _rolls, ...v1State } = gameReducer(newGame(), messageAdded('player', 'Старый ход'))
    const storage = memoryStorage({ [SAVE_KEY]: JSON.stringify({ version: 1, state: v1State }) })
    const store = createGameStore({ storage, createNewGame: newGame, parseState })
    expect(store.getState().messages.at(-1)?.text).toBe('Старый ход')
    expect(store.getState().rolls).toEqual([])
  })

  it('сохраняет броски и восстанавливает их после перезагрузки', () => {
    const storage = memoryStorage()
    const store = createGameStore({ storage, createNewGame: newGame, parseState })
    store.dispatch(diceRolled(roll('4d6kh3', { rng: () => 0.99 }), 'Сила'))
    const reloaded = createGameStore({ storage, createNewGame: newGame, parseState })
    expect(reloaded.getState().rolls[0].result.total).toBe(18)
  })

  it('работает без доступа к хранилищу', () => {
    const store = createGameStore({ storage: null, createNewGame: newGame, parseState })
    store.dispatch(messageAdded('player', 'Тест'))
    expect(store.getState().messages.at(-1)?.text).toBe('Тест')
  })
})
