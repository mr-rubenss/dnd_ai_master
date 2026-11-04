// Контраст цветов темы по WCAG 2.x. Чистые функции; используются тестом `contrast.test.ts`.
import type { Theme } from './types.ts'

/** Цвет в sRGB: каналы 0–255, прозрачность 0–1. */
export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

/** Разбирает цвет темы: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba(), hsl()/hsla(). */
export function parseColor(value: string): Rgba {
  const v = value.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3,8})$/.exec(v)
  if (hex && [3, 4, 6, 8].includes(hex[1].length)) {
    const h = hex[1].length <= 4 ? [...hex[1]].map((c) => c + c).join('') : hex[1]
    const n = (i: number) => parseInt(h.slice(i * 2, i * 2 + 2), 16)
    return { r: n(0), g: n(1), b: n(2), a: h.length === 8 ? n(3) / 255 : 1 }
  }
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(v)
  if (!fn) throw new Error(`Не удалось разобрать цвет «${value}»`)
  const parts = fn[2].split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3 || parts.length > 4) throw new Error(`Не удалось разобрать цвет «${value}»`)
  const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])
  if (fn[1].startsWith('rgb')) {
    const ch = (p: string) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p))
    return { r: ch(parts[0]), g: ch(parts[1]), b: ch(parts[2]), a: alpha }
  }
  const [h, s, l] = [parseFloat(parts[0]), parseFloat(parts[1]) / 100, parseFloat(parts[2]) / 100]
  const k = (n: number) => (n + h / 30) % 12
  const f = (n: number) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255, a: alpha }
}

/** Цвет `top`, положенный поверх непрозрачного `bottom`. */
export function over(top: Rgba, bottom: Rgba): Rgba {
  const mix = (t: number, b: number) => t * top.a + b * (1 - top.a)
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 }
}

/** Относительная яркость по WCAG. */
export function luminance({ r, g, b }: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** Коэффициент контраста двух непрозрачных цветов (1–21). */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Ссылка на цвет темы: группа и ключ. */
export type ColorRef = readonly ['colors', keyof Theme['colors']] | readonly ['map', keyof Theme['map']] | readonly ['dice', keyof Theme['dice']]

/** Пары «текст на фоне», которые должны читаться. */
export const CONTRAST_PAIRS: readonly (readonly [ColorRef, ColorRef])[] = [
  [['colors', 'fg'], ['colors', 'bg']],
  [['colors', 'fg'], ['colors', 'panel']],
  [['colors', 'fg'], ['colors', 'panelRaised']],
  [['colors', 'fg'], ['colors', 'masterBg']],
  [['colors', 'muted'], ['colors', 'bg']],
  [['colors', 'muted'], ['colors', 'panel']],
  [['colors', 'playerFg'], ['colors', 'playerBg']],
  [['colors', 'playerAuthor'], ['colors', 'playerBg']],
  [['colors', 'systemFg'], ['colors', 'bg']],
  [['colors', 'systemFg'], ['colors', 'panel']],
  [['colors', 'onAccent'], ['colors', 'accent']],
  [['colors', 'onPrimary'], ['colors', 'danger']],
  [['colors', 'onPrimary'], ['colors', 'dangerBright']],
  [['colors', 'dangerText'], ['colors', 'panel']],
  [['dice', 'nat20Text'], ['dice', 'nat20']],
  [['dice', 'nat1Text'], ['dice', 'nat1']],
  [['map', 'npcInitial'], ['map', 'npcFriendly']],
  [['map', 'npcInitial'], ['map', 'npcNeutral']],
  [['map', 'npcInitial'], ['map', 'npcHostile']],
  [['map', 'playerLabel'], ['map', 'playerFill']],
  [['map', 'npcLabel'], ['map', 'npcLabelOutline']],
]

/** Порог WCAG: AA для обычного текста — 4.5:1; тема `high-contrast` — AAA, 7:1. */
export const requiredContrast = (theme: Theme) => (theme.id === 'high-contrast' ? 7 : 4.5)

const colorOf = (theme: Theme, [group, key]: ColorRef) => (theme[group] as Record<string, string>)[key]

export interface PairContrast {
  text: string
  background: string
  ratio: number
  required: number
}

/**
 * Контраст всех пар темы. Полупрозрачный фон кладётся на фон страницы (`colors.bg`, сам он — на чёрный),
 * полупрозрачный текст — на получившийся фон: считается итоговый цвет, который видит игрок.
 */
export function themeContrast(theme: Theme): PairContrast[] {
  const page = over(parseColor(theme.colors.bg), { r: 0, g: 0, b: 0, a: 1 })
  const required = requiredContrast(theme)
  return CONTRAST_PAIRS.map(([text, background]) => {
    const bg = over(parseColor(colorOf(theme, background)), page)
    const fg = over(parseColor(colorOf(theme, text)), bg)
    return { text: text.join('.'), background: background.join('.'), ratio: contrastRatio(fg, bg), required }
  })
}
