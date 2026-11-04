// Свои темы игрока: сохранить текущее оформление как тему, править основные цвета, проверять читаемость,
// экспорт/импорт JSON (тот же формат, что у тем дизайнера). Чистые функции; хранение — appearanceStore.ts.
import { accentPalette, ACCENTS, compactSpaceValues, compileTheme, MASTER_FONTS, type AppearanceSettings, type CompiledTheme } from './appearance.ts'
import { CONTRAST_PAIRS, themeContrast, type ColorRef } from './contrast.ts'
import type { Theme } from './types.ts'

export const MAX_CUSTOM_THEMES = 20
export const MAX_THEME_NAME_LENGTH = 40
/** id своих тем начинаются с этого префикса (схема темы: латиница, цифры, дефис). */
export const CUSTOM_PREFIX = 'custom-'

/** Своя тема в хранилище: исходник (для правки и экспорта) и готовые переменные (для загрузочного скрипта). */
export interface CustomThemeRecord {
  theme: Theme
  compiled: CompiledTheme
}

export const customRecord = (theme: Theme): CustomThemeRecord => ({ theme, compiled: compileTheme(theme) })

export const newCustomId = (random: () => number = Math.random) => `${CUSTOM_PREFIX}${Date.now().toString(36)}${Math.floor(random() * 36 ** 4).toString(36)}`

export const isCustomThemeId = (id: string) => id.startsWith(CUSTOM_PREFIX)

/** Проблема с названием темы или null. */
export function themeNameProblem(name: string): string | null {
  const n = name.trim()
  if (!n) return 'Введите название темы.'
  if (n.length > MAX_THEME_NAME_LENGTH) return `Название — не длиннее ${MAX_THEME_NAME_LENGTH} символов.`
  return null
}

/**
 * Тема из текущего оформления: акцент, шрифт ведущего и плотность «запекаются» в токены.
 * Размер текста, карта и анимации — настройки устройства, в тему не входят.
 */
export function themeFromSettings(base: Theme, settings: AppearanceSettings, id: string, name: string): Theme {
  const theme: Theme = structuredClone(base)
  theme.id = id
  theme.name = name.trim()
  if (settings.accent) Object.assign(theme.colors, accentPalette(accentColorOf(settings.accent)))
  if (settings.masterFont) theme.fonts.master = MASTER_FONTS[settings.masterFont].stack
  if (settings.density === 'compact') theme.space = compactSpaceValues(base)
  return theme
}

const accentColorOf = (id: NonNullable<AppearanceSettings['accent']>) => ACCENTS[id].color

/** Основные токены для редактора цветов. */
export const EDITABLE_COLORS: readonly { ref: ColorRef; label: string; group: 'Интерфейс' | 'Карта' }[] = [
  { ref: ['colors', 'bg'], label: 'Фон', group: 'Интерфейс' },
  { ref: ['colors', 'fg'], label: 'Текст', group: 'Интерфейс' },
  { ref: ['colors', 'muted'], label: 'Приглушённый текст', group: 'Интерфейс' },
  { ref: ['colors', 'accent'], label: 'Акцент', group: 'Интерфейс' },
  { ref: ['colors', 'panel'], label: 'Панели', group: 'Интерфейс' },
  { ref: ['colors', 'panelRaised'], label: 'Шапки панелей', group: 'Интерфейс' },
  { ref: ['colors', 'border'], label: 'Рамки', group: 'Интерфейс' },
  { ref: ['colors', 'masterBg'], label: 'Реплики ведущего', group: 'Интерфейс' },
  { ref: ['map', 'background'], label: 'Фон карты', group: 'Карта' },
  { ref: ['map', 'floorWood'], label: 'Пол: дерево', group: 'Карта' },
  { ref: ['map', 'floorStone'], label: 'Пол: камень', group: 'Карта' },
  { ref: ['map', 'wallStone'], label: 'Стены', group: 'Карта' },
  { ref: ['map', 'door'], label: 'Двери', group: 'Карта' },
]

/** Тема с новым цветом токена. Акцент тянет за собой светлый вариант и подложки; пол — свой «чередующийся» оттенок. */
export function withColor(theme: Theme, [group, key]: ColorRef, value: string): Theme {
  const next: Theme = structuredClone(theme)
  if (group === 'colors' && key === 'accent') Object.assign(next.colors, accentPalette(value))
  else (next[group] as Record<string, string>)[key] = value
  if (group === 'map' && (key === 'floorWood' || key === 'floorStone')) {
    ;(next.map as Record<string, string>)[`${key}Alt`] = value
  }
  return next
}

/** Названия токенов для предупреждений о контрасте. */
const TOKEN_LABELS: Record<string, string> = {
  'colors.fg': 'текст',
  'colors.bg': 'фон',
  'colors.panel': 'панель',
  'colors.panelRaised': 'шапка панели',
  'colors.masterBg': 'реплика ведущего',
  'colors.muted': 'приглушённый текст',
  'colors.playerFg': 'текст игрока',
  'colors.playerAuthor': 'имя игрока',
  'colors.playerBg': 'реплика игрока',
  'colors.systemFg': 'системный текст',
  'colors.onAccent': 'текст на акценте',
  'colors.accent': 'акцент',
  'colors.onPrimary': 'текст кнопки',
  'colors.danger': 'кнопка',
  'colors.dangerBright': 'кнопка (светлая часть)',
  'colors.dangerText': 'текст ошибки',
  'dice.nat20Text': 'число натуральной 20',
  'dice.nat20': 'подсветка натуральной 20',
  'dice.nat1Text': 'число натуральной 1',
  'dice.nat1': 'подсветка натуральной 1',
  'map.npcInitial': 'буква на фишке НПС',
  'map.npcFriendly': 'дружелюбный НПС',
  'map.npcNeutral': 'нейтральный НПС',
  'map.npcHostile': 'враждебный НПС',
  'map.playerLabel': 'подпись героя',
  'map.playerFill': 'фишка героя',
  'map.npcLabel': 'имя НПС',
  'map.npcLabelOutline': 'обводка имени НПС',
}

export interface ReadabilityWarning {
  text: string
  ratio: number
  required: number
}

/** Пары «текст на фоне» ниже порога WCAG AA (у темы high-contrast — 7:1), с понятными названиями. */
export function readabilityWarnings(theme: Theme): ReadabilityWarning[] {
  return themeContrast(theme)
    .filter((p) => p.ratio < p.required)
    .map((p) => ({ text: `${TOKEN_LABELS[p.text] ?? p.text} на фоне «${TOKEN_LABELS[p.background] ?? p.background}»`, ratio: p.ratio, required: p.required }))
}

/** Все пары контраста имеют понятные названия (проверяется тестом). */
export const contrastLabelsComplete = () => CONTRAST_PAIRS.every(([a, b]) => TOKEN_LABELS[a.join('.')] && TOKEN_LABELS[b.join('.')])

/** Файл для экспорта: тот же формат, что у тем дизайнера (design/themes/<id>.json). */
export function exportThemeFile(theme: Theme): { filename: string; text: string } {
  return { filename: `${theme.id}.json`, text: `${JSON.stringify(theme, null, 2)}\n` }
}

/** Разбор файла темы: JSON и схема темы (parseTheme). Импортированная тема получает новый id своей темы. */
export function importThemeFile(text: string, parse: (data: unknown) => Theme, id: string): Theme {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('Файл не похож на тему: это не JSON.')
  }
  const theme = parse(data)
  const problem = themeNameProblem(theme.name)
  return { ...theme, id, name: problem ? 'Импортированная тема' : theme.name.trim() }
}

/** Свои темы из хранилища: только записи с корректной темой (структура проверяется по набору токенов эталона). */
export function readCustomThemes(raw: string | null, reference: Theme): Theme[] {
  let list: unknown
  try {
    list = JSON.parse(raw ?? '[]')
  } catch {
    return []
  }
  if (!Array.isArray(list)) return []
  const sameKeys = (a: unknown, b: object) => !!a && typeof a === 'object' && Object.keys(b).every((k) => typeof (a as Record<string, unknown>)[k] === 'string')
  return list
    .map((rec) => (rec as CustomThemeRecord | null)?.theme)
    .filter(
      (t): t is Theme =>
        !!t &&
        typeof t.id === 'string' &&
        isCustomThemeId(t.id) &&
        typeof t.name === 'string' &&
        (t.colorScheme === 'dark' || t.colorScheme === 'light') &&
        (['colors', 'map', 'dice', 'fonts', 'fontSizes', 'space', 'radii', 'shadows'] as const).every((g) => sameKeys(t[g], reference[g])),
    )
}
