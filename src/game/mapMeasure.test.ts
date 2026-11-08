// Жест игрока → шаблон области: начало на существе или на сетке (шаг полклетки), размер — по клеткам.
import { describe, expect, it } from 'vitest'
import { rulerText, snapHalf, templateFromDrag } from './mapMeasure'

describe('измерения игрока', () => {
  it('линейка: футы по сетке, диагональ — 5 футов', () => {
    expect(rulerText({ x: 1, y: 1 }, { x: 5, y: 4 }, 5)).toBe('20 фт. (4 кл.)')
  })

  it('начало на пустом месте прилипает к сетке с шагом полклетки', () => {
    expect(snapHalf({ x: 3.2, y: 4.8 })).toEqual({ x: 3, y: 5 })
    expect(snapHalf({ x: 3.4, y: 4.6 })).toEqual({ x: 3.5, y: 4.5 })
    expect(templateFromDrag('sphere', { x: 7.1, y: 6.9 }, { x: 11.2, y: 7 }, null, 5)).toEqual({ shape: 'sphere', origin: { x: 7, y: 7 }, size: 20 })
  })

  it('конус от героя — от края его клетки в сторону пальца; размер шагом в клетку', () => {
    const hero = { x: 2, y: 2, w: 1, h: 1 }
    expect(templateFromDrag('cone', { x: 2.5, y: 2.5 }, { x: 5.9, y: 2.5 }, hero, 5)).toEqual({ shape: 'cone', origin: { x: 3, y: 2.5 }, size: 15, direction: 0 })
    expect(templateFromDrag('cube', { x: 2.5, y: 2.5 }, { x: 2.5, y: 0.2 }, hero, 5)).toMatchObject({ origin: { x: 2.5, y: 2 }, direction: 270 })
  })

  it('излучение — вокруг существа, размер — от края его клетки; не меньше клетки', () => {
    const t = templateFromDrag('emanation', { x: 4.5, y: 4.5 }, { x: 7, y: 4.5 }, { x: 4, y: 4, w: 1, h: 1 }, 5)
    expect(t).toEqual({ shape: 'emanation', origin: { x: 4.5, y: 4.5 }, space: { x: 4, y: 4, w: 1, h: 1 }, size: 10 })
    expect(templateFromDrag('sphere', { x: 4, y: 4 }, { x: 4.1, y: 4 }, null, 5).size).toBe(5)
  })
})
