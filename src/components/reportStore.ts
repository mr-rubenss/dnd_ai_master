// Окно тестового отчёта («Что-то не так»): открыто ли оно и предложение составить отчёт после сбоя.
import { useSyncExternalStore } from 'react'

export interface ReportUiState {
  open: boolean
  /** Сбой, после которого игра сама предлагает отчёт (текст для игрока) — или null. */
  offer: string | null
  /** Что подставить в описание при открытии (например, текст ошибки). */
  hint: string
}

let state: ReportUiState = { open: false, offer: null, hint: '' }
const listeners = new Set<() => void>()
const set = (patch: Partial<ReportUiState>) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export const reportStore = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  open: (hint = '') => set({ open: true, offer: null, hint }),
  close: () => set({ open: false, hint: '' }),
  /** Предложить отчёт после сбоя (если окно уже открыто — не мешать). */
  offer: (reason: string) => {
    if (!state.open) set({ offer: reason })
  },
  dismiss: () => set({ offer: null }),
}

export const useReportUi = () => useSyncExternalStore(reportStore.subscribe, reportStore.get)
