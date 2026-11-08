// Журнал разработчика: что уходит модели и как работает память ведущего — размер каждой части запроса,
// сколько токенов пришло из кэша поставщика, когда и сколько сжато. Только в памяти вкладки (до перезагрузки),
// без текстов сообщений и без ключа. Показывается в «Настройки» → «Ведущий» → «Журнал разработчика».
import { useSyncExternalStore } from 'react'
import type { AttemptReport } from '../ai/timed'
import type { RequestReport } from './masterTurn'

export type DevLogEntry =
  | ({ kind: 'request'; id: number; at: number; model: string } & RequestReport)
  | {
      kind: 'compaction'
      id: number
      at: number
      model: string
      reason: 'budget' | 'context-error' | 'size'
      compacted: number
      tokensBefore: number
      tokensAfter: number
      summaryChars: number
      factsAdded: number
      resummarized: boolean
      factsMerged: boolean
    }
  | { kind: 'error'; id: number; at: number; text: string }
  /** Вызов инструмента ведущим и его итог (без аргументов целиком — только итог движка). */
  | { kind: 'tool'; id: number; at: number; name: string; ok: boolean; detail: string }
  /** Одна попытка запроса к модели: длительность, размеры, «размышления», чем кончилась. */
  | ({ kind: 'attempt'; id: number; at: number; purpose: string; model: string } & AttemptReport)
  /** Сверка end_turn за ход. */
  | { kind: 'verify'; id: number; at: number; status: 'ok' | 'fixed' | 'unresolved'; problems?: string[] }
  /** Сверка текста с состоянием: рассказ утверждал то, чего нет в игре, — ведущего попросили исправить. */
  | { kind: 'claims'; id: number; at: number; problems: string[] }
  /** Событие карты: значимое перемещение героя ушло ведущему (или пропущено из-за паузы между реакциями). */
  | { kind: 'map'; id: number; at: number; rules: string[]; sent: boolean }

type NewEntry = DevLogEntry extends infer E ? (E extends DevLogEntry ? Omit<E, 'id' | 'at'> : never) : never

export const DEV_LOG_LIMIT = 100

let entries: DevLogEntry[] = []
let nextId = 1
const listeners = new Set<() => void>()

export const devLog = {
  get: () => entries,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  add(entry: NewEntry, at = Date.now()) {
    entries = [...entries, { ...entry, id: nextId++, at } as DevLogEntry].slice(-DEV_LOG_LIMIT)
    listeners.forEach((l) => l())
  },
  clear() {
    entries = []
    listeners.forEach((l) => l())
  },
}

export const useDevLog = () => useSyncExternalStore(devLog.subscribe, devLog.get, devLog.get)
