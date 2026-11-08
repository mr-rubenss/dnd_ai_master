// Измерения и области воздействия (SRD 5.2.1): расстояние по сетке («диагональ — 5 футов»), шесть фигур, точка
// начала, полуклетки, укрытие стенами, метрика сетки, проверка шаблона, кто задет.
import { describe, expect, it } from 'vitest'
import {
  areaCells,
  areaLabel,
  areaOutline,
  areaTemplateProblem,
  COMPASS,
  cubeBox,
  directionBetween,
  edgeOrigin,
  gridDistanceFeet,
  occupantsInArea,
  pointInArea,
  snapDirection,
  snapFeet,
  spaceDistanceFeet,
  type AreaGrid,
  type AreaTemplate,
} from './areas'

const GRID: AreaGrid = { width: 15, height: 15, cellFeet: 5 }
const cell = (x: number, y: number) => ({ x, y, w: 1, h: 1 })

/** Задетые клетки картинкой: «#» — в области, «.» — нет (только строки и столбцы, где что-то есть, плюс рамка). */
function picture(t: AreaTemplate, grid: AreaGrid = GRID): string {
  const cells = areaCells(t, grid)
  if (cells.length === 0) return ''
  const xs = cells.map((c) => c.x)
  const ys = cells.map((c) => c.y)
  const set = new Set(cells.map((c) => `${c.x},${c.y}`))
  const rows: string[] = []
  for (let y = Math.min(...ys); y <= Math.max(...ys); y++) {
    let row = ''
    for (let x = Math.min(...xs); x <= Math.max(...xs); x++) row += set.has(`${x},${y}`) ? '#' : '.'
    rows.push(row)
  }
  return rows.join('\n')
}
const count = (t: AreaTemplate, grid: AreaGrid = GRID) => areaCells(t, grid).length
const has = (t: AreaTemplate, x: number, y: number, grid: AreaGrid = GRID) => areaCells(t, grid).some((c) => c.x === x && c.y === y)

describe('расстояния по сетке (линейка, дальность)', () => {
  it('каждая клетка, и по диагонали, — 5 футов', () => {
    expect(gridDistanceFeet({ x: 0, y: 0 }, { x: 3, y: 0 }, 5)).toBe(15)
    expect(gridDistanceFeet({ x: 0, y: 0 }, { x: 3, y: 3 }, 5)).toBe(15)
    expect(gridDistanceFeet({ x: 2, y: 5 }, { x: 8, y: 1 }, 5)).toBe(30)
    expect(gridDistanceFeet({ x: 4, y: 4 }, { x: 4, y: 4 }, 5)).toBe(0)
  })

  it('дальность между пространствами: соседние — 5 футов, большое существо считается от края', () => {
    expect(spaceDistanceFeet(cell(0, 0), cell(1, 1), 5)).toBe(5)
    expect(spaceDistanceFeet(cell(0, 0), cell(4, 2), 5)).toBe(20)
    // Существо 2×2 в (3, 3)–(4, 4): до клетки (7, 4) — 15 футов.
    expect(spaceDistanceFeet({ x: 3, y: 3, w: 2, h: 2 }, cell(7, 4), 5)).toBe(15)
    expect(spaceDistanceFeet({ x: 3, y: 3, w: 2, h: 2 }, cell(4, 4), 5)).toBe(0)
  })

  it('направления и округление', () => {
    expect(directionBetween({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(0)
    expect(directionBetween({ x: 0, y: 0 }, { x: 0, y: 1 })).toBe(90)
    expect(directionBetween({ x: 0, y: 0 }, { x: 0, y: -1 })).toBe(270)
    expect(snapDirection(100)).toBe(90)
    expect(snapDirection(350)).toBe(0)
    expect(snapDirection(-30)).toBe(315)
    expect(COMPASS.north).toBe(270)
    expect(snapFeet(13, 5)).toBe(15)
    expect(snapFeet(1, 5)).toBe(5)
  })
})

describe('сфера и цилиндр', () => {
  it('сфера 20 фт. из узла сетки (огненный шар): круг, задеты клетки, покрытые хотя бы наполовину', () => {
    const fireball: AreaTemplate = { shape: 'sphere', origin: { x: 7, y: 7 }, size: 20 }
    expect(picture(fireball)).toBe(['..####..', '.######.', '########', '########', '########', '########', '.######.', '..####..'].join('\n'))
    expect(count(fireball)).toBe(52)
  })

  it('сфера 10 фт. из центра клетки: точка начала входит в область', () => {
    const t: AreaTemplate = { shape: 'sphere', origin: { x: 7.5, y: 7.5 }, size: 10 }
    expect(picture(t)).toBe(['..#..', '.###.', '#####', '.###.', '..#..'].join('\n'))
    expect(has(t, 7, 7)).toBe(true)
    expect(has({ ...t, includeOrigin: false }, 7, 7)).toBe(false)
  })

  it('сфера 5 фт. из узла — четыре клетки вокруг узла', () => {
    expect(areaCells({ shape: 'sphere', origin: { x: 3, y: 3 }, size: 5 }, GRID)).toEqual([
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
    ])
  })

  it('цилиндр на плоской карте — тот же круг, высота только в подписи', () => {
    const sphere = areaCells({ shape: 'sphere', origin: { x: 7, y: 7 }, size: 10 }, GRID)
    const cylinder = areaCells({ shape: 'cylinder', origin: { x: 7, y: 7 }, size: 10, height: 40 }, GRID)
    expect(cylinder).toEqual(sphere)
    expect(areaLabel({ shape: 'cylinder', size: 10, height: 40 })).toBe('Цилиндр 10 фт. (высота 40 фт.)')
  })
})

describe('конус', () => {
  it('15 фт. на восток от края клетки существа: ширина равна расстоянию от точки начала', () => {
    const t: AreaTemplate = { shape: 'cone', origin: edgeOrigin(cell(7, 7), 0), size: 15, direction: 0 }
    expect(t.origin).toEqual({ x: 8, y: 7.5 })
    expect(picture(t)).toBe(['..#', '###', '..#'].join('\n'))
    // Само существо (точка начала) не задето.
    expect(has(t, 7, 7)).toBe(false)
  })

  it('30 фт.: к концу шире, ось симметрична', () => {
    const t: AreaTemplate = { shape: 'cone', origin: edgeOrigin(cell(2, 7), 0), size: 30, direction: 0 }
    expect(picture(t)).toBe(['....##', '..####', '######', '..####', '....##'].join('\n'))
  })

  it('по диагонали — от угла клетки', () => {
    const t: AreaTemplate = { shape: 'cone', origin: edgeOrigin(cell(7, 7), 45), size: 15, direction: 45 }
    expect(t.origin).toEqual({ x: 8, y: 8 })
    expect(picture(t)).toBe(['##.', '###', '.#.'].join('\n'))
  })

  it('из центра клетки: клетка с точкой начала исключена (если создатель не решит иначе)', () => {
    const t: AreaTemplate = { shape: 'cone', origin: { x: 5.5, y: 5.5 }, size: 15, direction: 0 }
    expect(has(t, 5, 5)).toBe(false)
    expect(has(t, 6, 5)).toBe(true)
    expect(pointInArea(t, { x: 5.5, y: 5.5 }, 5)).toBe(false)
  })
})

describe('линия', () => {
  it('30 × 5 фт. на восток — шесть клеток подряд, без клетки существа', () => {
    const t: AreaTemplate = { shape: 'line', origin: edgeOrigin(cell(7, 7), 0), size: 30, direction: 0 }
    expect(areaCells(t, GRID)).toEqual([8, 9, 10, 11, 12, 13].map((x) => ({ x, y: 7 })))
  })

  it('ширина 10 фт. — две полосы; по диагонали геометрия короче линейки', () => {
    const wide: AreaTemplate = { shape: 'line', origin: { x: 2, y: 7 }, size: 20, direction: 0, width: 10 }
    expect(picture(wide)).toBe(['####', '####'].join('\n'))
    const diagonal: AreaTemplate = { shape: 'line', origin: edgeOrigin(cell(3, 3), 45), size: 30, direction: 45 }
    expect(picture(diagonal)).toBe(['#...', '.#..', '..#.', '...#'].join('\n'))
    expect(areaLabel(wide)).toBe('Линия 20 × 10 фт.')
  })

  it('под произвольным углом', () => {
    const t: AreaTemplate = { shape: 'line', origin: edgeOrigin(cell(3, 3), 30), size: 30, direction: 30 }
    expect(picture(t)).toBe(['##...', '..##.', '....#'].join('\n'))
  })
})

describe('куб', () => {
  it('15 фт. на восток: точка начала — середина грани, куб прилегает к существу', () => {
    const t: AreaTemplate = { shape: 'cube', origin: edgeOrigin(cell(7, 7), 0, 'cube'), size: 15, direction: 0 }
    expect(cubeBox(t, 5)).toEqual({ x: 8, y: 6, w: 3, h: 3 })
    expect(picture(t)).toBe(['###', '###', '###'].join('\n'))
    expect(has(t, 7, 7)).toBe(false)
  })

  it('по диагонали — точка начала в углу, направление округляется до 8 сторон', () => {
    const t: AreaTemplate = { shape: 'cube', origin: edgeOrigin(cell(7, 7), 50, 'cube'), size: 10, direction: 50 }
    expect(t.origin).toEqual({ x: 8, y: 8 })
    expect(areaCells(t, GRID)).toEqual([
      { x: 8, y: 8 },
      { x: 9, y: 8 },
      { x: 8, y: 9 },
      { x: 9, y: 9 },
    ])
  })
})

describe('излучение', () => {
  it('10 фт. вокруг существа: само существо не входит', () => {
    const t: AreaTemplate = { shape: 'emanation', origin: { x: 7.5, y: 7.5 }, size: 10 }
    expect(picture(t)).toBe(['.###.', '#####', '##.##', '#####', '.###.'].join('\n'))
    expect(has({ ...t, includeOrigin: true }, 7, 7)).toBe(true)
  })

  it('5 фт. вокруг большого существа (2×2) — кольцо из 12 клеток', () => {
    const t: AreaTemplate = { shape: 'emanation', origin: { x: 5, y: 5 }, size: 5, space: { x: 4, y: 4, w: 2, h: 2 } }
    expect(count(t)).toBe(12)
    expect(has(t, 4, 4)).toBe(false)
    expect(has(t, 3, 3)).toBe(true)
  })
})

describe('карта: края, пол и укрытие', () => {
  it('область обрезается краем карты и клетками без пола', () => {
    const t: AreaTemplate = { shape: 'sphere', origin: { x: 0, y: 0 }, size: 10 }
    // Угловая клетка (1, 1) покрыта меньше чем наполовину.
    expect(areaCells(t, GRID)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ])
    expect(areaCells(t, { ...GRID, cellAllowed: (x) => x === 0 })).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
    ])
  })

  it('прямые от точки начала, перекрытые стеной, не дают клеток за ней', () => {
    // Стена по линии x = 9: всё, что за ней, укрыто от огненного шара полностью.
    const blocked = (a: { x: number }, b: { x: number }) => (a.x - 9) * (b.x - 9) < 0
    const t: AreaTemplate = { shape: 'sphere', origin: { x: 7, y: 7 }, size: 20 }
    const cells = areaCells(t, { ...GRID, blocked })
    expect(cells.some((c) => c.x >= 9)).toBe(false)
    expect(cells.length).toBe(count(t) - areaCells(t, GRID).filter((c) => c.x >= 9).length)
  })
})

describe('метрика сетки («диагональ — 5 футов»)', () => {
  const grid: AreaGrid = { ...GRID, metric: 'grid' }
  it('сфера — квадрат, линия по диагонали — столько же клеток, сколько по стороне', () => {
    expect(picture({ shape: 'sphere', origin: { x: 7, y: 7 }, size: 10 }, grid)).toBe(['####', '####', '####', '####'].join('\n'))
    const diagonal: AreaTemplate = { shape: 'line', origin: edgeOrigin(cell(3, 3), 45), size: 30, direction: 45 }
    expect(count(diagonal, grid)).toBe(6)
    expect(count({ ...diagonal, direction: 0, origin: edgeOrigin(cell(3, 3), 0) }, grid)).toBe(6)
    expect(areaOutline({ shape: 'sphere', origin: { x: 7, y: 7 }, size: 10 }, 5, 'grid')).toEqual({ kind: 'rounded', x: 5, y: 5, w: 4, h: 4, r: 0 })
  })
})

describe('кто задет', () => {
  it('существо задето, если хотя бы одна клетка его пространства в области', () => {
    const cells = areaCells({ shape: 'sphere', origin: { x: 7, y: 7 }, size: 10 }, GRID)
    const occupants = [
      { id: 'in', space: cell(6, 6) },
      { id: 'out', space: cell(12, 12) },
      { id: 'big', space: { x: 8, y: 7, w: 2, h: 2 } },
      { id: 'far', space: { x: 10, y: 10, w: 2, h: 2 } },
    ]
    expect(occupantsInArea(cells, occupants).map((o) => o.id)).toEqual(['in', 'big'])
  })
})

describe('контур и проверка шаблона', () => {
  it('контур: круг, многоугольник конуса, скруглённый прямоугольник излучения', () => {
    expect(areaOutline({ shape: 'sphere', origin: { x: 7, y: 7 }, size: 20 }, 5)).toEqual({ kind: 'circle', cx: 7, cy: 7, r: 4 })
    expect(areaOutline({ shape: 'cone', origin: { x: 8, y: 7.5 }, size: 15, direction: 0 }, 5)).toEqual({
      kind: 'polygon',
      points: [
        { x: 8, y: 7.5 },
        { x: 11, y: 9 },
        { x: 11, y: 6 },
      ],
    })
    expect(areaOutline({ shape: 'emanation', origin: { x: 2.5, y: 2.5 }, size: 5 }, 5)).toEqual({ kind: 'rounded', x: 1, y: 1, w: 3, h: 3, r: 1 })
  })

  it('недопустимые шаблоны отклоняются с причиной', () => {
    const ok: AreaTemplate = { shape: 'sphere', origin: { x: 3, y: 3 }, size: 20 }
    expect(areaTemplateProblem(ok, GRID)).toBeNull()
    expect(areaTemplateProblem({ ...ok, shape: 'star' as never }, GRID)).toMatch(/^Фигура — одна из/)
    expect(areaTemplateProblem({ ...ok, size: 0 }, GRID)).toBe('Размер области — от 1 до 1000 футов.')
    expect(areaTemplateProblem({ ...ok, origin: { x: 40, y: 3 } }, GRID)).toBe('Точка начала области за пределами карты.')
    expect(areaTemplateProblem({ ...ok, origin: { x: Number.NaN, y: 3 } }, GRID)).toBe('Неверная точка начала области.')
    expect(areaTemplateProblem({ shape: 'cone', origin: { x: 3, y: 3 }, size: 15 }, GRID)).toBe('У фигуры «Конус» нужно направление.')
    expect(areaTemplateProblem({ shape: 'emanation', origin: { x: 3, y: 3 }, size: 5, space: { x: 14, y: 3, w: 2, h: 1 } }, GRID)).toMatch(/^Пространство источника/)
  })
})
