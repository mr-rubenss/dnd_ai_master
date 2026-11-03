export interface InventoryItem {
  id: string
  name: string
  quantity: number
  weight: number
  category: 'weapon' | 'armor' | 'gear' | 'consumable' | 'treasure'
  equipped?: boolean
}

export interface Inventory {
  gold: number
  items: InventoryItem[]
}

export type MessageAuthor = 'master' | 'player' | 'system'

export interface ChatMessage {
  id: string
  author: MessageAuthor
  text: string
}
