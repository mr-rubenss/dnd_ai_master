import { describe, expect, it } from 'vitest'
import { ACCENTS, accentOptions, accentVars, APPEARANCE_KEY, appearanceBootData, compactSpace, DEFAULT_APPEARANCE, MASTER_FONTS } from './appearance'
import { bootAppearance, type BootEnv } from './boot'
import { contrastRatio, parseColor } from './contrast'
import { darkFantasy } from './darkFantasy'
import type { Theme } from './types'

const sepia: Theme = { ...structuredClone(darkFantasy), id: 'sepia', name: 'Сепия', colorScheme: 'light' }
sepia.colors.bg = '#f3e9d2'
const data = appearanceBootData([darkFantasy, sepia])

/** Корневой элемент-заглушка: запоминает переменные, схему, размер шрифта и data-атрибуты. */
function fakeRoot() {
  const vars: Record<string, string> = {}
  return {
    vars,
    style: { setProperty: (n: string, v: string) => void (vars[n] = v), colorScheme: '', fontSize: '' },
    dataset: {} as Record<string, string | undefined>,
  }
}
const storageWith = (value: unknown) => ({
  getItem: (key: string) => (key === APPEARANCE_KEY ? (typeof value === 'string' ? value : JSON.stringify(value)) : null),
})
const boot = (env: Omit<BootEnv, 'root'>, root = fakeRoot()) => ({ root, result: bootAppearance(data, { root, ...env }) })

describe('загрузочный скрипт оформления', () => {
  it('самодостаточен: его текст работает отдельно (так он встроен в index.html)', () => {
    const standalone = new Function(`return (${bootAppearance.toString()})`)() as typeof bootAppearance
    const root = fakeRoot()
    expect(standalone(data, { root, storage: storageWith({ accent: 'jade' }) }).settings.accent).toBe('jade')
    expect(root.vars['--color-accent']).toBe(ACCENTS.jade.color)
  })

  it('без настроек — тема по умолчанию и стандартные значения', () => {
    const { root, result } = boot({ storage: storageWith(null) })
    expect(result).toEqual({ settings: DEFAULT_APPEARANCE, themeId: 'dark-fantasy', preview: false })
    expect(root.vars['--color-bg']).toBe('#0f0c0a')
    expect(root.vars['--space-12']).toBe('12px')
    expect(root.vars['--pref-grid-opacity']).toBe('1')
    expect(root.style.fontSize).toBe('100%')
    expect(root.style.colorScheme).toBe('dark')
    expect(root.dataset).toEqual({ theme: 'dark-fantasy', density: 'normal', mapGrid: 'on', npcLabels: 'on', motion: 'full' })
  })

  it('битые и чужие значения в хранилище заменяются стандартными', () => {
    expect(boot({ storage: storageWith('{не json') }).result.settings).toEqual(DEFAULT_APPEARANCE)
    const odd = {
      themeId: 'нет-такой',
      accent: 'pink',
      masterFont: 'comic',
      textSize: 'huge',
      density: 9,
      mapGrid: 'да',
      gridOpacity: 5,
      npcLabels: null,
      animations: 'sometimes',
    }
    expect(boot({ storage: storageWith(odd) }).result.settings).toEqual(DEFAULT_APPEARANCE)
    expect(
      boot({
        storage: {
          getItem: () => {
            throw new Error('доступ запрещён')
          },
        },
      }).result.settings,
    ).toEqual(DEFAULT_APPEARANCE)
  })

  it('сохранённые настройки применяются: тема, акцент, шрифт, размер, плотность, карта, анимации', () => {
    const settings = {
      themeId: 'sepia',
      accent: 'azure',
      masterFont: 'pt-serif',
      textSize: 'xlarge',
      density: 'compact',
      mapGrid: false,
      gridOpacity: 0.4,
      npcLabels: false,
      animations: 'off',
    }
    const { root, result } = boot({ storage: storageWith(settings) })
    expect(result.settings).toEqual(settings)
    expect(result.themeId).toBe('sepia')
    expect(root.vars['--color-bg']).toBe('#f3e9d2')
    expect(root.style.colorScheme).toBe('light')
    expect(root.vars['--color-accent']).toBe(ACCENTS.azure.color)
    expect(root.vars['--font-master']).toBe(MASTER_FONTS['pt-serif'].stack)
    expect(root.style.fontSize).toBe('125%')
    expect(root.vars['--space-12']).toBe('8px')
    expect(root.vars['--pref-grid-opacity']).toBe('0.4')
    expect(root.dataset).toEqual({ theme: 'sepia', density: 'compact', mapGrid: 'off', npcLabels: 'off', motion: 'reduce' })
  })

  it('анимации: по умолчанию — как в системе, иначе — выбор игрока', () => {
    expect(boot({ settings: {}, reducedMotion: true }).root.dataset.motion).toBe('reduce')
    expect(boot({ settings: {}, reducedMotion: false }).root.dataset.motion).toBe('full')
    expect(boot({ settings: { animations: 'on' }, reducedMotion: true }).root.dataset.motion).toBe('full')
    expect(boot({ settings: { animations: 'off' }, reducedMotion: false }).root.dataset.motion).toBe('reduce')
  })

  it('?theme=<id> временно включает тему поверх сохранённой; неизвестная — игнорируется', () => {
    const preview = boot({ storage: storageWith({ themeId: 'dark-fantasy' }), search: '?theme=sepia' })
    expect(preview.result).toMatchObject({ themeId: 'sepia', preview: true, settings: { themeId: 'dark-fantasy' } })
    expect(boot({ storage: storageWith({ themeId: 'sepia' }), search: '?theme=нет' }).result).toMatchObject({ themeId: 'sepia', preview: false })
  })

  it('акцент, нечитаемый с текстом темы, не применяется', () => {
    const pale: Theme = { ...structuredClone(darkFantasy), id: 'pale' }
    pale.colors.onAccent = '#ffffff'
    const paleData = appearanceBootData([pale])
    expect(paleData.themes.pale.accents).toEqual([])
    const root = fakeRoot()
    bootAppearance(paleData, { root, settings: { accent: 'silver' } })
    expect(root.vars['--color-accent']).toBe(darkFantasy.colors.accent)
  })
})

describe('данные оформления', () => {
  it('все акценты читаемы на «Тёмном фэнтези» (текст на акценте ≥ 4.5:1)', () => {
    expect(accentOptions(darkFantasy)).toEqual(Object.keys(ACCENTS))
    for (const { color } of Object.values(ACCENTS)) {
      expect(contrastRatio(parseColor(darkFantasy.colors.onAccent), parseColor(color))).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('акцент: светлый вариант и подложки с прозрачностью', () => {
    expect(accentVars('#c9a45c')).toEqual({
      '--color-accent': '#c9a45c',
      '--color-accent-bright': '#d9bf8d',
      '--color-accent-tint': 'rgba(201, 164, 92, 0.1)',
      '--color-accent-tint-selected': 'rgba(201, 164, 92, 0.12)',
      '--color-accent-tint-primary': 'rgba(201, 164, 92, 0.16)',
      '--color-accent-tint-badge': 'rgba(201, 164, 92, 0.2)',
      '--color-focus-ring': 'rgba(201, 164, 92, 0.2)',
    })
  })

  it('компактная плотность: отступы × 0.7, не меньше 1px', () => {
    const compact = compactSpace(darkFantasy)
    expect(compact['--space-1']).toBe('1px')
    expect(compact['--space-10']).toBe('7px')
    expect(compact['--space-48']).toBe('34px')
    expect(Object.keys(compact)).toHaveLength(Object.keys(darkFantasy.space).length)
  })

  it('шрифты ведущего — 4, с запасными семействами', () => {
    expect(Object.values(MASTER_FONTS).map((f) => f.name)).toEqual(['Literata', 'PT Serif', 'Lora', 'PT Sans'])
    expect(data.fonts.lora).toEqual({ '--font-master': MASTER_FONTS.lora.stack })
  })
})
