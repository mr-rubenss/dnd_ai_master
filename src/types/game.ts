import type { Character, Inventory } from './character'
import type { CellPosition } from './location'

export type MessageAuthor = 'master' | 'player' | 'system'

export interface ChatMessage {
  id: string
  author: MessageAuthor
  text: string
}

/** Всё состояние игры. Меняется только через gameReducer (src/game/state.ts). */
export interface GameState {
  character: Character
  inventory: Inventory
  location: {
    id: string
    player: CellPosition
  }
  messages: ChatMessage[]
}
