/** Точка интереса на карте локации. Координаты — в процентах (0–100) от размеров карты. */
export interface MapPoint {
  id: string
  name: string
  x: number
  y: number
  kind: 'entrance' | 'npc' | 'feature' | 'exit'
}

export interface Location {
  id: string
  name: string
  description: string
  points: MapPoint[]
  /** Позиция игрока на карте, в процентах. */
  player: { x: number; y: number }
}

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
