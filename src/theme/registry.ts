// Реестр тем оформления: «Тёмное фэнтези» (по умолчанию) и темы дизайнера из design/themes/,
// которые плагин Vite проверил при сборке (виртуальный модуль `virtual:design-themes`).
import designThemes from 'virtual:design-themes'
import { darkFantasy } from './darkFantasy.ts'
import type { Theme } from './types.ts'

export const DEFAULT_THEME_ID = darkFantasy.id

/** Все темы: сначала тема по умолчанию, затем темы дизайнера по имени файла. */
export const themes: readonly Theme[] = [darkFantasy, ...designThemes]

export const defaultTheme: Theme = darkFantasy

export const themeById = (id: string): Theme | undefined => themes.find((t) => t.id === id)
