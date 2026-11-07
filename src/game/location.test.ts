import { describe, expect, it } from 'vitest'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import { edgeKey } from '../engine/movement'
import { LocationValidationError, parseLocation } from './location'

/** Минимальная корректная локация: одна комната 4×3 (упрощённая запись) на карте 6×5. */
function makeRoom(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-room',
    name: 'Тестовая комната',
    description: 'Пустая комната для тестов.',
    cellFeet: 5,
    width: 6,
    height: 5,
    floor: 'stone',
    wallMaterial: 'stone',
    rooms: [{ id: 'room', x: 1, y: 1, w: 4, h: 3 }],
    objects: [],
    npcs: [],
    playerStart: { x: 1, y: 3 },
    ...overrides,
  }
}

/** Две комнаты 3×3 бок о бок (общая стена x = 3) на карте 6×3. */
function twoRooms(overrides: Record<string, unknown> = {}) {
  return makeRoom({
    width: 6,
    height: 3,
    rooms: [
      { id: 'west', x: 0, y: 0, w: 3, h: 3 },
      { id: 'east', x: 3, y: 0, w: 3, h: 3 },
    ],
    playerStart: { x: 0, y: 0 },
    ...overrides,
  })
}

/** Запускает валидацию и возвращает список ошибок (пустой, если локация корректна). */
function problemsOf(raw: unknown): string[] {
  try {
    parseLocation(raw)
    return []
  } catch (error) {
    if (error instanceof LocationValidationError) return error.problems
    throw error
  }
}

const wallKeys = (raw: unknown) => new Set(parseLocation(raw).walls.map((w) => edgeKey(w.side, w.x, w.y)))

describe('parseLocation: таверна «Пьяный грифон»', () => {
  const tavern = parseLocation(drunkenGriffinJson)

  it('принимается и сохраняет обстановку', () => {
    expect(tavern.name).toBe('Таверна «Пьяный грифон»')
    expect(tavern.objects.filter((obj) => obj.type === 'table')).toHaveLength(5)
    expect(tavern.npcs).toHaveLength(4)
  })

  it('стены не съедают клетки: вся карта 20×14 — пол', () => {
    expect(tavern.floorPlan).toHaveLength(14)
    expect(tavern.floorPlan.every((row) => row === '.'.repeat(20))).toBe(true)
  })

  it('кладовая отделена тонкой деревянной перегородкой с запертой дверью', () => {
    const door = tavern.doors.find((d) => d.id === 'storage-door')
    expect(door).toMatchObject({ state: 'locked', x1: 15, x2: 15 })
    const partition = tavern.walls.filter((w) => w.side === 'v' && w.x === 15 && w.y < 5)
    expect(partition).toHaveLength(5)
    expect(partition.every((w) => w.material === 'wood')).toBe(true)
    // Внешние стены — каменные, проём между зоной у стойки и общим залом — без стены.
    expect(tavern.walls.find((w) => w.side === 'v' && w.x === 0 && w.y === 0)?.material).toBe('stone')
    expect(tavern.walls.some((w) => w.side === 'h' && w.y === 5 && w.x < 15)).toBe(false)
  })
})

describe('parseLocation: упрощённая запись', () => {
  it('принимает минимальную комнату и ставит стены по периметру', () => {
    const location = parseLocation(makeRoom())
    expect(location.walls).toHaveLength(2 * (4 + 3))
    expect(location.floorPlan).toEqual(['      ', ' .... ', ' .... ', ' .... ', '      '])
  })

  it('у соседних комнат общая стена; дверь на ней соединяет комнаты', () => {
    const raw = twoRooms({ doors: [{ id: 'door', name: 'Дверь', state: 'locked', x1: 3, y1: 1, x2: 3, y2: 2 }] })
    expect(problemsOf(raw)).toEqual([])
    expect(wallKeys(raw).has('v:3,1')).toBe(true)
  })

  it('проём убирает стену, перегородка добавляет — со своим материалом', () => {
    const raw = makeRoom({
      walls: [{ x1: 3, y1: 1, x2: 3, y2: 3, material: 'wood' }],
      openings: [{ x1: 1, y1: 4, x2: 3, y2: 4 }],
    })
    const location = parseLocation(raw)
    const keys = wallKeys(raw)
    expect(keys.has('h:1,4')).toBe(false)
    expect(keys.has('h:2,4')).toBe(false)
    expect(keys.has('h:3,4')).toBe(true)
    expect(location.walls.filter((w) => w.material === 'wood')).toHaveLength(2)
  })

  it('полная и упрощённая запись дают одинаковые стены', () => {
    const full = makeRoom({
      rooms: undefined,
      floorPlan: ['      ', ' .... ', ' .... ', ' .... ', '      '],
      walls: [
        { x1: 1, y1: 1, x2: 5, y2: 1 },
        { x1: 5, y1: 1, x2: 5, y2: 4 },
        { x1: 5, y1: 4, x2: 1, y2: 4 },
        { x1: 1, y1: 4, x2: 1, y2: 1 },
      ],
    })
    expect(problemsOf(full)).toEqual([])
    expect(wallKeys(full)).toEqual(wallKeys(makeRoom()))
  })

  it('отклоняет пересекающиеся комнаты', () => {
    const raw = makeRoom({ rooms: [{ id: 'a', x: 0, y: 0, w: 3, h: 3 }, { id: 'b', x: 2, y: 2, w: 2, h: 2 }], playerStart: { x: 0, y: 0 } })
    expect(problemsOf(raw)).toContain('rooms[1] "b": пересекается с комнатой "a" в клетке (2, 2)')
  })

  it('требует план пола или комнаты', () => {
    expect(problemsOf(makeRoom({ rooms: undefined }))).toEqual(['нужен план пола "floorPlan" или комнаты "rooms"'])
  })

  it('в плане пола только "." и пробел — стен-клеток больше нет', () => {
    const raw = makeRoom({ rooms: undefined, floorPlan: ['######', '#....#', '#....#', '#....#', '######'] })
    expect(problemsOf(raw)[0]).toBe('floorPlan[0]: недопустимый символ "#" (разрешены "." и пробел)')
  })
})

describe('parseLocation: двери, окна, проёмы — только на стенах', () => {
  it('отклоняет дверь не на стене', () => {
    const raw = makeRoom({ doors: [{ id: 'door', name: 'Дверь', state: 'closed', x1: 2, y1: 2, x2: 3, y2: 2 }] })
    expect(problemsOf(raw)).toEqual(['doors[0] "door": дверь должна стоять на стене, а на границе (2, 2)–(3, 2) стены нет'])
  })

  it('отклоняет широкую дверь, часть которой не на стене', () => {
    const raw = makeRoom({ doors: [{ id: 'gate', name: 'Ворота', state: 'open', x1: 4, y1: 4, x2: 6, y2: 4 }] })
    expect(problemsOf(raw)).toEqual(['doors[0] "gate": дверь должна стоять на стене, а на границе (5, 4)–(6, 4) стены нет'])
  })

  it('отклоняет окно и проём не на стене', () => {
    const raw = makeRoom({
      windows: [{ id: 'win', x1: 2, y1: 2, x2: 2, y2: 3 }],
      openings: [{ x1: 2, y1: 2, x2: 3, y2: 2 }],
    })
    expect(problemsOf(raw)).toEqual([
      'openings[0]: проём можно сделать только в стене, а на границе (2, 2)–(3, 2) стены нет',
      'windows[0] "win": окно должно стоять на стене, а на границе (2, 2)–(2, 3) стены нет',
    ])
  })

  it('отклоняет неизвестное состояние двери', () => {
    const raw = makeRoom({ doors: [{ id: 'door', name: 'Дверь', state: 'ajar', x1: 2, y1: 4, x2: 3, y2: 4 }] })
    expect(problemsOf(raw)).toEqual(['doors[0] "door": "state" должно быть одним из: open, closed, locked'])
  })

  it('отклоняет наклонный отрезок и отрезок за пределами карты', () => {
    const raw = makeRoom({ walls: [{ x1: 1, y1: 1, x2: 2, y2: 2 }, { x1: 0, y1: 0, x2: 0, y2: 9 }] })
    expect(problemsOf(raw)).toEqual([
      'walls[0]: отрезок (1, 1)–(2, 2) должен идти строго по горизонтали или вертикали и иметь длину',
      'walls[1]: отрезок (0, 0)–(0, 9) выходит за пределы карты (узлы от (0, 0) до (6, 5))',
    ])
  })

  it('отклоняет дверь и окно на одной границе', () => {
    const raw = makeRoom({
      doors: [{ id: 'door', name: 'Дверь', state: 'closed', x1: 2, y1: 4, x2: 3, y2: 4 }],
      windows: [{ id: 'win', x1: 2, y1: 4, x2: 4, y2: 4 }],
    })
    expect(problemsOf(raw)).toEqual(['windows[0] "win": граница (2, 4)–(3, 4) уже занята: doors[0] "door"'])
  })

  it('подсказывает, что двери-объекты из старого формата теперь задаются отрезками', () => {
    const raw = makeRoom({ objects: [{ id: 'door', type: 'door', name: 'Дверь', x: 2, y: 2 }] })
    expect(problemsOf(raw)[0]).toMatch(/двери теперь задаются в "doors"/)
  })
})

describe('parseLocation: достижимость от входа', () => {
  it('комнаты без двери и проёма между ними — ошибка со списком клеток', () => {
    expect(problemsOf(twoRooms())).toEqual([
      'клетки пола недостижимы от входа playerStart (всего 9): (3, 0), (4, 0), (5, 0), (3, 1), (4, 1), … — добавьте проём или дверь',
    ])
  })

  it('запертая дверь не мешает достижимости: её можно отпереть', () => {
    expect(problemsOf(twoRooms({ doors: [{ id: 'd', name: 'Дверь', state: 'locked', x1: 3, y1: 0, x2: 3, y2: 1 }] }))).toEqual([])
  })

  it('окно не соединяет комнаты', () => {
    expect(problemsOf(twoRooms({ windows: [{ id: 'w', x1: 3, y1: 0, x2: 3, y2: 1 }] }))).toHaveLength(1)
  })

  it('проём соединяет комнаты', () => {
    expect(problemsOf(twoRooms({ openings: [{ x1: 3, y1: 2, x2: 3, y2: 3 }] }))).toEqual([])
  })
})

describe('parseLocation: объекты и НПС на полу', () => {
  it('отклоняет объект за пределами карты', () => {
    const problems = problemsOf(makeRoom({ objects: [{ id: 'far-barrel', type: 'barrel', name: 'Бочка', x: 10, y: 2 }] }))
    expect(problems).toEqual(['objects[0] "far-barrel": клетка (10, 2) за пределами карты 6×5'])
  })

  it('отклоняет объект, который выходит за край карты', () => {
    const problems = problemsOf(makeRoom({ objects: [{ id: 'long-bar', type: 'bar', name: 'Стойка', x: 2, y: 2, w: 5 }] }))
    expect(problems).toEqual(['objects[0] "long-bar": объект размером 5×1 в клетке (2, 2) выходит за пределы карты 6×5'])
  })

  it('отклоняет объект в пустоте за стеной', () => {
    const problems = problemsOf(makeRoom({ objects: [{ id: 'barrel', type: 'barrel', name: 'Бочка', x: 0, y: 2 }] }))
    expect(problems).toEqual(['objects[0] "barrel": объект должен стоять на полу, а клетка (0, 2) — не пол'])
  })

  it('отклоняет стол поперёк перегородки', () => {
    const raw = makeRoom({
      walls: [{ x1: 3, y1: 1, x2: 3, y2: 3 }],
      objects: [{ id: 'table', type: 'table', name: 'Стол', x: 2, y: 1, w: 2 }],
    })
    expect(problemsOf(raw)).toEqual(['objects[0] "table": объект пересекает стену на границе (3, 1)–(3, 2)'])
  })

  it('отклоняет НПС и игрока в пустоте', () => {
    const raw = makeRoom({ npcs: [{ id: 'ghost', name: 'Призрак', x: 0, y: 2 }], playerStart: { x: 5, y: 4 } })
    expect(problemsOf(raw)).toEqual([
      'npcs[0] "ghost": НПС должен стоять на полу, а клетка (0, 2) — пустота',
      'playerStart: игрок должен стоять на полу',
    ])
  })

  it('отклоняет два объекта в одной клетке', () => {
    const problems = problemsOf(
      makeRoom({
        objects: [
          { id: 'table', type: 'table', name: 'Стол', x: 1, y: 1, w: 2, h: 2 },
          { id: 'barrel', type: 'barrel', name: 'Бочка', x: 2, y: 2 },
        ],
      }),
    )
    expect(problems).toEqual(['objects[1] "barrel": клетка (2, 2) уже занята объектом objects[0] "table"'])
  })

  it('разрешает НПС на клетке со стулом', () => {
    const room = makeRoom({
      objects: [{ id: 'chair', type: 'chair', name: 'Стул', x: 2, y: 2 }],
      npcs: [{ id: 'guest', name: 'Гость', x: 2, y: 2 }],
    })
    expect(problemsOf(room)).toEqual([])
  })

  it('собирает все ошибки сразу и выдаёт их в сообщении исключения', () => {
    const room = makeRoom({
      doors: [{ id: 'door', name: 'Дверь', state: 'closed', x1: 2, y1: 2, x2: 3, y2: 2 }],
      npcs: [{ id: 'ghost', name: 'Призрак', x: 0, y: 0 }],
    })
    expect(problemsOf(room)).toHaveLength(2)
    expect(() => parseLocation(room)).toThrow(/Некорректная локация:\n- doors\[0\] "door"/)
  })
})

describe('личность НПС', () => {
  it('поля личности необязательны, строки с пределом длины; у таверны они заполнены', () => {
    const npc = { id: 'old', name: 'Старик', x: 1, y: 1 }
    expect(problemsOf(makeRoom({ npcs: [npc] }))).toEqual([])
    expect(problemsOf(makeRoom({ npcs: [{ ...npc, goal: 'Найти внука', speech: 'Шамкает', activity: 'Дремлет' }] }))).toEqual([])
    expect(problemsOf(makeRoom({ npcs: [{ ...npc, fear: 42 }] }))).toEqual(['npcs[0] "old": "fear" должно быть строкой'])
    expect(problemsOf(makeRoom({ npcs: [{ ...npc, backstory: 'а'.repeat(401) }] }))).toEqual(['npcs[0] "old": "backstory" — не длиннее 400 символов'])
    const tavern = parseLocation(drunkenGriffinJson)
    for (const n of tavern.npcs) for (const key of ['backstory', 'goal', 'fear', 'speech', 'activity'] as const) expect(n[key], `${n.id}.${key}`).toBeTruthy()
  })
})

describe('богатая карта: пол комнат, масштаб, свет, плоские объекты', () => {
  it('пол «плитка» и пол комнаты поверх пола карты', () => {
    const loc = parseLocation(
      twoRooms({ floor: 'tile', rooms: [{ id: 'west', x: 0, y: 0, w: 3, h: 3, floor: 'grass' }, { id: 'east', x: 3, y: 0, w: 3, h: 3 }], openings: [{ x1: 3, y1: 1, x2: 3, y2: 2 }] }),
    )
    expect(loc.floor).toBe('tile')
    expect(loc.rooms[0].floor).toBe('grass')
    expect(problemsOf(twoRooms({ rooms: [{ id: 'west', x: 0, y: 0, w: 3, h: 3, floor: 'lava' }] }))).toContainEqual(expect.stringContaining('"floor" должно быть одним из'))
  })

  it('масштаб: по умолчанию клеточная; общая — в милях, cellFeet не обязателен; ошибки — понятные', () => {
    expect(parseLocation(makeRoom()).scale).toEqual({ kind: 'tactical', cell: 5, unit: 'ft' })
    const region = parseLocation(makeRoom({ cellFeet: undefined, scale: { kind: 'region', cell: 6, unit: 'mi' }, objects: [{ id: 't', type: 'tree', name: 'Лес', x: 1, y: 1 }] }))
    expect(region.scale).toEqual({ kind: 'region', cell: 6, unit: 'mi' })
    expect(region.cellFeet).toBe(6 * 5280)
    expect(problemsOf(makeRoom({ scale: { kind: 'world', cell: 1, unit: 'mi' } }))).toContainEqual(expect.stringContaining('"scale" — объект'))
    // Набор объектов — по виду карты: стула на общей карте нет.
    expect(problemsOf(makeRoom({ scale: { kind: 'region', cell: 6, unit: 'mi' }, objects: [{ id: 'c', type: 'chair', name: 'Стул', x: 1, y: 1 }] }))).toContainEqual(
      expect.stringContaining('на карте вида «region» объекты «chair» не ставятся'),
    )
  })

  it('общий свет и свет предмета проверяются', () => {
    expect(parseLocation(makeRoom({ ambientLight: 'dark' })).ambientLight).toBe('dark')
    expect(problemsOf(makeRoom({ ambientLight: 'sunny' }))).toContainEqual(expect.stringContaining('"ambientLight"'))
    expect(problemsOf(makeRoom({ objects: [{ id: 't', type: 'torch', name: 'Факел', x: 1, y: 1, light: { bright: -5, dim: 5 } }] }))).toContainEqual(expect.stringContaining('"light"'))
  })

  it('ковёр и свеча клетку не занимают: стол на ковре, свеча на столе', () => {
    const loc = parseLocation(
      makeRoom({
        objects: [
          { id: 'rug', type: 'rug', name: 'Ковёр', x: 1, y: 1, w: 3, h: 2 },
          { id: 'table', type: 'table', name: 'Стол', x: 2, y: 1, w: 2 },
          { id: 'candle', type: 'candle', name: 'Свеча', x: 2, y: 1 },
        ],
      }),
    )
    expect(loc.objects.map((o) => o.type)).toEqual(['rug', 'table', 'candle'])
    expect(problemsOf(makeRoom({ objects: [{ id: 'a', type: 'chest', name: 'Сундук', x: 1, y: 1 }, { id: 'b', type: 'bed', name: 'Кровать', x: 1, y: 1 }] }))).toContainEqual(
      expect.stringContaining('уже занята объектом'),
    )
  })

  it('таверна: каменная кладовая, ковёр, свечи, факелы, полка, сундук, лежанка', () => {
    const loc = parseLocation(drunkenGriffinJson)
    expect(loc.rooms.find((r) => r.id === 'storeroom')?.floor).toBe('stone')
    const types = new Set(loc.objects.map((o) => o.type))
    for (const t of ['rug', 'candle', 'torch', 'shelf', 'chest', 'bed', 'fireplace']) expect(types).toContain(t)
  })
})
