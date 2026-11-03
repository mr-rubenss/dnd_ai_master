// Моковые данные для разработки интерфейса. Позже их заменит состояние игры из движка правил.
import type { ChatMessage, Inventory } from '../../types/game'
import inventoryJson from './inventory.json'
import messagesJson from './messages.json'

export const mockInventory = inventoryJson as Inventory
export const mockMessages = messagesJson as ChatMessage[]
