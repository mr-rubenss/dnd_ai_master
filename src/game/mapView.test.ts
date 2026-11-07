import { describe, expect, it } from 'vitest'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import { parseLocation } from './location'
import {
  ambientOf,
  centerOn,
  clampView,
  FIT_VIEW,
  floorAreas,
  floorTypeAt,
  lightSources,
  MAX_ZOOM,
  profileOf,
  scaleLabel,
  walkPath,
  zoomAt,
} from './mapView'

const tavern = parseLocation(drunkenGriffinJson)

describe('карта: пол, свет, масштаб', () => {
  it('области пола по типам — одна фигура на тип, клетки сходятся с планом', () => {
    const areas = floorAreas(tavern)
    expect(areas.map((a) => a.floor).sort()).toEqual(['stone', 'wood'])
    expect(areas.reduce((n, a) => n + a.cells, 0)).toBe(20 * 14)
    expect(areas.find((a) => a.floor === 'stone')?.cells).toBe(25)
    expect(floorTypeAt(tavern, 16, 1)).toBe('stone')
    expect(floorTypeAt(tavern, 3, 9)).toBe('wood')
  })

  it('источники света из предметов: факел 20/20 фт. = 4/8 клеток, свеча 1/2, камин; свет в помещении — полумрак', () => {
    const lights = lightSources(tavern)
    const torch = lights.find((l) => l.id === 'torch-bar')!
    expect(torch).toMatchObject({ x: 0.5, y: 4.5, bright: 4, radius: 8 })
    expect(lights.find((l) => l.id === 'candle-1')).toMatchObject({ bright: 1, radius: 2 })
    expect(lights.find((l) => l.id === 'fireplace')).toMatchObject({ x: 0.5, y: 7.5, bright: 3, radius: 6 })
    expect(ambientOf(tavern)).toBe('dim')
    expect(ambientOf({ ...tavern, ambientLight: 'dark' })).toBe('dark')
    expect(ambientOf({ ...tavern, objects: [] })).toBe('bright')
    // Погашенный факел не светит.
    expect(lightSources({ ...tavern, objects: [{ id: 't', type: 'torch', name: 'Факел', x: 1, y: 1, light: { bright: 0, dim: 0 } }] })).toEqual([])
  })

  it('профиль по виду карты и подпись масштаба; старая история без scale — клеточная', () => {
    expect(profileOf(tavern)).toMatchObject({ grid: true, lighting: true })
    expect(scaleLabel(tavern)).toBe('1 клетка = 5 фт.')
    const { scale: _drop, ...old } = tavern
    expect(scaleLabel(old as typeof tavern)).toBe('1 клетка = 5 фт.')
    expect(profileOf({ ...tavern, scale: { kind: 'region', cell: 6, unit: 'mi' } })).toMatchObject({ grid: false, lighting: false })
    expect(scaleLabel({ ...tavern, scale: { kind: 'region', cell: 6, unit: 'mi' } })).toBe('1 клетка = 6 миль')
    expect(scaleLabel({ ...tavern, scale: { kind: 'region', cell: 1, unit: 'mi' } })).toBe('1 клетка = 1 миля')
  })
})

describe('путь фишки по клеткам', () => {
  it('обходит стены, через закрытую дверь не идёт, через открытую — идёт', () => {
    // Из зала в кладовую: дверь в кладовую заперта — пути нет.
    expect(walkPath(tavern, { x: 13, y: 1 }, { x: 17, y: 2 })).toBeNull()
    const open = walkPath(tavern, { x: 13, y: 1 }, { x: 17, y: 2 }, { 'storage-door': 'open' })!
    expect(open.at(-1)).toEqual({ x: 17, y: 2 })
    expect(open.length).toBeGreaterThanOrEqual(4)
    // Соседние клетки по пути.
    let prev = { x: 13, y: 1 }
    for (const c of open) {
      expect(Math.max(Math.abs(c.x - prev.x), Math.abs(c.y - prev.y))).toBe(1)
      prev = c
    }
    expect(walkPath(tavern, { x: 5, y: 5 }, { x: 5, y: 5 })).toEqual([])
  })
})

describe('масштаб и сдвиг', () => {
  it('сдвиг не уводит карту из окна; масштаб в пределах', () => {
    expect(clampView({ scale: 1, x: 40, y: -10 }, 400, 300)).toEqual(FIT_VIEW)
    expect(clampView({ scale: 2, x: -1000, y: 50 }, 400, 300)).toEqual({ scale: 2, x: -400, y: 0 })
    expect(clampView({ scale: 99, x: 0, y: 0 }, 400, 300).scale).toBe(MAX_ZOOM)
    expect(clampView({ scale: 0.2, x: 0, y: 0 }, 400, 300).scale).toBe(1)
  })

  it('масштаб вокруг точки: точка под курсором остаётся на месте', () => {
    const v = zoomAt(FIT_VIEW, 2, 100, 100, 400, 300)
    expect(v).toEqual({ scale: 2, x: -100, y: -100 })
    // Точка карты (50, 50) была под курсором (100, 100) и осталась там: 50 * 2 − 100 = 0? — проверяем общую формулу.
    const mapX = (100 - FIT_VIEW.x) / FIT_VIEW.scale
    expect(mapX * v.scale + v.x).toBe(100)
  })

  it('«К герою»: клетка в центре окна, масштаб не меньше 2', () => {
    const v = centerOn(FIT_VIEW, 10, 7, 20, 14, 400, 280)
    expect(v.scale).toBe(2)
    expect((10 / 20) * 400 * v.scale + v.x).toBe(200)
    expect((7 / 14) * 280 * v.scale + v.y).toBe(140)
    // У края — сдвиг ограничен, но клетка в окне.
    const edge = centerOn(FIT_VIEW, 19.5, 13.5, 20, 14, 400, 280)
    const px = (19.5 / 20) * 400 * edge.scale + edge.x
    expect(px).toBeGreaterThan(0)
    expect(px).toBeLessThan(400)
  })
})
