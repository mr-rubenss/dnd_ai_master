// Меню действий на карте: что герой может сделать с НПС, предметом, дверью или окном, и текст сообщения ведущему от
// имени героя. «Подойти» ещё и передвигает героя (src/game/heroMove.ts). Чистые функции.
import type { DoorState, MapObjectType } from '../types/location'

export interface MapActionTarget {
  kind: 'npc' | 'object' | 'door' | 'window' | 'exit' | 'place'
  /** Место общей или частичной карты: есть ли у него карта уровнем ниже. */
  placeId?: string
  hasMap?: boolean
  /** Выход в другую локацию (у выхода и у двери, через которую он ведёт) — пункт «Выйти». */
  exitId?: string
  name: string
  type?: MapObjectType
  doorState?: DoorState
}

/** Предметы, которые можно взять. */
const TAKEABLE: readonly MapObjectType[] = ['item', 'candle', 'torch']

/** Пункты меню действий и текст сообщения ведущему от имени героя. */
export function entityActions(e: MapActionTarget): { id: string; label: string; text: string }[] {
  const quoted = `«${e.name}»`
  // Выход: «Выйти» — герой идёт к выходу, и отряд переходит на другую карту (src/game/travel.ts).
  const leave = e.exitId ? [{ id: 'leave', label: 'Выйти', text: `Выхожу: ${quoted}.` }] : []
  // Место на общей или частичной карте: карта уровнем ниже есть — посмотреть её; нет — попросить ведущего (6.2).
  if (e.kind === 'place') return [{ id: 'open-place', label: e.hasMap ? 'Приблизить' : 'Подробнее', text: '' }]
  if (e.kind === 'exit') return [...leave, { id: 'inspect', label: 'Осмотреть', text: `Осматриваю: ${quoted}.` }]
  const list: { id: string; label: string; text: string }[] = [
    { id: 'approach', label: 'Подойти', text: e.kind === 'npc' ? `Подхожу к ${quoted}.` : `Подхожу ближе: ${quoted}.` },
    { id: 'inspect', label: 'Осмотреть', text: e.kind === 'npc' ? `Присматриваюсь к ${quoted}.` : e.kind === 'door' ? `Осматриваю дверь ${quoted}.` : `Осматриваю: ${quoted}.` },
  ]
  if (e.kind === 'npc') list.push({ id: 'talk', label: 'Поговорить', text: `Заговариваю с ${quoted}.` })
  if (e.kind === 'door')
    list.push(e.doorState === 'open' ? { id: 'close', label: 'Закрыть', text: `Закрываю дверь ${quoted}.` } : { id: 'open', label: 'Открыть', text: `Открываю дверь ${quoted}.` })
  if (e.kind === 'object' && e.type && TAKEABLE.includes(e.type)) list.push({ id: 'take', label: 'Взять', text: `Беру: ${quoted}.` })
  return [...list, ...leave]
}

