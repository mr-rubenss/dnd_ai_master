import type { RollResult } from '../engine/dice'
import type { Character, Inventory } from './character'
import type { CellPosition, DoorState } from './location'

export type MessageAuthor = 'master' | 'player' | 'system'

export interface ChatMessage {
  id: string
  author: MessageAuthor
  text: string
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

/** Всё состояние игры. Меняется только через gameReducer (src/game/state.ts). */
export interface GameState {
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
