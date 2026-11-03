import { describe, expect, it, vi } from 'vitest'
import { cryptoRng, DiceError, formatRoll, parseDice, roll, rollDie, type Rng } from './dice'

/** Значение генератора, при котором на кубике с `sides` гранями выпадет `face`. */
const face = (value: number, sides: number) => (value - 0.5) / sides

/** Генератор, выдающий заданную последовательность; лишний вызов — ошибка теста. */
function sequence(...values: number[]): Rng {
  const queue = [...values]
  return () => {
    if (queue.length === 0) throw new Error('Генератор вызван больше раз, чем ожидалось')
    return queue.shift()!
  }
}

/** Генератор для серии бросков одного типа кубика. */
const faces = (sides: number, ...values: number[]) => sequence(...values.map((v) => face(v, sides)))

const keptValues = (result: ReturnType<typeof roll>, group = 0) =>
  result.groups[group].dice.filter((d) => d.kept).map((d) => d.value)

describe('parseDice', () => {
  it.each([
    ['1d20+5', '1d20+5'],
    ['d20', '1d20'],
    ['2d6+3', '2d6+3'],
    ['4d6kh3', '4d6kh3'],
    ['2d20kl', '2d20kl1'],
    [' 1D8 + 1d6 + 2 ', '1d8+1d6+2'],
    ['2к6-1', '2d6-1'],
    ['1d20-1d4', '1d20-1d4'],
  ])('разбирает «%s» как %s', (input, notation) => {
    expect(parseDice(input).notation).toBe(notation)
  })

  it('выделяет кубики, правило «оставить» и модификаторы', () => {
    expect(parseDice('4d6kh3+2').terms).toEqual([
      { kind: 'dice', sign: 1, count: 4, sides: 6, keep: { highest: true, count: 3 } },
      { kind: 'constant', sign: 1, value: 2 },
    ])
  })

  it.each([
    ['', 'Пустая запись броска'],
    ['abc', 'Не удалось разобрать'],
    ['1d', 'Не удалось разобрать'],
    ['2d6x', 'Не удалось разобрать'],
    ['1d20++5', 'Не удалось разобрать'],
    ['0d6', 'Количество кубиков должно быть от 1 до 100'],
    ['101d6', 'Количество кубиков должно быть от 1 до 100'],
    ['1d1', 'У кубика должно быть от 2 до 1000 граней'],
    ['4d6kh5', 'Оставить можно от 1 до 4 кубиков, а не 5'],
    ['4d6kh0', 'Оставить можно от 1 до 4 кубиков, а не 0'],
    ['5', 'В записи броска нет ни одного кубика'],
    ['1d20 5', 'нужен знак'],
  ])('отклоняет «%s»', (input, message) => {
    expect(() => parseDice(input)).toThrow(DiceError)
    expect(() => parseDice(input)).toThrow(message)
  })
})

describe('rollDie', () => {
  it('переводит [0, 1) в грани от 1 до N', () => {
    expect(rollDie(20, () => 0)).toBe(1)
    expect(rollDie(20, () => 0.999999)).toBe(20)
    expect(rollDie(6, () => 0.5)).toBe(4)
  })

  it('не выходит за пределы граней даже с неисправным генератором', () => {
    expect(rollDie(6, () => 1)).toBe(6)
    expect(rollDie(6, () => -0.1)).toBe(1)
  })
})

describe('roll', () => {
  it('1d20+5: кубик, модификатор и итог', () => {
    const result = roll('1d20+5', { rng: faces(20, 17) })
    expect(result).toEqual({
      notation: '1d20+5',
      mode: 'normal',
      groups: [{ sign: 1, count: 1, sides: 20, keep: undefined, dice: [{ sides: 20, value: 17, kept: true }], subtotal: 17 }],
      modifier: 5,
      total: 22,
      natural: 17,
      critical: null,
    })
  })

  it('2d6+3 складывает оба кубика', () => {
    const result = roll('2d6+3', { rng: faces(6, 4, 6) })
    expect(result.groups[0].dice.map((d) => d.value)).toEqual([4, 6])
    expect(result.total).toBe(13)
    expect(result.natural).toBeNull()
  })

  it('4d6kh3 отбрасывает худший кубик', () => {
    const result = roll('4d6kh3', { rng: faces(6, 2, 5, 6, 3) })
    expect(result.groups[0].dice).toEqual([
      { sides: 6, value: 2, kept: false },
      { sides: 6, value: 5, kept: true },
      { sides: 6, value: 6, kept: true },
      { sides: 6, value: 3, kept: true },
    ])
    expect(result.total).toBe(14)
  })

  it('при равных худших кубиках отбрасывает ровно один', () => {
    const result = roll('4d6kh3', { rng: faces(6, 3, 5, 3, 6) })
    expect(result.groups[0].dice.map((d) => d.kept)).toEqual([true, true, false, true])
    expect(result.total).toBe(14)
  })

  it('kl оставляет худшие', () => {
    const result = roll('3d6kl2', { rng: faces(6, 4, 1, 6) })
    expect(keptValues(result)).toEqual([4, 1])
    expect(result.total).toBe(5)
  })

  it('учитывает вычитаемые кубики и отрицательные модификаторы', () => {
    const rng = sequence(face(15, 20), face(3, 4))
    const result = roll('1d20-1d4-2', { rng })
    expect(result.groups.map((g) => g.subtotal)).toEqual([15, -3])
    expect(result.modifier).toBe(-2)
    expect(result.total).toBe(10)
  })

  it('бросает каждый кубик ровно один раз', () => {
    const rng = vi.fn(() => 0.5)
    roll('4d6kh3+1d8+2', { rng })
    expect(rng).toHaveBeenCalledTimes(5)
  })

  it('по умолчанию использует честный генератор и не выходит за грани', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 600; i++) seen.add(roll('1d6').total)
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6])
    for (let i = 0; i < 100; i++) {
      const value = cryptoRng()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe('преимущество и помеха', () => {
  it('с преимуществом бросает 2d20 и берёт больший', () => {
    const result = roll('1d20+3', { mode: 'advantage', rng: faces(20, 7, 15) })
    expect(result.mode).toBe('advantage')
    expect(result.groups[0].dice).toEqual([
      { sides: 20, value: 7, kept: false },
      { sides: 20, value: 15, kept: true },
    ])
    expect(result.natural).toBe(15)
    expect(result.total).toBe(18)
  })

  it('с помехой берёт меньший', () => {
    const result = roll('d20', { mode: 'disadvantage', rng: faces(20, 7, 15) })
    expect(keptValues(result)).toEqual([7])
    expect(result.total).toBe(7)
  })

  it.each(['2d6', '2d20', '1d20+1d4', '4d20kh1'])('не применяется к «%s»', (notation) => {
    expect(() => roll(notation, { mode: 'advantage', rng: () => 0.5 })).toThrow(
      'Преимущество и помеха применяются только к броску одного d20',
    )
  })
})

describe('натуральные 20 и 1', () => {
  it('натуральная 20 — критический успех независимо от модификатора', () => {
    const result = roll('1d20-2', { rng: faces(20, 20) })
    expect(result).toMatchObject({ natural: 20, critical: 'success', total: 18 })
  })

  it('натуральная 1 — критический провал, даже если итог высокий', () => {
    const result = roll('1d20+12', { rng: faces(20, 1) })
    expect(result).toMatchObject({ natural: 1, critical: 'failure', total: 13 })
  })

  it('с помехой считается оставленный кубик', () => {
    expect(roll('1d20', { mode: 'disadvantage', rng: faces(20, 20, 1) }).critical).toBe('failure')
    expect(roll('1d20', { mode: 'advantage', rng: faces(20, 20, 1) }).critical).toBe('success')
  })

  it('отброшенная 20 не считается', () => {
    expect(roll('1d20', { mode: 'disadvantage', rng: faces(20, 20, 9) })).toMatchObject({ natural: 9, critical: null })
  })

  it('нет натурального значения у не-d20 и составных бросков', () => {
    expect(roll('1d6', { rng: faces(6, 6) }).natural).toBeNull()
    expect(roll('1d20+1d4', { rng: sequence(face(20, 20), face(1, 4)) }).critical).toBeNull()
  })
})

describe('formatRoll', () => {
  it('описывает бросок по-русски', () => {
    expect(formatRoll(roll('1d20+5', { mode: 'advantage', rng: faces(20, 17, 4) }))).toBe(
      '1к20+5, преимущество: [17, (4)] + 5 = 22',
    )
    expect(formatRoll(roll('4d6kh3', { rng: faces(6, 2, 5, 6, 3) }))).toBe('4к6kh3: [(2), 5, 6, 3] = 14')
    expect(formatRoll(roll('1d20-1d4-2', { rng: sequence(face(15, 20), face(3, 4)) }))).toBe(
      '1к20-1к4-2: [15] − [3] − 2 = 10',
    )
  })
})
