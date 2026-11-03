// Смена темы во время работы (на будущее: выбор темы игроком). При загрузке тема уже встроена в index.html.
import { themeCssVars } from './css'
import type { Theme } from './types'

/** Применить тему к документу: переменные задаются на корневом элементе. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement) {
  root.style.colorScheme = theme.colorScheme
  for (const [name, value] of Object.entries(themeCssVars(theme))) root.style.setProperty(name, value)
  root.dataset.theme = theme.id
}
