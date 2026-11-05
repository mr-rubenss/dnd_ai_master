// Настройки ведущего в приложении: хранение в localStorage браузера игрока и подписка для React.
// Ключ API — отдельная запись хранилища; он нигде не логируется и не попадает в сообщения об ошибках.
import { useSyncExternalStore } from 'react'
import { AI_SETTINGS_KEY, API_KEY_STORAGE, parseAiSettings, type AiSettings } from './settings.ts'

export interface AiSettingsState {
  settings: AiSettings
  apiKey: string
}

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function read(): AiSettingsState {
  const s = storage()
  let apiKey = ''
  let raw: string | null = null
  try {
    raw = s?.getItem(AI_SETTINGS_KEY) ?? null
    apiKey = s?.getItem(API_KEY_STORAGE) ?? ''
  } catch {
    // хранилище недоступно
  }
  return { settings: parseAiSettings(raw), apiKey }
}

let state: AiSettingsState = read()
const listeners = new Set<() => void>()

function write(key: string, value: string | null) {
  try {
    if (value === null || value === '') storage()?.removeItem(key)
    else storage()?.setItem(key, value)
  } catch {
    // приватный режим — настройка действует до перезагрузки
  }
}

export const aiSettingsStore = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  update(patch: Partial<AiSettings>) {
    state = { ...state, settings: { ...state.settings, ...patch } }
    write(AI_SETTINGS_KEY, JSON.stringify(state.settings))
    listeners.forEach((l) => l())
  },
  setApiKey(apiKey: string) {
    state = { ...state, apiKey }
    write(API_KEY_STORAGE, apiKey.trim())
    listeners.forEach((l) => l())
  },
}

export const useAiSettings = () => useSyncExternalStore(aiSettingsStore.subscribe, aiSettingsStore.get)
