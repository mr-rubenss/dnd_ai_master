import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import adventureJson from '../data/adventures/drunken-griffin.json'
import fighterJson from '../data/characters/fighter-ratibor.json'
import itemsJson from '../data/items.json'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import type { CharacterSheet } from '../types/character'
import type { ChatMessage } from '../types/game'
import { parseAdventure } from './adventure'
import { createAppStore, type AppStore } from './appStore'
import { parseCharacterSheet } from './character'
import { createHeroRecord } from './heroes'
import { parseItemCatalog } from './items'
import { LEGACY_BACKUP_KEY, LEGACY_HEROES_KEY, type LegacyContext } from './legacyImport'
import { SAVE_KEY, type KeyValueStorage } from './legacySave'
import { beginLegacyStory, createNewGame, gameReducer, messageAdded } from './legacyState'
import { parseLocation } from './location'
import { AiMasterDb, StoryRepository } from './repository'
import { ENGINE, leadMember, MASTER, player, replay, SYSTEM } from './storyActions'

const catalog = parseItemCatalog(itemsJson)
const location = parseLocation(drunkenGriffinJson)
const locations = { [location.id]: location }
const adventure = parseAdventure(adventureJson, locations)
const adventures = { [adventure.id]: adventure }
const ratibor = parseCharacterSheet(fighterJson, catalog)
const ingrid: CharacterSheet = { ...structuredClone(ratibor), character: { ...structuredClone(ratibor.character), id: 'ingrid', name: 'Ингрид' } }

let dbCount = 0
const dbs: AiMasterDb[] = []
afterEach(async () => {
  for (const db of dbs.splice(0)) {
    db.close()
    await db.delete()
  }
})

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  }
}

const legacy: LegacyContext = {
  catalog,
  locations,
  adventure,
  migration: {
    characterTemplate: (id) => (id === ratibor.character.id ? ratibor.character : undefined),
    location: (id) => locations[id],
    armorTraining: () => ['light', 'medium', 'heavy', 'shield'],
    newStory: (heroId) => beginLegacyStory(adventure.defaultStoryTitle, heroId),
  },
}

/** Хранилище над отдельной базой. «Перезагрузка» — новое хранилище над той же базой. */
async function open(name = `test-${++dbCount}`, storage: KeyValueStorage | null = null): Promise<AppStore & { dbName: string; repo: StoryRepository }> {
  const db = new AiMasterDb(name)
  dbs.push(db)
  const repo = new StoryRepository(db)
  let clock = 1_000_000
  const store = createAppStore({ repo, catalog, locations, adventures, legacyStorage: storage, legacy, now: () => ++clock })
  await store.init()
  return Object.assign(store, { dbName: name, repo })
}

/** Две истории: «Север» с Ратибором и «Юг» с Ингрид. Открыта — «Юг». */
async function twoStories() {
  const store = await open()
  await store.saveHero(ratibor)
  await store.saveHero(ingrid)
  expect(await store.createStory({ title: 'Север', tone: 'dark-fantasy', adventureId: adventure.id, heroIds: ['ratibor'] })).toBeNull()
  const north = store.getState().active!.id
  expect(await store.createStory({ title: 'Юг', tone: 'detective', adventureId: adventure.id, heroIds: ['ingrid'] })).toBeNull()
  const south = store.getState().active!.id
  return { store, north, south }
}

const say = (heroId: string, text: string) => ({ type: 'playerSpoke' as const, heroId, messageId: crypto.randomUUID(), text })
const texts = (messages: ChatMessage[]) => messages.slice(adventure.intro.length).map((m) => m.text)

describe('истории не смешиваются', () => {
  it('у каждой истории свой отряд, сообщения, двери, НПС, броски, факты, квесты и журнал', async () => {
    const { store, north, south } = await twoStories()

    // «Юг» открыт: события в нём.
    expect(store.dispatch(say('ingrid', 'Осматриваю стойку'), player('ingrid'))).toBeNull()
    expect(store.dispatch({ type: 'doorChanged', locationId: 'drunken-griffin', doorId: 'storage-door', state: 'open' }, MASTER)).toBeNull()
    expect(store.dispatch({ type: 'npcMoved', locationId: 'drunken-griffin', npcId: 'tobias', to: { x: 12, y: 12 } }, MASTER)).toBeNull()
    store.dispatch({ type: 'factRecorded', fact: { id: 'f', text: 'Тобиас — вор', at: 1 } }, MASTER)
    store.dispatch({ type: 'questUpdated', quest: { id: 'q', title: 'Кошелёк', status: 'active', notes: '' } }, MASTER)
    store.dispatch({ type: 'journalWritten', entry: { id: 'j', at: 1, text: 'Ингрид пришла в таверну' } }, MASTER)
    store.dispatch({ type: 'diceRolled', roll: { id: 'r', timestamp: 1, result: { total: 7 } as never } }, ENGINE)
    // Ратибор в «Юге» не участвует — говорить там не может.
    expect(store.dispatch(say('ratibor', 'Я тоже тут'), player('ratibor'))).toBe('Этого героя нет в отряде истории.')

    // «Север» — открываем и действуем там.
    await store.openStory(north)
    expect(store.dispatch(say('ratibor', 'Сажусь у камина'), player('ratibor'))).toBeNull()
    const n = store.getState().active!
    expect(n.party.map((m) => m.heroId)).toEqual(['ratibor'])
    expect(texts(n.messages)).toEqual(['Сажусь у камина'])
    expect(n.world.doors['drunken-griffin']['storage-door']).toBe('locked')
    expect(n.world.locations['drunken-griffin'].npcs.find((x) => x.id === 'tobias')).toMatchObject({ x: 17, y: 9 })
    expect([n.world.facts, n.world.quests, n.journal, n.rolls]).toEqual([[], [], [], []])

    await store.openStory(south)
    const s = store.getState().active!
    expect(s.party.map((m) => m.heroId)).toEqual(['ingrid'])
    expect(texts(s.messages)).toEqual(['Осматриваю стойку'])
    expect(s.world.doors['drunken-griffin']['storage-door']).toBe('open')
    expect(s.world.locations['drunken-griffin'].npcs.find((x) => x.id === 'tobias')).toMatchObject({ x: 12, y: 12 })
    expect([s.world.facts.length, s.world.quests.length, s.journal.length, s.rolls.length]).toEqual([1, 1, 1, 1])
  })

  it('после «перезагрузки» каждая история восстанавливается из своего журнала', async () => {
    const { store, north, south } = await twoStories()
    store.dispatch(say('ingrid', 'Юг: первый ход'), player('ingrid'))
    await store.openStory(north)
    store.dispatch(say('ratibor', 'Север: первый ход'), player('ratibor'))
    store.dispatch(say('ratibor', 'Север: второй ход'), player('ratibor'))
    await store.flush()

    const reloaded = await open(store.dbName)
    expect(reloaded.getState().stories.map((x) => x.title)).toEqual(['Север', 'Юг'])
    await reloaded.openStory(south)
    expect(texts(reloaded.getState().active!.messages)).toEqual(['Юг: первый ход'])
    await reloaded.openStory(north)
    expect(texts(reloaded.getState().active!.messages)).toEqual(['Север: первый ход', 'Север: второй ход'])

    // Журналы раздельные, по порядку, у каждого действия — автор и время.
    const northLog = await reloaded.repo.actionsOf(north)
    expect(northLog.map((a) => [a.seq, a.type, a.author.kind])).toEqual([
      [0, 'storyCreated', 'system'],
      [1, 'playerSpoke', 'player'],
      [2, 'playerSpoke', 'player'],
    ])
    expect(northLog.every((a) => a.storyId === north && a.at > 0)).toBe(true)
    // Состояние = воспроизведение журнала.
    expect(replay(northLog)).toEqual(reloaded.getState().active)
  })

  it('без снимка история восстанавливается воспроизведением журнала', async () => {
    const { store, south } = await twoStories()
    store.dispatch(say('ingrid', 'Ход'), player('ingrid'))
    await store.flush()
    const expected = store.getState().active
    await store.repo.db.snapshots.delete(south)
    const reloaded = await open(store.dbName)
    await reloaded.openStory(south)
    expect(reloaded.getState().active).toEqual(expected)
  })

  it('один герой — только в одной незавершённой истории', async () => {
    const { store } = await twoStories()
    expect(await store.createStory({ title: 'Ещё', tone: 'horror', adventureId: adventure.id, heroIds: ['ratibor'] })).toBe(
      'Ратибор уже участвует в другой незавершённой истории.',
    )
    expect(store.getState().stories).toHaveLength(2)
  })

  it('переименование истории и героя затрагивает только свою историю', async () => {
    const { store, north, south } = await twoStories()
    expect(await store.renameStory(north, 'Север и холод')).toBeNull()
    expect(await store.renameHero('ratibor', 'Ратибор Гроза')).toBeNull()
    await store.flush()
    const reloaded = await open(store.dbName)
    const titles = Object.fromEntries(reloaded.getState().stories.map((x) => [x.id, x.title]))
    expect(titles).toEqual({ [north]: 'Север и холод', [south]: 'Юг' })
    await reloaded.openStory(north)
    expect(leadMember(reloaded.getState().active!).character.name).toBe('Ратибор Гроза')
    await reloaded.openStory(south)
    expect(leadMember(reloaded.getState().active!).character.name).toBe('Ингрид')
  })

  it('удаление истории стирает только её журнал; герой возвращается со своим снаряжением', async () => {
    const { store, north, south } = await twoStories()
    await store.openStory(north)
    store.dispatch({ type: 'itemsGranted', heroId: 'ratibor', items: [{ itemId: 'dagger', quantity: 5 }] }, MASTER)
    expect(await store.deleteStory(north)).toBeNull()
    await store.flush()

    expect(await store.repo.actionsOf(north)).toEqual([])
    expect(await store.repo.loadStory(north)).toBeNull()
    expect((await store.repo.actionsOf(south)).length).toBe(1)
    const hero = store.getState().roster.heroes.find((h) => h.id === 'ratibor')!
    expect(hero.storyId).toBeNull()
    expect(hero.sheet.inventory.items.find((e) => e.itemId === 'dagger')?.quantity).toBeGreaterThanOrEqual(5)
    expect(store.getState().roster.heroes.find((h) => h.id === 'ingrid')!.storyId).toBe(south)
  })

  it('завершение истории: герои в «Зале славы», история закрыта для действий, другая не тронута', async () => {
    const { store, north, south } = await twoStories()
    store.dispatch(say('ingrid', 'Последний ход'), player('ingrid'))
    expect(await store.completeActive()).toBeNull()
    const state = store.getState()
    expect(state.roster.hallOfFame).toMatchObject([{ name: 'Ингрид', storyTitle: 'Юг', fate: 'completed' }])
    expect(state.roster.heroes.map((h) => h.id)).toEqual(['ratibor'])
    expect(state.stories.find((x) => x.id === south)?.status).toBe('completed')
    expect(state.stories.find((x) => x.id === north)?.status).toBe('active')
    expect(await store.dispatchTo(south, say('ingrid', 'Ещё'), player('ingrid'))).toBe('История завершена — в ней больше ничего не происходит.')
  })

  it('действие в неоткрытую историю попадает только в её журнал', async () => {
    const { store, north, south } = await twoStories()
    expect(await store.dispatchTo(north, { type: 'masterNarrated', messageId: 'm', text: 'Тем временем на севере…' }, MASTER)).toBeNull()
    expect(store.getState().active!.id).toBe(south)
    expect(texts(store.getState().active!.messages)).toEqual([])
    expect(texts((await store.readStory(north))!.messages)).toEqual(['Тем временем на севере…'])
  })

  it('быстрый старт: новая история за Ратибора, повторный — продолжает её же', async () => {
    const store = await open()
    expect(await store.quickStart(ratibor, adventure.id)).toBeNull()
    const first = store.getState().active!
    expect(first).toMatchObject({ title: 'Вечер в «Пьяном грифоне»', tone: 'light-adventure' })
    store.closeStory()
    expect(await store.quickStart(ratibor, adventure.id)).toBeNull()
    expect(store.getState().active!.id).toBe(first.id)
    expect(store.getState().stories).toHaveLength(1)
  })
})

describe('перенос из localStorage', () => {
  /** Старое сохранение версии 8 с ходом игрока и старый список героев с «Залом славы». */
  function legacyStorage() {
    let game = createNewGame({ sheet: ratibor, location, intro: adventure.intro, story: beginLegacyStory('Вечер в «Пьяном грифоне»', 'ratibor', 500) })
    game = gameReducer(game, messageAdded('player', 'Старый ход'))
    game = { ...game, location: { ...game.location, doors: { ...game.location.doors, entrance: 'open' } } }
    const other = createHeroRecord(ingrid, 400)
    const fallen = {
      id: 'h1',
      heroId: 'brom',
      name: 'Бром',
      species: 'Дварф',
      className: 'Жрец',
      level: 3,
      portrait: '✨',
      fate: 'fallen',
      storyTitle: 'Склеп',
      summary: 'Гибель.',
      endedAt: 300,
    }
    const roster = { heroes: [{ ...createHeroRecord(ratibor, 450), storyId: game.story.id }, other], hallOfFame: [fallen] }
    return {
      game,
      storage: memoryStorage({
        [SAVE_KEY]: JSON.stringify({ version: 8, state: game }),
        [LEGACY_HEROES_KEY]: JSON.stringify({ version: 1, roster }),
      }),
    }
  }

  it('старая игра становится историей со всеми сообщениями, героями и «Залом славы»', async () => {
    const { game, storage } = legacyStorage()
    const store = await open(undefined, storage)
    const { stories, roster } = store.getState()
    expect(stories).toMatchObject([{ id: game.story.id, title: 'Вечер в «Пьяном грифоне»', party: [{ heroId: 'ratibor' }], locationName: 'Таверна «Пьяный грифон»' }])
    expect(roster.heroes.map((h) => [h.id, h.storyId])).toEqual([
      ['ingrid', null],
      ['ratibor', game.story.id],
    ])
    expect(roster.hallOfFame.map((e) => e.name)).toEqual(['Бром'])

    await store.openStory(game.story.id)
    const story = store.getState().active!
    expect(texts(story.messages)).toEqual(['Старый ход'])
    expect(story.world.doors['drunken-griffin'].entrance).toBe('open')
    expect(leadMember(story).character).toEqual(game.character)

    // Старые ключи убраны, копия сохранена; повторная загрузка ничего не дублирует.
    expect(storage.data.has(SAVE_KEY)).toBe(false)
    expect(storage.data.has(LEGACY_HEROES_KEY)).toBe(false)
    expect(JSON.parse(storage.data.get(LEGACY_BACKUP_KEY)!).save).toContain('Старый ход')
    const again = await open(store.dbName, storage)
    expect(again.getState().stories).toHaveLength(1)
    expect(again.getState().roster.heroes).toHaveLength(2)
  })

  it('повреждённое старое сохранение не мешает перенести героев', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { storage } = legacyStorage()
    storage.setItem(SAVE_KEY, '{oops')
    const store = await open(undefined, storage)
    expect(store.getState().stories).toEqual([])
    // История пропала — герой больше не числится в ней.
    expect(store.getState().roster.heroes.map((h) => h.storyId)).toEqual([null, null])
    warn.mockRestore()
  })
})

describe('действия игрока', () => {
  it('реплика, бросок и ответ ведущего записываются с разными авторами', async () => {
    const store = await open()
    await store.quickStart(ratibor, adventure.id)
    const id = store.getState().active!.id
    store.dispatch(say('ratibor', 'Бросаю кубик'), player('ratibor'))
    store.dispatch({ type: 'diceRolled', roll: { id: 'r', timestamp: 1, result: { total: 4 } as never } }, ENGINE)
    store.dispatch({ type: 'masterNarrated', messageId: 'm', text: 'Неудача' }, MASTER)
    store.dispatch({ type: 'storyRenamed', title: 'Новое имя' }, SYSTEM)
    await store.flush()
    expect((await store.repo.actionsOf(id)).map((a) => a.author.kind)).toEqual(['system', 'player', 'engine', 'master', 'system'])
  })
})
