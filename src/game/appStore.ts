// Хранилище приложения: список историй, «Мои герои» и открытая история.
// Любое изменение истории — действие (тип, автор, время), которое проверяется правилами, применяется
// к состоянию и дописывается в журнал истории в IndexedDB. Записи в базу идут строго по очереди.

import type { CharacterSheet } from '../types/character'
import type { HallOfFameEntry, HeroRecord, HeroRoster } from '../types/heroes'
import type { ItemCatalog } from '../types/items'
import type { LocationData } from '../types/location'
import type { ActionAuthor, StoryEpilogue, StoryEvent, StoryMeta, StoryState, StoryTone } from '../types/story'
import type { AdventureData } from './adventure'
import { chronicleEntry, withChronicle } from './epilogue'
import {
  addHero,
  createHeroRecord,
  deleteHero,
  EMPTY_ROSTER,
  joinStory,
  leaveStory,
  reconcileRoster,
  renameHero,
  retireHero,
  type RosterResult,
} from './heroes'
import { importLegacy, type LegacyContext } from './legacyImport'
import type { KeyValueStorage } from './legacySave'
import type { StoryRepository } from './repository'
import {
  applyAction,
  checkAction,
  makeAction,
  memberSheet,
  newStorySeed,
  player,
  storyMeta,
  storyTitleProblem,
  SYSTEM,
} from './storyActions'

export interface AppState {
  /** Данные загружены из базы. */
  ready: boolean
  /** Истории, последние сыгранные — первыми. */
  stories: StoryMeta[]
  roster: HeroRoster
  /** Открытая история (в неё играют сейчас) или null. */
  active: StoryState | null
}

export interface NewStoryRequest {
  title: string
  tone: StoryTone
  adventureId: string
  heroIds: string[]
}

export interface AppStoreOptions {
  repo: StoryRepository
  catalog: ItemCatalog
  locations: Record<string, LocationData>
  adventures: Record<string, AdventureData>
  /** localStorage — откуда переносятся старые данные. */
  legacyStorage?: KeyValueStorage | null
  legacy?: LegacyContext
  now?: () => number
  newId?: () => string
}

/** Результат команды: причина отказа или null. */
export type CommandResult = string | null

export function createAppStore(options: AppStoreOptions) {
  const { repo, catalog, locations, adventures } = options
  const now = options.now ?? Date.now
  const newId = options.newId ?? (() => crypto.randomUUID())

  let state: AppState = { ready: false, stories: [], roster: EMPTY_ROSTER, active: null }
  /** Число действий в журнале открытой истории. */
  let activeSeq = 0
  const listeners = new Set<() => void>()
  let queue: Promise<unknown> = Promise.resolve()

  const set = (patch: Partial<AppState>) => {
    state = { ...state, ...patch }
    listeners.forEach((l) => l())
  }

  /** Выполнить по очереди после всех предыдущих записей. */
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task)
    queue = run.catch((error) => console.error('Ошибка сохранения истории.', error))
    return run
  }

  const withMeta = (stories: StoryMeta[], meta: StoryMeta) =>
    [...stories.filter((s) => s.id !== meta.id), meta].sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)

  const applyRoster = (result: RosterResult): CommandResult => {
    if (!result.ok) return result.reason
    set({ roster: result.roster })
    return null
  }

  /** Проверить, применить и сохранить действие в историю, состояние которой уже загружено. */
  function commitAction(story: StoryState, seq: number, event: StoryEvent, author: ActionAuthor): { state: StoryState; seq: number } | string {
    const action = makeAction(story.id, seq, event, author, now(), newId())
    const reason = checkAction(story, action, { catalog })
    if (reason) return reason
    const next = applyAction(story, action)
    void serial(() => repo.commit({ story: { state: next, actions: [action], seq: seq + 1 } }))
    set({ stories: withMeta(state.stories, storyMeta(next, seq + 1)) })
    return { state: next, seq: seq + 1 }
  }

  /** Записать список героев в базу. */
  const saveRoster = () => serial(() => repo.commit({ roster: state.roster }))

  const store = {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    /** Дождаться, пока все изменения окажутся в базе. */
    flush: () => serial(async () => undefined),

    /** Загрузка: перенос старых данных из localStorage, список историй и героев. */
    async init(): Promise<void> {
      await serial(async () => {
        if (options.legacy) await importLegacy(repo, options.legacyStorage ?? null, options.legacy, now())
        const stories = await repo.listStories()
        const loaded = await repo.loadRoster()
        const roster = reconcileRoster(loaded, stories)
        if (roster !== loaded) await repo.commit({ roster })
        set({ ready: true, stories, roster })
      })
    },

    /** Открыть историю, чтобы играть в неё. */
    async openStory(storyId: string): Promise<CommandResult> {
      const loaded = await serial(() => repo.loadStory(storyId))
      if (!loaded) return 'Такой истории нет.'
      activeSeq = loaded.seq
      set({ active: loaded.state })
      return null
    },

    closeStory() {
      set({ active: null })
    },

    /** Состояние любой истории (для просмотра, без открытия). */
    async readStory(storyId: string): Promise<StoryState | null> {
      if (state.active?.id === storyId) return state.active
      return (await serial(() => repo.loadStory(storyId)))?.state ?? null
    },

    /** Действие в открытой истории. */
    dispatch(event: StoryEvent, author: ActionAuthor): CommandResult {
      if (!state.active) return 'Нет открытой истории.'
      const result = commitAction(state.active, activeSeq, event, author)
      if (typeof result === 'string') return result
      activeSeq = result.seq
      set({ active: result.state })
      return null
    },

    /** Действие в любой истории (если она не открыта — загружается). */
    async dispatchTo(storyId: string, event: StoryEvent, author: ActionAuthor): Promise<CommandResult> {
      if (state.active?.id === storyId) return store.dispatch(event, author)
      const loaded = await serial(() => repo.loadStory(storyId))
      if (!loaded) return 'Такой истории нет.'
      const result = commitAction(loaded.state, loaded.seq, event, author)
      return typeof result === 'string' ? result : null
    },

    /** Новая история с отрядом из свободных героев; сразу открывается. */
    async createStory(request: NewStoryRequest): Promise<CommandResult> {
      const titleProblem = storyTitleProblem(request.title)
      if (titleProblem) return titleProblem
      const adventure = adventures[request.adventureId]
      if (!adventure) return 'Такого приключения нет.'
      if (request.heroIds.length === 0) return 'Выберите героя.'
      const heroes = request.heroIds.map((id) => state.roster.heroes.find((h) => h.id === id))
      if (heroes.some((h) => !h)) return 'Такого героя нет в списке.'
      const busy = heroes.find((h) => h!.storyId)
      if (busy) return `${busy.sheet.character.name} уже участвует в другой незавершённой истории.`

      const id = newId()
      const at = now()
      const seed = newStorySeed({ id, title: request.title, tone: request.tone, adventure, locations, party: heroes.map((h) => h!.sheet), now: at })
      const action = makeAction(id, 0, { type: 'storyCreated', seed }, SYSTEM, at, newId())
      const reason = checkAction(null, action, { catalog })
      if (reason) return reason
      let roster = state.roster
      for (const heroId of request.heroIds) {
        const joined = joinStory(roster, heroId, id)
        if (!joined.ok) return joined.reason
        roster = joined.roster
      }
      const story = applyAction(null, action)
      activeSeq = 1
      set({ roster, active: story, stories: withMeta(state.stories, storyMeta(story, 1)) })
      await serial(() => repo.commit({ story: { state: story, actions: [action], seq: 1 }, roster }))
      return null
    },

    /** Быстрый старт: готовый герой. Свободен — новая история по умолчанию, занят — открывается его история. */
    async quickStart(template: CharacterSheet, adventureId: string): Promise<CommandResult> {
      let hero = state.roster.heroes.find((h) => h.id === template.character.id)
      if (hero?.storyId) return store.openStory(hero.storyId)
      if (!hero) {
        const reason = await store.saveHero(template)
        if (reason) return reason
        hero = state.roster.heroes.find((h) => h.id === template.character.id)!
      }
      const adventure = adventures[adventureId]
      return store.createStory({ title: adventure.defaultStoryTitle, tone: adventure.defaultTone, adventureId, heroIds: [hero.id] })
    },

    async renameStory(storyId: string, title: string): Promise<CommandResult> {
      return store.dispatchTo(storyId, { type: 'storyRenamed', title: title.trim() }, SYSTEM)
    },

    /** Удалить историю. Её герои возвращаются в «Мои герои» с тем, что получили в ней. */
    async deleteStory(storyId: string): Promise<CommandResult> {
      const story = await store.readStory(storyId)
      if (!story) return 'Такой истории нет.'
      let roster = state.roster
      for (const member of story.party) {
        const hero = roster.heroes.find((h) => h.id === member.heroId)
        if (hero?.storyId !== storyId) continue
        const left = leaveStory(roster, member.heroId, memberSheet(member))
        if (left.ok) roster = left.roster
      }
      set({ roster, stories: state.stories.filter((s) => s.id !== storyId), active: state.active?.id === storyId ? null : state.active })
      await serial(() => repo.commit({ deleteStoryId: storyId, roster }))
      return null
    },

    /**
     * Завершить открытую историю с итогом. Она становится доступной только для чтения; живые герои
     * освобождаются и получают запись в «Летопись», погибшие уходят в «Зал славы».
     */
    async completeStory(epilogue: StoryEpilogue): Promise<CommandResult> {
      if (!state.active) return 'Нет открытой истории.'
      const reason = store.dispatch({ type: 'storyCompleted', epilogue }, SYSTEM)
      if (reason) return reason
      const done = state.active!
      let roster = state.roster
      for (const member of done.party) {
        const result = member.fallen
          ? retireHero(roster, done, member.heroId, 'fallen', epilogue.endedAt)
          : leaveStory(roster, member.heroId, withChronicle(memberSheet(member), chronicleEntry(done, member, epilogue, catalog)))
        if (result.ok) roster = result.roster
      }
      set({ roster })
      await saveRoster()
      return null
    },

    /** Поправить итог завершённой истории — и запись «Летописи» её героев. */
    async editEpilogue(storyId: string, text: { summary: string; outcome: string }): Promise<CommandResult> {
      const story = await store.readStory(storyId)
      if (!story?.epilogue) return 'У этой истории нет итога.'
      const epilogue = { ...story.epilogue, summary: text.summary.trim(), outcome: text.outcome.trim() }
      const reason = await store.dispatchTo(storyId, { type: 'epilogueEdited', epilogue }, SYSTEM)
      if (reason) return reason
      const heroes = state.roster.heroes.map((hero) => {
        const member = story.party.find((m) => m.heroId === hero.id)
        if (!member || !hero.sheet.character.chronicle?.some((e) => e.storyId === storyId)) return hero
        return { ...hero, sheet: withChronicle(hero.sheet, chronicleEntry(story, member, epilogue, catalog)) }
      })
      set({ roster: { ...state.roster, heroes } })
      await saveRoster()
      return null
    },

    // ---------- Герои ----------

    async saveHero(sheet: CharacterSheet): Promise<CommandResult> {
      const reason = applyRoster(addHero(state.roster, createHeroRecord(sheet, now())))
      if (!reason) await saveRoster()
      return reason
    },

    /** Переименовать героя — в списке и в его незавершённой истории (действием героя). */
    async renameHero(heroId: string, name: string): Promise<CommandResult> {
      const reason = applyRoster(renameHero(state.roster, heroId, name))
      if (reason) return reason
      await saveRoster()
      const storyId = state.roster.heroes.find((h) => h.id === heroId)?.storyId
      return storyId ? store.dispatchTo(storyId, { type: 'heroRenamed', heroId, name: name.trim() }, player(heroId)) : null
    },

    async deleteHero(heroId: string): Promise<CommandResult> {
      const hero = state.roster.heroes.find((h) => h.id === heroId)
      const title = state.stories.find((s) => s.id === hero?.storyId)?.title
      const reason = applyRoster(deleteHero(state.roster, heroId, title))
      if (!reason) await saveRoster()
      return reason
    },

    /** Для отладки и e2e: добавить готовую запись героя или «Зала славы». */
    async importRecords(records: { heroes?: HeroRecord[]; hall?: HallOfFameEntry[] }): Promise<void> {
      set({
        roster: {
          heroes: [...state.roster.heroes, ...(records.heroes ?? [])],
          hallOfFame: [...(records.hall ?? []), ...state.roster.hallOfFame],
        },
      })
      await saveRoster()
    },
  }
  return store
}

export type AppStore = ReturnType<typeof createAppStore>
