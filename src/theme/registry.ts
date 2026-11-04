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

/**
 * Тема из параметра адреса `?theme=<id>` — временно, чтобы посмотреть тему (например, на телефоне); нигде не сохраняется.
 * Неизвестный id и тема по умолчанию — `null` (остаётся встроенная в index.html тема).
 */
export function themeFromSearch(search: string, list: readonly Theme[] = themes): Theme | null {
  const id = new URLSearchParams(search).get('theme')
  if (!id || id === DEFAULT_THEME_ID) return null
  return list.find((t) => t.id === id) ?? null
}
