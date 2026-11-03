// Хранение историй и героев в IndexedDB (через Dexie). localStorage для этого мал (~5 МБ).
//
// Таблицы:
// - stories   — краткие сведения об историях (для списка «Мои истории»);
// - actions   — журнал действий каждой истории: ключ [storyId+seq], только добавление;
// - snapshots — последнее состояние истории (кэш, чтобы не воспроизводить весь журнал при загрузке);
// - heroes, hall — «Мои герои» и «Зал славы» (герои принадлежат игроку, а их состояние в игре — истории);
// - meta      — служебные отметки (например, перенос из localStorage выполнен).

import Dexie, { type Table } from 'dexie'
import type { HallOfFameEntry, HeroRecord, HeroRoster } from '../types/heroes'
import type { StoryAction, StoryMeta, StoryState } from '../types/story'
import { replay, storyMeta } from './storyActions'

export const DB_NAME = 'ai-master'

export interface StorySnapshot {
  storyId: string
  /** Сколько действий журнала учтено в состоянии. */
  seq: number
  state: StoryState
}

export class AiMasterDb extends Dexie {
  stories!: Table<StoryMeta, string>
  actions!: Table<StoryAction, [string, number]>
  snapshots!: Table<StorySnapshot, string>
  heroes!: Table<HeroRecord, string>
  hall!: Table<HallOfFameEntry, string>
  meta!: Table<{ key: string; value: unknown }, string>

  constructor(name: string = DB_NAME) {
    super(name)
    this.version(1).stores({
      stories: 'id, lastPlayedAt',
      actions: '[storyId+seq], storyId',
      snapshots: 'storyId',
      heroes: 'id',
      hall: 'id, endedAt',
      meta: 'key',
    })
  }
}

export interface LoadedStory {
  state: StoryState
  /** Число действий в журнале — номер следующего действия. */
  seq: number
}

/** Атомарная запись: новые действия истории с её состоянием, список героев, удаление истории. */
export interface Commit {
  story?: { state: StoryState; actions: StoryAction[]; seq: number }
  roster?: HeroRoster
  deleteStoryId?: string
}

export class StoryRepository {
  readonly db: AiMasterDb

  constructor(db: AiMasterDb) {
    this.db = db
  }

  async listStories(): Promise<StoryMeta[]> {
    return (await this.db.stories.toArray()).sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
  }

  /** Журнал действий истории по порядку. */
  async actionsOf(storyId: string): Promise<StoryAction[]> {
    return this.db.actions.where('[storyId+seq]').between([storyId, Dexie.minKey], [storyId, Dexie.maxKey]).toArray()
  }

  /**
   * Загружает историю: снимок, если он учитывает весь журнал, иначе — воспроизведение журнала
   * (с конца снимка, если он есть). null — истории нет.
   */
  async loadStory(storyId: string): Promise<LoadedStory | null> {
    const [snapshot, count] = await Promise.all([this.db.snapshots.get(storyId), this.db.actions.where('storyId').equals(storyId).count()])
    if (count === 0) return null
    if (snapshot && snapshot.seq === count) return { state: snapshot.state, seq: count }
    const actions = await this.actionsOf(storyId)
    const from = snapshot && snapshot.seq < count ? snapshot : null
    const state = replay(actions.slice(from?.seq ?? 0), from?.state ?? null)
    return { state, seq: count }
  }

  async loadRoster(): Promise<HeroRoster> {
    const [heroes, hall] = await Promise.all([this.db.heroes.toArray(), this.db.hall.toArray()])
    return { heroes: heroes.sort((a, b) => a.createdAt - b.createdAt), hallOfFame: hall.sort((a, b) => b.endedAt - a.endedAt) }
  }

  async commit({ story, roster, deleteStoryId }: Commit): Promise<void> {
    const { db } = this
    await db.transaction('rw', [db.stories, db.actions, db.snapshots, db.heroes, db.hall], async () => {
      if (deleteStoryId) {
        await db.actions.where('storyId').equals(deleteStoryId).delete()
        await db.snapshots.delete(deleteStoryId)
        await db.stories.delete(deleteStoryId)
      }
      if (story) {
        if (story.actions.length > 0) await db.actions.bulkAdd(story.actions)
        await db.snapshots.put({ storyId: story.state.id, seq: story.seq, state: story.state })
        await db.stories.put(storyMeta(story.state, story.seq))
      }
      if (roster) {
        await db.heroes.clear()
        await db.heroes.bulkPut(roster.heroes)
        await db.hall.clear()
        await db.hall.bulkPut(roster.hallOfFame)
      }
    })
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.db.meta.get(key))?.value as T | undefined
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.meta.put({ key, value })
  }
}
