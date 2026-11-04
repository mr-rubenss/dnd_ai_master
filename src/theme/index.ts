// Тема оформления: один объект → CSS-переменные. Реестр тем — registry.ts.
export { ACCENTS, DEFAULT_APPEARANCE, MASTER_FONTS, TEXT_SIZES, type AppearanceSettings } from './appearance'
export { appearanceStore, useAppearance } from './appearanceStore'
export { cssVarName, themeCss, themeCssVars, token } from './css'
export { DEFAULT_THEME_ID, defaultTheme, themeById, themes } from './registry'
export type { Theme } from './types'
