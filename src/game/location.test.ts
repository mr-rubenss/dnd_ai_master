import { describe, expect, it } from 'vitest'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import { LocationValidationError, parseLocation } from './location'

/** Минимальная корректная комната 6×5: стены по краям, пол внутри. */
function makeRoom(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-room',
    name: 'Тестовая комната',
    description: 'Пустая комната для тестов.',
    cellFeet: 5,
    width: 6,
    height: 5,
    floor: 'stone',
    walls: 'stone',
    tiles: ['######', '#....#', '#....#', '#....#', '######'],
    objects: [],
    npcs: [],
    playerStart: { x: 1, y: 3 },
    ...overrides,
  }
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

describe('parseLocation', () => {
  it('принимает таверну «Пьяный грифон»', () => {
    const location = parseLocation(drunkenGriffinJson)
    expect(location.name).toBe('Таверна «Пьяный грифон»')
    expect(location.width).toBe(20)
    expect(location.height).toBe(14)
    expect(location.objects.filter((obj) => obj.type === 'table')).toHaveLength(5)
    expect(location.npcs).toHaveLength(4)
  })

  it('принимает минимальную корректную комнату', () => {
    expect(problemsOf(makeRoom())).toEqual([])
  })

  it('отклоняет объект за пределами карты', () => {
    const problems = problemsOf(
      makeRoom({ objects: [{ id: 'far-barrel', type: 'barrel', name: 'Бочка', x: 10, y: 2 }] }),
    )
    expect(problems).toEqual(['objects[0] "far-barrel": клетка (10, 2) за пределами карты 6×5'])
  })

  it('отклоняет объект, который начинается на карте, но выходит за её край', () => {
    const problems = problemsOf(
      makeRoom({ objects: [{ id: 'long-bar', type: 'bar', name: 'Стойка', x: 2, y: 2, w: 5 }] }),
    )
    expect(problems).toEqual([
      'objects[0] "long-bar": объект размером 5×1 в клетке (2, 2) выходит за пределы карты 6×5',
    ])
  })

  it('отклоняет дверь не на стене', () => {
    const problems = problemsOf(
      makeRoom({ objects: [{ id: 'door', type: 'door', name: 'Дверь', x: 2, y: 2 }] }),
    )
    expect(problems).toEqual(['objects[0] "door": дверь должна стоять на клетке стены "#", а клетка (2, 2) — не стена'])
  })

  it('отклоняет широкую дверь, вторая клетка которой не на стене', () => {
    const problems = problemsOf(
      makeRoom({ objects: [{ id: 'gate', type: 'door', name: 'Ворота', x: 0, y: 3, w: 2 }] }),
    )
    expect(problems).toEqual(['objects[0] "gate": дверь должна стоять на клетке стены "#", а клетка (1, 3) — не стена'])
  })

  it('принимает дверь на стене', () => {
    expect(problemsOf(makeRoom({ objects: [{ id: 'door', type: 'door', name: 'Дверь', x: 2, y: 4 }] }))).toEqual([])
  })

  it('отклоняет НПС в стене', () => {
    const problems = problemsOf(makeRoom({ npcs: [{ id: 'ghost', name: 'Призрак', x: 0, y: 2 }] }))
    expect(problems).toEqual(['npcs[0] "ghost": НПС должен стоять на полу ".", а клетка (0, 2) — стена'])
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
      objects: [{ id: 'door', type: 'door', name: 'Дверь', x: 2, y: 2 }],
      npcs: [{ id: 'ghost', name: 'Призрак', x: 0, y: 0 }],
    })
    expect(problemsOf(room)).toHaveLength(2)
    expect(() => parseLocation(room)).toThrow(/Некорректная локация:\n- objects\[0\] "door"/)
  })
})
