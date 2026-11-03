// Тема → CSS-переменные. Стили и компоненты берут оформление только из этих переменных.
import type { Theme } from './types.ts'

/** Группы токенов темы и префиксы их CSS-переменных. */
export const TOKEN_GROUPS = {
  colors: 'color',
  map: 'map',
  dice: 'dice',
  fonts: 'font',
  fontSizes: 'text',
  space: 'space',
  radii: 'radius',
  shadows: 'shadow',
} as const satisfies Record<string, string>

export type TokenGroup = keyof typeof TOKEN_GROUPS

const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

/** Имя CSS-переменной токена: `cssVarName('colors', 'panelRaised')` → `--color-panel-raised`. */
export const cssVarName = (group: TokenGroup, key: string) => `--${TOKEN_GROUPS[group]}-${kebab(key)}`

/** Ссылка на токен для стилей в коде: `token('map', 'fireGlow')` → `var(--map-fire-glow)`. */
export const token = (group: TokenGroup, key: string) => `var(${cssVarName(group, key)})`

/** Все CSS-переменные темы. */
export function themeCssVars(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const group of Object.keys(TOKEN_GROUPS) as TokenGroup[]) {
    for (const [key, value] of Object.entries(theme[group])) vars[cssVarName(group, key)] = value
  }
  return vars
}

/** Тема как правило `:root { … }`. */
export function themeCss(theme: Theme): string {
  const lines = Object.entries(themeCssVars(theme)).map(([name, value]) => `  ${name}: ${value};`)
  return `:root {\n  color-scheme: ${theme.colorScheme};\n${lines.join('\n')}\n}\n`
}
