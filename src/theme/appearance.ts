// Настройки оформления — настройка устройства, а не истории: тема, акцент, шрифт ведущего, размер текста,
// плотность, карта, анимации. Хранятся в localStorage (`APPEARANCE_KEY`) и применяются до первой отрисовки
// встроенным в index.html скриптом (`bootAppearance` из boot.ts, данные — `appearanceBootData`).
import { contrastRatio, over, parseColor } from './contrast.ts'
import { cssVarName, themeCssVars } from './css.ts'
import type { Theme } from './types.ts'

export const APPEARANCE_KEY = 'ai-master:appearance'

/** Акцентные цвета на выбор (вместо акцента темы). */
export const ACCENTS = {
  gold: { name: 'Золото', color: '#c9a45c' },
  ember: { name: 'Янтарь', color: '#d98b4e' },
  jade: { name: 'Нефрит', color: '#6fb48f' },
  azure: { name: 'Лазурь', color: '#79a7d9' },
  amethyst: { name: 'Аметист', color: '#a993d8' },
  silver: { name: 'Серебро', color: '#b9b6b0' },
} as const
export type AccentId = keyof typeof ACCENTS

/** Шрифты текста ведущего — с кириллицей, встроены в сборку (@fontsource, см. main.tsx). */
export const MASTER_FONTS = {
  literata: { name: 'Literata', stack: "'Literata', Georgia, 'Times New Roman', serif" },
  'pt-serif': { name: 'PT Serif', stack: "'PT Serif', Georgia, 'Times New Roman', serif" },
  lora: { name: 'Lora', stack: "'Lora', Georgia, 'Times New Roman', serif" },
  'pt-sans': { name: 'PT Sans', stack: "'PT Sans', system-ui, 'Segoe UI', sans-serif" },
} as const
export type MasterFontId = keyof typeof MASTER_FONTS

/** Размер текста — 4 шага: масштаб корневого шрифта (все размеры текста в rem). */
export const TEXT_SIZES = {
  small: { name: 'Мелкий', scale: '93.75%' },
  normal: { name: 'Обычный', scale: '100%' },
  large: { name: 'Крупный', scale: '112.5%' },
  xlarge: { name: 'Очень крупный', scale: '125%' },
} as const
export type TextSizeId = keyof typeof TEXT_SIZES

export const DENSITIES = { normal: 'Обычная', compact: 'Компактная' } as const
export type DensityId = keyof typeof DENSITIES

/** Компактная плотность: отступы темы × 0.7 (не меньше 1px). */
export const COMPACT_SCALE = 0.7

export interface AppearanceSettings {
  /** null — тема по умолчанию. */
  themeId: string | null
  /** null — акцент темы. */
  accent: AccentId | null
  /** null — шрифт темы. */
  masterFont: MasterFontId | null
  textSize: TextSizeId
  density: DensityId
  mapGrid: boolean
  /** Прозрачность сетки карты: 0.1–1 (1 — как задумано темой). */
  gridOpacity: number
  npcLabels: boolean
  /** system — как в настройке «уменьшить движение» системы. */
  animations: 'system' | 'on' | 'off'
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  themeId: null,
  accent: null,
  masterFont: null,
  textSize: 'normal',
  density: 'normal',
  mapGrid: true,
  gridOpacity: 1,
  npcLabels: true,
  animations: 'system',
}

/** Данные для загрузочного скрипта: всё уже посчитано, скрипт только выбирает и применяет. */
export interface BootData {
  key: string
  defaultThemeId: string
  defaults: AppearanceSettings
  themes: Record<string, { colorScheme: 'dark' | 'light'; vars: Record<string, string>; compact: Record<string, string>; accents: string[] }>
  accents: Record<string, Record<string, string>>
  fonts: Record<string, Record<string, string>>
  textSizes: Record<string, string>
  densities: string[]
}

const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0')

/** Переменные акцента: сам цвет, светлый вариант и полупрозрачные подложки с теми же долями, что в «Тёмном фэнтези». */
export function accentVars(color: string): Record<string, string> {
  const c = parseColor(color)
  const bright = over({ r: 255, g: 255, b: 255, a: 0.3 }, c)
  const rgba = (a: number) => `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`
  return {
    [cssVarName('colors', 'accent')]: color,
    [cssVarName('colors', 'accentBright')]: `#${hex(bright.r)}${hex(bright.g)}${hex(bright.b)}`,
    [cssVarName('colors', 'accentTint')]: rgba(0.1),
    [cssVarName('colors', 'accentTintSelected')]: rgba(0.12),
    [cssVarName('colors', 'accentTintPrimary')]: rgba(0.16),
    [cssVarName('colors', 'accentTintBadge')]: rgba(0.2),
    [cssVarName('colors', 'focusRing')]: rgba(0.2),
  }
}

/** Акценты, с которыми текст на акценте (`onAccent`) этой темы читается по WCAG AA (4.5:1). */
export function accentOptions(theme: Theme): AccentId[] {
  const text = parseColor(theme.colors.onAccent)
  return (Object.keys(ACCENTS) as AccentId[]).filter(
    (id) => contrastRatio(over(text, parseColor(ACCENTS[id].color)), parseColor(ACCENTS[id].color)) >= 4.5,
  )
}

/** Отступы темы в компактной плотности. */
export function compactSpace(theme: Theme): Record<string, string> {
  return Object.fromEntries(
    Object.entries(theme.space).map(([key, value]) => {
      const px = parseFloat(value)
      const unit = value.replace(/^[\d.]+/, '')
      const scaled = unit === 'px' ? `${Math.max(1, Math.round(px * COMPACT_SCALE))}px` : `${+(px * COMPACT_SCALE).toFixed(3)}${unit}`
      return [cssVarName('space', key), scaled]
    }),
  )
}

export function appearanceBootData(themes: readonly Theme[]): BootData {
  return {
    key: APPEARANCE_KEY,
    defaultThemeId: themes[0].id,
    defaults: DEFAULT_APPEARANCE,
    themes: Object.fromEntries(
      themes.map((t) => [t.id, { colorScheme: t.colorScheme, vars: themeCssVars(t), compact: compactSpace(t), accents: accentOptions(t) }]),
    ),
    accents: Object.fromEntries(Object.entries(ACCENTS).map(([id, a]) => [id, accentVars(a.color)])),
    fonts: Object.fromEntries(Object.entries(MASTER_FONTS).map(([id, f]) => [id, { [cssVarName('fonts', 'master')]: f.stack }])),
    textSizes: Object.fromEntries(Object.entries(TEXT_SIZES).map(([id, s]) => [id, s.scale])),
    densities: Object.keys(DENSITIES),
  }
}
