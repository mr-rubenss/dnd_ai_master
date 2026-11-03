import { describe, expect, it, vi } from 'vitest'
import fighterJson from '../data/characters/fighter-ratibor.json'
import introJson from '../data/intro-messages.json'
import itemsJson from '../data/items.json'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import storyJson from '../data/story.json'
import type { CharacterSheet } from '../types/character'
import type { ChatMessage, GameState } from '../types/game'
import type { HeroRoster } from '../types/heroes'
import { parseCharacterSheet } from './character'
import {
  addHero,
  createHeroRecord,
  deleteHero,
  EMPTY_ROSTER,
  heroSummary,
  joinStory,
  leaveStory,
  parseRoster,
  reconcileRoster,
  renameHero,
  retireHero,
  type RosterResult,
} from './heroes'
import { createHeroStore, HEROES_KEY, HEROES_VERSION } from './heroStore'
import { parseItemCatalog } from './items'
import { parseLocation } from './location'
import { endStory, quickStart, renameEverywhere, saveHero, startStory, type Stores } from './session'
import { createNewGame, gameReducer, messageAdded, parseGameState } from './state'
import { createGameStore, type KeyValueStorage } from './store'
import { beginStory, parseStory } from './story'

const catalog = parseItemCatalog(itemsJson)
const location = parseLocation(drunkenGriffinJson)
const locations = { [location.id]: location }
const story = parseStory(storyJson, locations)
const ratibor = parseCharacterSheet(fighterJson, catalog)

/** Другой герой: копия Ратибора с другим id, именем и классом. */
function otherHero(id = 'hero-2', name = 'Ингрид'): CharacterSheet {
  return { ...structuredClone(ratibor), character: { ...structuredClone(ratibor.character), id, name } }
}

function gameFor(sheet: CharacterSheet): GameState {
  return createNewGame({ sheet, location, intro: introJson as ChatMessage[], story: beginStory(story, sheet.character.id) })
}

/** Успешный результат — список героев; при отказе тест падает. */
function ok(result: RosterResult): HeroRoster {
  if (!result.ok) throw new Error(result.reason)
  return result.roster
}
const reason = (result: RosterResult) => (result.ok ? null : result.reason)

const withRatibor = () => ok(addHero(EMPTY_ROSTER, createHeroRecord(ratibor, 1000)))

describe('список героев', () => {
  it('новый герой: портрет по классу, свободен, лист — копия', () => {
    const hero = createHeroRecord(ratibor, 1000)
    expect(hero).toMatchObject({ id: 'ratibor', portrait: '⚔️', createdAt: 1000, storyId: null })
    expect(hero.sheet).toEqual(ratibor)
    expect(hero.sheet).not.toBe(ratibor)
  })

  it('не добавляет героя с тем же id дважды', () => {
    expect(reason(addHero(withRatibor(), createHeroRecord(ratibor)))).toBe('Герой с id «ratibor» уже есть.')
  })

  it('переименовывает с обрезкой пробелов; пустое и слишком длинное имя — отказ', () => {
    const roster = ok(renameHero(withRatibor(), 'ratibor', '  Ратибор Смелый  '))
    expect(roster.heroes[0].sheet.character.name).toBe('Ратибор Смелый')
    expect(reason(renameHero(roster, 'ratibor', '   '))).toBe('Введите имя героя.')
    expect(reason(renameHero(roster, 'ratibor', 'Я'.repeat(41)))).toBe('Имя не длиннее 40 символов.')
    expect(reason(renameHero(roster, 'nobody', 'Имя'))).toBe('Такого героя нет в списке.')
  })

  it('удаляет свободного героя, а героя из незавершённой истории — нет', () => {
    expect(ok(deleteHero(withRatibor(), 'ratibor')).heroes).toEqual([])
    const inStory = ok(joinStory(withRatibor(), 'ratibor', 'run-1'))
    expect(reason(deleteHero(inStory, 'ratibor', 'Вечер в «Пьяном грифоне»'))).toBe(
      'Ратибор сейчас в истории «Вечер в «Пьяном грифоне»». Удалить можно только героя вне истории.',
    )
  })

  it('один герой — только в одной незавершённой истории', () => {
    const inStory = ok(joinStory(withRatibor(), 'ratibor', 'run-1'))
    expect(reason(joinStory(inStory, 'ratibor', 'run-2'))).toBe('Ратибор уже участвует в другой незавершённой истории.')
    expect(ok(joinStory(inStory, 'ratibor', 'run-1'))).toEqual(inStory)
    // Выйдя из истории, герой снова свободен.
    const free = ok(leaveStory(inStory, 'ratibor'))
    expect(ok(joinStory(free, 'ratibor', 'run-2')).heroes[0].storyId).toBe('run-2')
  })

  it('выходя из прерванной истории, герой сохраняет то, что получил в ней', () => {
    const inStory = ok(joinStory(withRatibor(), 'ratibor', 'run-1'))
    const changed = { ...ratibor, inventory: { ...ratibor.inventory, gold: 999 } }
    const free = ok(leaveStory(inStory, 'ratibor', changed))
    expect(free.heroes[0]).toMatchObject({ storyId: null, sheet: { inventory: { gold: 999 } } })
  })
})

describe('Зал славы', () => {
  /** Ратибор в идущей игре с N ходами. */
  function playing(turns: number) {
    let game = gameFor(ratibor)
    for (let i = 0; i < turns; i++) game = gameReducer(game, messageAdded('player', `ход ${i}`))
    return { game, roster: ok(joinStory(withRatibor(), 'ratibor', game.story.id)) }
  }

  it('завершённая история: герой уходит из списка в «Зал славы» с итогом пути', () => {
    const { game, roster } = playing(3)
    const result = ok(retireHero(roster, game, 'completed', 5000))
    expect(result.heroes).toEqual([])
    expect(result.hallOfFame).toEqual([
      {
        id: expect.any(String),
        heroId: 'ratibor',
        name: 'Ратибор',
        species: 'Человек',
        className: 'Воин',
        level: 1,
        portrait: '⚔️',
        fate: 'completed',
        storyTitle: 'Вечер в «Пьяном грифоне»',
        summary: 'История «Вечер в «Пьяном грифоне»» завершена на 1-м уровне. 3 хода, 0 бросков кубиков.',
        endedAt: 5000,
      },
    ])
  })

  it('гибель героя — тоже в «Зал славы», новые записи — первыми', () => {
    const { game, roster } = playing(1)
    const first = ok(retireHero(roster, game, 'fallen'))
    expect(first.hallOfFame[0]).toMatchObject({ fate: 'fallen', summary: expect.stringMatching(/^Гибель в истории «Вечер в «Пьяном грифоне»» на 1-м уровне\. 1 ход,/) })

    const second = gameFor(otherHero())
    const withSecond = ok(joinStory(ok(addHero(first, createHeroRecord(otherHero()))), 'hero-2', second.story.id))
    expect(ok(retireHero(withSecond, second, 'completed')).hallOfFame.map((e) => e.name)).toEqual(['Ингрид', 'Ратибор'])
  })

  it('уйти в «Зал славы» может только герой этой истории', () => {
    const { game } = playing(0)
    expect(reason(retireHero(withRatibor(), game, 'completed'))).toBe('Ратибор не участвует в этой истории.')
  })

  it.each([
    [1, '1 ход'],
    [2, '2 хода'],
    [5, '5 ходов'],
    [11, '11 ходов'],
    [21, '21 ход'],
    [24, '24 хода'],
  ])('итог пути: %i → «%s»', (turns, text) => {
    expect(heroSummary('completed', playing(turns).game)).toContain(text)
  })
})

describe('согласование списка героев с сохранённой игрой', () => {
  it('добавляет героя старого сохранения в список и отмечает его в истории', () => {
    const game = gameFor(ratibor)
    const roster = reconcileRoster(EMPTY_ROSTER, game, 1000)
    expect(roster.heroes).toEqual([{ id: 'ratibor', portrait: '⚔️', createdAt: 1000, sheet: ratibor, storyId: game.story.id }])
  })

  it('освобождает героев историй, которых больше нет', () => {
    const roster = ok(joinStory(withRatibor(), 'ratibor', 'lost-run'))
    expect(reconcileRoster(roster, null).heroes[0].storyId).toBeNull()
  })

  it('ничего не меняет, если всё согласовано', () => {
    const game = gameFor(ratibor)
    const roster = ok(joinStory(withRatibor(), 'ratibor', game.story.id))
    expect(reconcileRoster(roster, game)).toBe(roster)
  })
})

describe('parseRoster', () => {
  it('принимает корректный список', () => {
    const roster = ok(joinStory(withRatibor(), 'ratibor', 'run-1'))
    expect(parseRoster(JSON.parse(JSON.stringify(roster)), catalog)).toEqual(roster)
  })

  it('отклоняет повреждённый лист, несовпадающий id и неверную запись «Зала славы»', () => {
    const hero = createHeroRecord(ratibor)
    const broken = {
      heroes: [
        { ...hero, id: 'other' },
        { ...hero, id: 'bad-sheet', sheet: { ...hero.sheet, character: { ...hero.sheet.character, id: 'bad-sheet', level: 99 } } },
      ],
      hallOfFame: [{ id: 'x', fate: 'vanished' }],
    }
    expect(() => parseRoster(broken, catalog)).toThrow(/heroes\[0\]: id героя не совпадает[\s\S]*heroes\[1\]\.sheet: character\.level[\s\S]*hallOfFame\[0\]/)
  })
})

/** localStorage в памяти. */
function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  }
}

/** Оба хранилища — игры и героев — над одним localStorage, как в браузере. */
function makeStores(storage = memoryStorage()): Stores & { storage: typeof storage } {
  const game = createGameStore({
    storage,
    createNewGame: (sheet) => gameFor(sheet),
    parseState: (raw) => parseGameState(raw, { catalog, locations }),
  })
  const heroes = createHeroStore({ storage, parseRoster: (raw) => parseRoster(raw, catalog), game: game.getState() })
  return { game, heroes, storage }
}

describe('сессия: герои и истории', () => {
  it('быстрый старт добавляет Ратибора и начинает историю; повторный — новая история за того же героя', () => {
    const stores = makeStores()
    expect(quickStart(stores, ratibor)).toBeNull()
    const firstRun = stores.game.getState()!.story.id
    expect(stores.heroes.getState().heroes).toMatchObject([{ id: 'ratibor', storyId: firstRun }])

    expect(quickStart(stores, ratibor)).toBeNull()
    const secondRun = stores.game.getState()!.story.id
    expect(secondRun).not.toBe(firstRun)
    expect(stores.heroes.getState().heroes).toMatchObject([{ id: 'ratibor', storyId: secondRun }])
  })

  it('новая история за другого героя прерывает текущую: прежний герой свободен и сохраняет снаряжение', () => {
    const stores = makeStores()
    quickStart(stores, ratibor)
    stores.game.dispatch({ type: 'equipmentChanged', equipped: { mainHand: null, offHand: null, armor: 'chain-mail' }, change: { kind: 'unequip', slot: 'mainHand' } })
    expect(saveHero(stores, otherHero())).toBeNull()
    expect(startStory(stores, 'hero-2')).toBeNull()

    expect(stores.game.getState()!.character.name).toBe('Ингрид')
    const [first, second] = stores.heroes.getState().heroes
    expect(first).toMatchObject({ id: 'ratibor', storyId: null, sheet: { inventory: { equipped: { mainHand: null } } } })
    expect(second.storyId).toBe(stores.game.getState()!.story.id)
  })

  it('неизвестного героя в историю не отправить', () => {
    expect(startStory(makeStores(), 'nobody')).toBe('Такого героя нет в списке.')
  })

  it('завершение истории: герой в «Зале славы», игры больше нет', () => {
    const stores = makeStores()
    expect(endStory(stores, 'completed')).toBe('Сейчас нет начатой истории.')
    quickStart(stores, ratibor)
    expect(endStory(stores, 'completed')).toBeNull()
    expect(stores.game.getState()).toBeNull()
    expect(stores.heroes.getState()).toMatchObject({ heroes: [], hallOfFame: [{ name: 'Ратибор', fate: 'completed' }] })
  })

  it('переименование героя в игре меняет имя и в состоянии игры', () => {
    const stores = makeStores()
    quickStart(stores, ratibor)
    expect(renameEverywhere(stores, 'ratibor', 'Ратибор Гроза')).toBeNull()
    expect(stores.game.getState()!.character.name).toBe('Ратибор Гроза')
    expect(stores.heroes.getState().heroes[0].sheet.character.name).toBe('Ратибор Гроза')
  })

  it('список героев сохраняется и после «перезагрузки» согласуется с игрой', () => {
    const stores = makeStores()
    saveHero(stores, otherHero())
    quickStart(stores, ratibor)
    const reloaded = makeStores(stores.storage)
    expect(reloaded.heroes.getState()).toEqual(stores.heroes.getState())
    expect(JSON.parse(stores.storage.data.get(HEROES_KEY)!).version).toBe(HEROES_VERSION)
  })

  it('старое сохранение без списка героев: герой игры появляется в «Моих героях»', () => {
    const storage = memoryStorage()
    const game = createGameStore({ storage, createNewGame: gameFor, parseState: (raw) => parseGameState(raw, { catalog, locations }) })
    game.startGame(ratibor)
    const { heroes } = makeStores(storage)
    expect(heroes.getState().heroes).toMatchObject([{ id: 'ratibor', storyId: game.getState()!.story.id }])
  })

  it('повреждённый список героев не ломает игру — начинаем с пустого', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { heroes } = makeStores(memoryStorage({ [HEROES_KEY]: '{oops' }))
    expect(heroes.getState()).toEqual(EMPTY_ROSTER)
    warn.mockRestore()
  })
})
