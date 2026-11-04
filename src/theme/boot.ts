// Применение настроек оформления к документу. Функция САМОДОСТАТОЧНА (без импортов и внешних переменных):
// плагин Vite встраивает её текст (`bootAppearance.toString()`) в index.html, чтобы оформление применилось
// до первой отрисовки, без вспышки другой темы. Та же функция применяет настройки при изменении в панели.
import type { AppearanceSettings, BootData } from './appearance.ts'

/** То, что нужно от корневого элемента (в браузере — document.documentElement). */
export interface BootRoot {
  style: { setProperty(name: string, value: string): void; colorScheme: string; fontSize: string }
  dataset: Record<string, string | undefined>
}

export interface BootEnv {
  root: BootRoot
  /** Хранилище настроек (localStorage); не задано — настройки берутся из `settings`. */
  storage?: { getItem(key: string): string | null } | null
  /** Готовые настройки (из панели) — вместо чтения хранилища. */
  settings?: Partial<AppearanceSettings> | null
  /** location.search: `?theme=<id>` временно включает тему. */
  search?: string
  /** Система просит уменьшить движение. */
  reducedMotion?: boolean
}

export interface BootResult {
  settings: AppearanceSettings
  /** Действующая тема (с учётом `?theme=`). */
  themeId: string
  /** Тема включена параметром адреса, а не настройкой. */
  preview: boolean
}

export function bootAppearance(data: BootData, env: BootEnv): BootResult {
  let raw: unknown = env.settings
  if (raw == null && env.storage) {
    try {
      raw = JSON.parse(env.storage.getItem(data.key) ?? 'null')
    } catch {
      raw = null
    }
  }
  // Свои темы игрока (уже скомпилированные) — из того же хранилища; в приложении они приходят в `data`.
  const themes = { ...data.themes }
  if (env.storage) {
    try {
      const list: unknown = JSON.parse(env.storage.getItem(data.customKey) ?? '[]')
      for (const rec of Array.isArray(list) ? list : []) {
        const id = rec?.theme?.id
        const c = rec?.compiled
        if (typeof id !== 'string' || themes[id] || !c || typeof c.vars !== 'object' || typeof c.compact !== 'object' || !Array.isArray(c.accents)) continue
        const only = (vars: Record<string, unknown>) =>
          Object.fromEntries(Object.entries(vars).filter(([k, v]) => k.startsWith('--') && typeof v === 'string')) as Record<string, string>
        themes[id] = { colorScheme: c.colorScheme === 'light' ? 'light' : 'dark', vars: only(c.vars), compact: only(c.compact), accents: c.accents }
      }
    } catch {
      // Испорченный список своих тем — работаем без них.
    }
  }
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = data.defaults
  const pick = <T>(value: unknown, allowed: readonly unknown[], fallback: T): T => (allowed.includes(value) ? (value as T) : fallback)
  const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)
  const opacity = typeof src.gridOpacity === 'number' && src.gridOpacity >= 0.1 && src.gridOpacity <= 1 ? src.gridOpacity : d.gridOpacity
  const settings: AppearanceSettings = {
    themeId: typeof src.themeId === 'string' && themes[src.themeId] ? src.themeId : null,
    accent: pick(src.accent, Object.keys(data.accents), null),
    masterFont: pick(src.masterFont, Object.keys(data.fonts), null),
    textSize: pick(src.textSize, Object.keys(data.textSizes), d.textSize),
    density: pick(src.density, data.densities, d.density),
    mapGrid: flag(src.mapGrid, d.mapGrid),
    gridOpacity: Math.round(opacity * 100) / 100,
    npcLabels: flag(src.npcLabels, d.npcLabels),
    animations: pick(src.animations, ['system', 'on', 'off'], d.animations),
  }

  const previewId = env.search ? new URLSearchParams(env.search).get('theme') : null
  const preview = !!previewId && !!themes[previewId]
  const themeId = preview ? (previewId as string) : (settings.themeId ?? data.defaultThemeId)
  const theme = themes[themeId]
  const accent = settings.accent && theme.accents.includes(settings.accent) ? data.accents[settings.accent] : {}
  const vars: Record<string, string> = {
    ...theme.vars,
    ...(settings.density === 'compact' ? theme.compact : {}),
    ...accent,
    ...(settings.masterFont ? data.fonts[settings.masterFont] : {}),
    '--pref-grid-opacity': String(settings.gridOpacity),
  }

  const { root } = env
  for (const name of Object.keys(vars)) root.style.setProperty(name, vars[name])
  root.style.colorScheme = theme.colorScheme
  root.style.fontSize = data.textSizes[settings.textSize]
  const reduce = settings.animations === 'system' ? !!env.reducedMotion : settings.animations === 'off'
  root.dataset.theme = themeId
  root.dataset.density = settings.density
  root.dataset.mapGrid = settings.mapGrid ? 'on' : 'off'
  root.dataset.npcLabels = settings.npcLabels ? 'on' : 'off'
  root.dataset.motion = reduce ? 'reduce' : 'full'
  return { settings, themeId, preview }
}
