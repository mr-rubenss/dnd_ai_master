import { describe, expect, it } from 'vitest'
import { contrastRatio, CONTRAST_PAIRS, over, parseColor, requiredContrast, themeContrast } from './contrast'
import { darkFantasy } from './darkFantasy'
import { themes } from './registry'

/**
 * Пары ниже порога, которые ждут решения владельца проекта (цвета тем без его согласия не меняем).
 * Сейчас таких нет — тест строгий. Список точный: исправленную пару отсюда нужно убрать.
 */
const KNOWN_ISSUES: Record<string, string[]> = {}

const fmt = (ratio: number) => `${ratio.toFixed(2)}:1`

describe('контраст по WCAG', () => {
  it('разбор цветов всех форматов темы', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseColor('#0f0c0a')).toEqual({ r: 15, g: 12, b: 10, a: 1 })
    expect(parseColor('#00000080').a).toBeCloseTo(0.5, 2)
    expect(parseColor('rgba(201, 164, 92, 0.2)')).toEqual({ r: 201, g: 164, b: 92, a: 0.2 })
    expect(parseColor('rgb(10 20 30 / 50%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 })
    const red = parseColor('hsl(0, 100%, 50%)')
    expect([red.r, red.g, red.b].map(Math.round)).toEqual([255, 0, 0])
    expect(() => parseColor('gold')).toThrow('Не удалось разобрать цвет')
  })

  it('коэффициент контраста: эталонные значения WCAG', () => {
    expect(contrastRatio(parseColor('#000'), parseColor('#fff'))).toBeCloseTo(21, 5)
    expect(contrastRatio(parseColor('#fff'), parseColor('#fff'))).toBe(1)
    // #767676 на белом — минимальный серый, проходящий AA.
    expect(contrastRatio(parseColor('#767676'), parseColor('#fff'))).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(parseColor('#777777'), parseColor('#fff'))).toBeLessThan(4.5)
  })

  it('полупрозрачный цвет считается по итоговому цвету на фоне', () => {
    const half = over(parseColor('rgba(255, 255, 255, 0.5)'), parseColor('#000'))
    expect(Math.round(half.r)).toBe(128)
    expect(half.a).toBe(1)
    // Полупрозрачная подложка ложится на фон страницы, текст — на получившийся цвет.
    const theme = structuredClone(darkFantasy)
    theme.colors.panel = 'rgba(255, 255, 255, 0)'
    const pair = themeContrast(theme).find((p) => p.text === 'colors.fg' && p.background === 'colors.panel')!
    const onBg = themeContrast(theme).find((p) => p.text === 'colors.fg' && p.background === 'colors.bg')!
    expect(pair.ratio).toBeCloseTo(onBg.ratio, 10)
  })

  it('проверяются все пары из задания', () => {
    expect(CONTRAST_PAIRS).toHaveLength(21)
    expect(themeContrast(darkFantasy).map((p) => `${p.text} на ${p.background}`)).toContain('map.npcLabel на map.npcLabelOutline')
  })

  it('порог: AA 4.5:1, для темы high-contrast — 7:1', () => {
    expect(requiredContrast(darkFantasy)).toBe(4.5)
    expect(requiredContrast({ ...darkFantasy, id: 'high-contrast' })).toBe(7)
    expect(themeContrast({ ...darkFantasy, id: 'high-contrast' }).every((p) => p.required === 7)).toBe(true)
  })
})

describe.each(themes.map((t) => [t.id, t] as const))('контраст темы %s', (id, theme) => {
  it(`все пары не ниже ${requiredContrast(theme)}:1 (кроме известных и ждущих решения)`, () => {
    const failing = themeContrast(theme).filter((p) => p.ratio < p.required)
    const report = failing.map((p) => `${p.text} на ${p.background}: ${fmt(p.ratio)} < ${p.required}:1`)
    expect(failing.map((p) => `${p.text} на ${p.background}`), report.join('\n')).toEqual(KNOWN_ISSUES[id] ?? [])
  })
})
