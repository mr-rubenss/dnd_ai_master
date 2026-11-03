// История (кампания) — всё, что принадлежит одной игре: отряд, мир, журнал, лог сообщений и бросков.
// Состояние истории не меняют напрямую: оно получается применением действий (StoryAction) по порядку
// (src/game/storyActions.ts). Журнал действий хранится вместе с историей (src/game/repository.ts).

import type { ActiveCondition } from '../engine/conditions'
import type { Character, Equipment, Inventory } from './character'
import type { ChatMessage, RollRecord } from './game'
import type { CellPosition, DoorState, LocationData } from './location'

export const STORY_TONES = ['dark-fantasy', 'light-adventure', 'detective', 'horror'] as const
/** Тон истории — попадёт в системный промт ведущего. */
export type StoryTone = (typeof STORY_TONES)[number]

/** Герой в отряде: его состояние в этой истории (лист, инвентарь, место на карте). */
export interface PartyMember {
  /** id героя из «Моих героев» (совпадает с character.id). */
  heroId: string
  character: Character
  inventory: Inventory
  position: CellPosition
}

/** Факт о мире, который установлен в этой истории. */
export interface WorldFact {
  id: string
  text: string
  at: number
}

export const QUEST_STATUSES = ['active', 'completed', 'failed'] as const
export type QuestStatus = (typeof QUEST_STATUSES)[number]

export interface Quest {
  id: string
  title: string
  status: QuestStatus
  notes: string
}

/** Запись журнала приключения. */
export interface JournalEntry {
  id: string
  at: number
  text: string
}

/** Мир истории. Локации — собственные копии истории: НПС в них двигаются только в этой истории. */
export interface World {
  locations: Record<string, LocationData>
  currentLocationId: string
  /** Состояния дверей: id локации → id двери → состояние. */
  doors: Record<string, Record<string, DoorState>>
  facts: WorldFact[]
  quests: Quest[]
}

export type StoryStatus = 'active' | 'completed'

export interface StoryState {
  id: string
  title: string
  tone: StoryTone
  /** Приключение, с которого началась история (src/data/adventures/). */
  adventureId: string
  status: StoryStatus
  createdAt: number
  /** Время последнего действия. */
  updatedAt: number
  /** Отряд. Пока в нём один герой, но код не должен на это рассчитывать. */
  party: PartyMember[]
  world: World
  journal: JournalEntry[]
  messages: ChatMessage[]
  /** Журнал бросков, новые в конце. */
  rolls: RollRecord[]
}

/** Кто совершил действие. */
export type ActionAuthor =
  | { kind: 'player'; heroId: string }
  | { kind: 'engine' }
  | { kind: 'master' }
  | { kind: 'system' }

/** Что произошло. Всё случайное (id, броски) уже внутри — применение действия детерминировано. */
export type StoryEvent =
  /** История создана: начальное состояние целиком. */
  | { type: 'storyCreated'; seed: StoryState }
  | { type: 'storyRenamed'; title: string }
  | { type: 'storyCompleted' }
  | { type: 'playerSpoke'; heroId: string; messageId: string; text: string }
  | { type: 'masterNarrated'; messageId: string; text: string }
  | { type: 'diceRolled'; roll: RollRecord }
  | { type: 'equipmentChanged'; heroId: string; equipped: Equipment }
  | { type: 'heroRenamed'; heroId: string; name: string }
  | { type: 'conditionsChanged'; heroId: string; conditions: ActiveCondition[] }
  | { type: 'itemsGranted'; heroId: string; items: { itemId: string; quantity: number }[] }
  | { type: 'npcMoved'; locationId: string; npcId: string; to: CellPosition }
  | { type: 'doorChanged'; locationId: string; doorId: string; state: DoorState }
  | { type: 'factRecorded'; fact: WorldFact }
  | { type: 'questUpdated'; quest: Quest }
  | { type: 'journalWritten'; entry: JournalEntry }

export type StoryEventType = StoryEvent['type']

/** Действие: тип, автор и время. По порядку действий однозначно восстанавливается состояние истории. */
export type StoryAction = StoryEvent & {
  id: string
  storyId: string
  /** Порядковый номер действия в истории, с 0. */
  seq: number
  at: number
  author: ActionAuthor
}

/** Краткие сведения об истории — для экрана «Мои истории». */
export interface StoryMeta {
  id: string
  title: string
  tone: StoryTone
  status: StoryStatus
  adventureId: string
  createdAt: number
  /** Когда в последний раз играли (время последнего действия). */
  lastPlayedAt: number
  party: { heroId: string; name: string; className: string; level: number }[]
  locationName: string
  /** Сколько действий в журнале. */
  actionCount: number
}
