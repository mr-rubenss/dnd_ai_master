// Настройки оформления в приложении: текущее состояние, свои темы, сохранение в localStorage и применение к документу.
// При загрузке страницы те же настройки уже применил скрипт в index.html (boot.ts) — здесь они только читаются.
import { useSyncExternalStore } from 'react'
import { APPEARANCE_KEY, appearanceBootData, CUSTOM_THEMES_KEY, DEFAULT_APPEARANCE, type AppearanceSettings } from './appearance.ts'
import { bootAppearance } from './boot.ts'
import type { ColorRef } from './contrast.ts'
import {
  customRecord,
  exportThemeFile,
  importThemeFile,
  isCustomThemeId,
  MAX_CUSTOM_THEMES,
  newCustomId,
  readCustomThemes,
  themeFromSettings,
  themeNameProblem,
  withColor,
} from './customThemes.ts'
import { defaultTheme, themes as registryThemes } from './registry.ts'
import type { Theme } from './types.ts'

export interface AppearanceState {
  settings: AppearanceSettings
  /** Действующая тема (с учётом `?theme=`). */
  themeId: string
  /** Тема включена параметром адреса (до первого выбора в панели). */
  preview: boolean
  /** Все темы: реестр, затем свои темы игрока. */
  themes: readonly Theme[]
}

const MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const STORAGE_FULL = 'Не удалось сохранить: хранилище браузера переполнено или недоступно.'

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const systemReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.(MOTION_QUERY).matches

let debugThemes: Theme[] = []
let customThemes: Theme[] = readCustomThemes(storage()?.getItem(CUSTOM_THEMES_KEY) ?? null, defaultTheme)
let themeList: readonly Theme[] = []
let data = appearanceBootData(registryThemes)
let state: AppearanceState
const listeners = new Set<() => void>()

function rebuild() {
  themeList = [...registryThemes, ...debugThemes, ...customThemes]
  data = appearanceBootData(themeList)
}

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

/** Записать в хранилище; false — не получилось (переполнено, приватный режим). */
function write(key: string, value: string | null): boolean {
  try {
    const s = storage()
    if (!s) return false
    if (value === null) s.removeItem(key)
    else s.setItem(key, value)
    return true
  } catch {
    return false
  }
}

const currentSearch = () => (state.preview ? window.location.search : '')

/** Сохранить свои темы и применить оформление заново. */
function commitCustom(next: Theme[], settings: AppearanceSettings = state.settings): string | null {
  if (!write(CUSTOM_THEMES_KEY, JSON.stringify(next.map(customRecord)))) return STORAGE_FULL
  customThemes = next
  rebuild()
  write(APPEARANCE_KEY, JSON.stringify(settings))
  apply(settings, settings.themeId !== state.settings.themeId ? '' : currentSearch())
  return null
}

rebuild()
apply(null, typeof window === 'undefined' ? '' : window.location.search)
window.matchMedia?.(MOTION_QUERY).addEventListener?.('change', () => apply(state.settings, currentSearch()))

export const appearanceStore = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  /** Изменить настройки: применяются сразу и сохраняются на устройстве. Выбор темы отменяет `?theme=`. */
  update(patch: Partial<AppearanceSettings>) {
    const settings = { ...state.settings, ...patch }
    write(APPEARANCE_KEY, JSON.stringify(settings))
    apply(settings, 'themeId' in patch ? '' : currentSearch())
  },
  /** Сбросить к теме по умолчанию и стандартным настройкам (свои темы остаются). */
  reset() {
    write(APPEARANCE_KEY, null)
    apply({ ...DEFAULT_APPEARANCE })
  },

  /** Сохранить текущее оформление как свою тему и выбрать её. Возвращает причину отказа или null. */
  saveCustom(name: string): string | null {
    const problem = themeNameProblem(name)
    if (problem) return problem
    if (customThemes.length >= MAX_CUSTOM_THEMES) return `Своих тем может быть не больше ${MAX_CUSTOM_THEMES}.`
    const base = themeList.find((t) => t.id === state.themeId) ?? defaultTheme
    const theme = themeFromSettings(base, state.settings, newCustomId(), name)
    // Акцент, шрифт и плотность теперь внутри темы — сами настройки возвращаются к значениям темы.
    return commitCustom([...customThemes, theme], { ...state.settings, themeId: theme.id, accent: null, masterFont: null, density: 'normal' })
  },
  renameCustom(id: string, name: string): string | null {
    const problem = themeNameProblem(name)
    if (problem) return problem
    return commitCustom(customThemes.map((t) => (t.id === id ? { ...t, name: name.trim() } : t)))
  },
  /** Удалить свою тему; если она выбрана — вернуться к теме по умолчанию. */
  deleteCustom(id: string): string | null {
    const settings = state.settings.themeId === id ? { ...state.settings, themeId: null } : state.settings
    return commitCustom(
      customThemes.filter((t) => t.id !== id),
      settings,
    )
  },
  /** Изменить цвет токена своей темы — сразу виден на странице. */
  setCustomColor(id: string, ref: ColorRef, value: string): string | null {
    return commitCustom(customThemes.map((t) => (t.id === id ? withColor(t, ref, value) : t)))
  },
  /** Импорт темы из файла (проверка по схеме темы); тема добавляется в свои и выбирается. */
  async importTheme(text: string): Promise<string | null> {
    if (customThemes.length >= MAX_CUSTOM_THEMES) return `Своих тем может быть не больше ${MAX_CUSTOM_THEMES}.`
    let theme: Theme
    try {
      // Схема (zod) нужна только здесь — грузится отдельным файлом по требованию.
      const { parseTheme } = await import('./schema.ts')
      theme = importThemeFile(text, parseTheme, newCustomId())
    } catch (error) {
      return (error as Error).message
    }
    return commitCustom([...customThemes, theme], { ...state.settings, themeId: theme.id })
  },
  exportTheme(id: string) {
    const theme = themeList.find((t) => t.id === id)
    return theme ? exportThemeFile(theme) : null
  },
  isCustom: (id: string) => isCustomThemeId(id) && customThemes.some((t) => t.id === id),

  /** Только для отладки (e2e): добавить тему в реестр на время работы страницы. */
  addDebugTheme(theme: Theme) {
    debugThemes = [...debugThemes.filter((t) => t.id !== theme.id), theme]
    rebuild()
    apply(state.settings, currentSearch())
  },
}

export const useAppearance = () => useSyncExternalStore(appearanceStore.subscribe, appearanceStore.get)

/** Отладочный доступ (e2e-тесты), как `__aiMaster`: флаг localStorage ai-master:debug = 1. */
if (storage()?.getItem('ai-master:debug') === '1') {
  ;(window as unknown as { __aiMasterAppearance: unknown }).__aiMasterAppearance = appearanceStore
}
