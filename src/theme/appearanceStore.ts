// Настройки оформления в приложении: текущее состояние, сохранение в localStorage и применение к документу.
// При загрузке страницы те же настройки уже применил скрипт в index.html (boot.ts) — здесь они только читаются.
import { useSyncExternalStore } from 'react'
import { APPEARANCE_KEY, appearanceBootData, DEFAULT_APPEARANCE, type AppearanceSettings } from './appearance.ts'
import { bootAppearance } from './boot.ts'
import { themes as registryThemes } from './registry.ts'
import type { Theme } from './types.ts'

export interface AppearanceState {
  settings: AppearanceSettings
  /** Действующая тема (с учётом `?theme=`). */
  themeId: string
  /** Тема включена параметром адреса (до первого выбора в панели). */
  preview: boolean
  /** Все темы реестра. */
  themes: readonly Theme[]
}

const MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const systemReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.(MOTION_QUERY).matches

let themeList: readonly Theme[] = registryThemes
let data = appearanceBootData(themeList)
let state: AppearanceState
const listeners = new Set<() => void>()

function apply(settings: Partial<AppearanceSettings> | null, search = '') {
  const result = bootAppearance(data, {
    root: document.documentElement,
    settings: settings ?? undefined,
    storage: settings ? null : storage(),
    search,
    reducedMotion: systemReducedMotion(),
  })
  state = { ...result, themes: themeList }
  listeners.forEach((l) => l())
}

function save(settings: AppearanceSettings) {
  try {
    storage()?.setItem(APPEARANCE_KEY, JSON.stringify(settings))
  } catch {
    // Хранилище недоступно (приватный режим) — настройка действует до перезагрузки.
  }
}

apply(null, typeof window === 'undefined' ? '' : window.location.search)
window.matchMedia?.(MOTION_QUERY).addEventListener?.('change', () => apply(state.settings, state.preview ? window.location.search : ''))

export const appearanceStore = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  /** Изменить настройки: применяются сразу и сохраняются на устройстве. Выбор темы отменяет `?theme=`. */
  update(patch: Partial<AppearanceSettings>) {
    const settings = { ...state.settings, ...patch }
    save(settings)
    apply(settings, state.preview && !('themeId' in patch) ? window.location.search : '')
  },
  /** Сбросить к теме по умолчанию и стандартным настройкам. */
  reset() {
    try {
      storage()?.removeItem(APPEARANCE_KEY)
    } catch {
      // см. save
    }
    apply({ ...DEFAULT_APPEARANCE })
  },
  /** Только для отладки (e2e): добавить тему в реестр на время работы страницы. */
  addDebugTheme(theme: Theme) {
    themeList = [...themeList.filter((t) => t.id !== theme.id), theme]
    data = appearanceBootData(themeList)
    apply(state.settings, state.preview ? window.location.search : '')
  },
}

export const useAppearance = () => useSyncExternalStore(appearanceStore.subscribe, appearanceStore.get)

/** Отладочный доступ (e2e-тесты), как `__aiMaster`: флаг localStorage ai-master:debug = 1. */
if (storage()?.getItem('ai-master:debug') === '1') {
  ;(window as unknown as { __aiMasterAppearance: unknown }).__aiMasterAppearance = appearanceStore
}
