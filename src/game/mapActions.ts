// Меню действий на карте: что герой может сделать с НПС, предметом, дверью или окном, и текст сообщения ведущему от
// имени героя. «Подойти» ещё и передвигает героя (src/game/heroMove.ts). Чистые функции.
import type { DoorState, MapObjectType } from '../types/location'

export interface MapActionTarget {
  kind: 'npc' | 'object' | 'door' | 'window'
  name: string
  type?: MapObjectType
  doorState?: DoorState
}

/** Предметы, которые можно взять. */
const TAKEABLE: readonly MapObjectType[] = ['item', 'candle', 'torch']

/** Пункты меню действий и текст сообщения ведущему от имени героя. */
export function entityActions(e: MapActionTarget): { id: string; label: string; text: string }[] {
  const quoted = `«${e.name}»`
  const list: { id: string; label: string; text: string }[] = [
    { id: 'approach', label: 'Подойти', text: e.kind === 'npc' ? `Подхожу к ${quoted}.` : `Подхожу ближе: ${quoted}.` },
    { id: 'inspect', label: 'Осмотреть', text: e.kind === 'npc' ? `Присматриваюсь к ${quoted}.` : e.kind === 'door' ? `Осматриваю дверь ${quoted}.` : `Осматриваю: ${quoted}.` },
  ]
  if (e.kind === 'npc') list.push({ id: 'talk', label: 'Поговорить', text: `Заговариваю с ${quoted}.` })
  if (e.kind === 'door')
    list.push(e.doorState === 'open' ? { id: 'close', label: 'Закрыть', text: `Закрываю дверь ${quoted}.` } : { id: 'open', label: 'Открыть', text: `Открываю дверь ${quoted}.` })
  if (e.kind === 'object' && e.type && TAKEABLE.includes(e.type)) list.push({ id: 'take', label: 'Взять', text: `Беру: ${quoted}.` })
  return list
}

