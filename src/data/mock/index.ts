// Моковые данные для разработки интерфейса. Позже их заменит состояние игры из движка правил.
import type { ChatMessage, Inventory, Location } from '../../types/game'
import inventoryJson from './inventory.json'
import locationJson from './location.json'
import messagesJson from './messages.json'

export const mockLocation = locationJson as Location
export const mockInventory = inventoryJson as Inventory
export const mockMessages = messagesJson as ChatMessage[]
