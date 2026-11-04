import { describe, expect, it } from 'vitest'
import { cssVarName, themeCss, themeCssVars, token } from './css'
import { darkFantasy } from './darkFantasy'
import { defaultTheme } from './registry'
import { findRawColors } from './rawColors'
import { parseTheme } from './schema'

const styles = import.meta.glob(['../**/*.{css,ts,tsx}', '!./**', '!../**/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/** Переменные, которые задаёт не тема: размер карты в клетках (компонент) и прозрачность сетки (панель оформления). */
const LOCAL_VARS = new Set(['--board-w', '--board-h', '--pref-grid-opacity'])

/** Все переменные, на которые ссылаются стили и компоненты. */
function usedVars(): Set<string> {
  const used = new Set<string>()
  for (const source of Object.values(styles)) {
    for (const m of source.matchAll(/var\((--[\w-]+)/g)) used.add(m[1])
    for (const m of source.matchAll(/token\('(\w+)', '([\w-]+)'\)/g)) used.add(cssVarName(m[1] as Parameters<typeof cssVarName>[0], m[2]))
  }
  return used
}

describe('тема «Тёмное фэнтези»', () => {
  it('проходит схему и используется по умолчанию', () => {
    expect(parseTheme(darkFantasy)).toEqual(darkFantasy)
    expect(defaultTheme.id).toBe('dark-fantasy')
    expect(defaultTheme.name).toBe('Тёмное фэнтези')
    expect(defaultTheme.colorScheme).toBe('dark')
  })

  it('прежние цвета, шрифты и скругление сохранены', () => {
    const vars = themeCssVars(darkFantasy)
    expect(vars['--color-bg']).toBe('#0f0c0a')
    expect(vars['--color-accent']).toBe('#c9a45c')
    expect(vars['--color-danger']).toBe('#8e2a22')
    expect(vars['--font-display']).toBe("'Cormorant Garamond', Georgia, serif")
    expect(vars['--radius-lg']).toBe('6px')
    expect(vars['--space-12']).toBe('12px')
    expect(vars['--text-85']).toBe('0.85rem')
  })

  it('в самой теме цвета есть только в цветовых группах и тенях', () => {
    const { fonts, fontSizes, space, radii } = darkFantasy
    expect(findRawColors(JSON.stringify({ fonts, fontSizes, space, radii }), 'code')).toEqual([])
  })
})

describe('CSS-переменные темы', () => {
  it('имена: группа и ключ в kebab-case', () => {
    expect(cssVarName('colors', 'panelRaised')).toBe('--color-panel-raised')
    expect(cssVarName('map', 'floorWoodAlt')).toBe('--map-floor-wood-alt')
    expect(cssVarName('dice', 'nat20Glow')).toBe('--dice-nat20-glow')
    expect(cssVarName('fontSizes', 'map-label')).toBe('--text-map-label')
    expect(cssVarName('radii', '2xl')).toBe('--radius-2xl')
    expect(token('shadows', 'nat1Badge')).toBe('var(--shadow-nat1-badge)')
  })

  it('правило :root со схемой цветов и всеми токенами', () => {
    const css = themeCss(darkFantasy)
    expect(css.startsWith(':root {\n  color-scheme: dark;\n')).toBe(true)
    expect(css).toContain('  --map-wall-stone: #120e0b;\n')
    expect(css).toContain('  --dice-nat20: #c9a45c;\n')
    expect(css.match(/^ {2}--/gm)).toHaveLength(Object.keys(themeCssVars(darkFantasy)).length)
  })

  it('каждая переменная в стилях и компонентах задана темой', () => {
    const defined = new Set(Object.keys(themeCssVars(darkFantasy)))
    const missing = [...usedVars()].filter((v) => !defined.has(v) && !LOCAL_VARS.has(v))
    expect(missing).toEqual([])
  })

  it('в теме нет неиспользуемых токенов', () => {
    const used = usedVars()
    // Тени ссылаются на цветовые токены — они тоже считаются использованными.
    for (const value of Object.values(themeCssVars(darkFantasy))) for (const m of value.matchAll(/var\((--[\w-]+)/g)) used.add(m[1])
    expect(Object.keys(themeCssVars(darkFantasy)).filter((v) => !used.has(v))).toEqual([])
  })
})

describe('схема темы', () => {
  const broken = (patch: (t: typeof darkFantasy) => void) => {
    const theme = structuredClone(darkFantasy)
    patch(theme)
    return () => parseTheme(theme)
  }

  it('нет токена — ошибка с путём', () => {
    expect(broken((t) => delete (t.colors as Partial<typeof t.colors>).accent)).toThrow('colors.accent')
  })

  it('лишний токен — ошибка', () => {
    expect(broken((t) => Object.assign(t.map, { lava: '#ff0000' }))).toThrow('map')
  })

  it('цвет, длина и значения проверяются', () => {
    expect(broken((t) => (t.dice.nat20 = 'gold'))).toThrow('dice.nat20: ожидается цвет')
    expect(broken((t) => (t.map.door = '#12345'))).toThrow('map.door')
    expect(broken((t) => (t.space['8'] = '8'))).toThrow('space.8: ожидается длина')
    expect(broken((t) => (t.radii.md = 'big'))).toThrow('radii.md')
    expect(broken((t) => (t.fonts.ui = 'serif; } body { display: none'))).toThrow('fonts.ui')
    expect(broken((t) => (t.shadows.panel = ' '))).toThrow('shadows.panel')
    expect(broken((t) => (t.id = 'Тёмная'))).toThrow('id')
    expect(broken((t) => ((t as { colorScheme: string }).colorScheme = 'sepia'))).toThrow('colorScheme')
  })

  it('цвет можно задать в любом из форматов', () => {
    expect(() => parseTheme({ ...darkFantasy, colors: { ...darkFantasy.colors, bg: '#000', fg: 'hsl(40 30% 85%)', muted: '#9c8c76cc' } })).not.toThrow()
  })
})
