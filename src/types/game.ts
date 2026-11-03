import type { RollResult } from '../engine/dice'
import type { Character, Inventory } from './character'
import type { CellPosition, DoorState } from './location'

export type MessageAuthor = 'master' | 'player' | 'system'

export interface ChatMessage {
  id: string
  author: MessageAuthor
  text: string
  /** Чья реплика (для сообщений игрока в отряде из нескольких героев). */
  heroId?: string
}

/** Запись в журнале бросков. */
export interface RollRecord {
  id: string
  /** Что бросали: «Атака», «Мудрость (Внимательность)» и т. п. */
  label?: string
  /** Время броска, мс с начала эпохи. */
  timestamp: number
  result: RollResult
}

/** Прохождение истории в старом формате сохранения (v8, localStorage) — только для переноса. */
export interface StoryProgress {
  /** id прохождения (уникален для каждой начатой игры). */
  id: string
  /** id истории из данных (src/data/story.json). */
  storyId: string
  title: string
  /** Герой истории — id персонажа. */
  heroId: string
  startedAt: number
}

/**
 * Состояние игры старого формата (одно сохранение в localStorage, до историй).
 * Нужно только для переноса старых сохранений (src/game/legacyImport.ts).
 */
export interface GameState {
  story: StoryProgress
  character: Character
  inventory: Inventory
  location: {
    id: string
    player: CellPosition
    /** Текущее состояние каждой двери локации по id (открыта/закрыта/заперта). */
    doors: Record<string, DoorState>
  }
  messages: ChatMessage[]
  /** Журнал бросков, новые в конце. */
  rolls: RollRecord[]
}
