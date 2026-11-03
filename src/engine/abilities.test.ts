import { describe, expect, it } from 'vitest'
import { abilityModifier, formatModifier, proficiencyBonus } from './abilities'

describe('характеристики', () => {
  it.each([
    [1, -5],
    [3, -4],
    [8, -1],
    [9, -1],
    [10, 0],
    [11, 0],
    [12, 1],
    [17, 3],
    [20, 5],
    [30, 10],
  ])('модификатор значения %i равен %i', (score, mod) => {
    expect(abilityModifier(score)).toBe(mod)
  })

  it('модификатор для всех значений 1–30 — (значение − 10) / 2 с округлением вниз', () => {
    const mods = Array.from({ length: 30 }, (_, i) => abilityModifier(i + 1))
    expect(mods).toEqual([-5, -4, -4, -3, -3, -2, -2, -1, -1, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10])
  })

  it('бонус мастерства по уровням 1–20', () => {
    const byLevel = Array.from({ length: 20 }, (_, i) => proficiencyBonus(i + 1))
    expect(byLevel).toEqual([2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6])
  })

  it.each([0, 21, 1.5])('бонус мастерства для недопустимого уровня %s — ошибка', (level) => {
    expect(() => proficiencyBonus(level)).toThrow('Уровень должен быть от 1 до 20')
  })

  it('форматирует модификатор со знаком', () => {
    expect([3, 0, -1].map(formatModifier)).toEqual(['+3', '+0', '−1'])
  })
})
