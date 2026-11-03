// Тема оформления: один объект → CSS-переменные. Сейчас тема одна — «Тёмное фэнтези».
import { darkFantasy } from './darkFantasy'
import { parseTheme } from './schema'

export { applyTheme } from './apply'
export { cssVarName, themeCss, themeCssVars, token } from './css'
export { parseTheme, themeSchema } from './schema'
export type { Theme } from './types'

/** Тема по умолчанию (проверена схемой при загрузке). */
export const defaultTheme = parseTheme(darkFantasy)
