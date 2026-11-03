// Броски кубиков. Единственное место, где в игре появляются случайные числа:
// ИИ-ведущий только запрашивает бросок, а результат всегда считает этот модуль.
//
// Поддерживаемая запись (регистр и пробелы не важны, «к» можно писать вместо «d»):
//   1d20+5, d20, 2d6+3, 1d8+1d6+2, 1d20-1, 4d6kh3 (оставить 3 лучших), 2d20kl1 (оставить худший).

/** Генератор случайных чисел: возвращает число в диапазоне [0, 1). */
export type Rng = () => number

export type RollMode = 'normal' | 'advantage' | 'disadvantage'

export interface DiceTerm {
  kind: 'dice'
  sign: 1 | -1
  count: number
  sides: number
  /** Оставить только лучшие (`highest`) или худшие кубики. */
  keep?: { highest: boolean; count: number }
}

export interface ConstantTerm {
  kind: 'constant'
  sign: 1 | -1
  value: number
}

export interface DiceExpression {
  /** Нормализованная запись, например «1d20+5». */
  notation: string
  terms: (DiceTerm | ConstantTerm)[]
}

export interface DieRoll {
  sides: number
  value: number
  /** false — кубик отброшен (kh/kl, преимущество, помеха). */
  kept: boolean
}

export interface DiceGroupResult {
  sign: 1 | -1
  count: number
  sides: number
  keep?: { highest: boolean; count: number }
  dice: DieRoll[]
  /** Сумма оставленных кубиков с учётом знака. */
  subtotal: number
}

export type Critical = 'success' | 'failure' | null

export interface RollResult {
  notation: string
  mode: RollMode
  groups: DiceGroupResult[]
  /** Сумма всех чисел-модификаторов. */
  modifier: number
  total: number
  /** Выпавшее на d20 значение, если бросок — один d20 (в т. ч. с преимуществом/помехой). */
  natural: number | null
  /** Натуральная 20 — `success`, натуральная 1 — `failure`. */
  critical: Critical
}

export class DiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DiceError'
  }
}

export const MAX_DICE = 100
export const MAX_SIDES = 1000

const TERM_RE = /([+-])?(?:(\d*)d(\d+)(?:k([hl])(\d*))?|(\d+))/y

/** Разбирает запись броска. Бросает DiceError с понятным сообщением, если запись некорректна. */
export function parseDice(input: string): DiceExpression {
  // Пробелы допустимы только вокруг + и − (иначе «1d20 5» превратилось бы в «1d205»).
  const text = input.toLowerCase().trim().replace(/\s*([+-])\s*/g, '$1').replace(/к/g, 'd')
  if (text === '') throw new DiceError('Пустая запись броска')
  if (/\s/.test(text)) throw new DiceError(`Между частями «${input}» нужен знак + или −`)

  const terms: DiceExpression['terms'] = []
  TERM_RE.lastIndex = 0
  while (TERM_RE.lastIndex < text.length) {
    const start = TERM_RE.lastIndex
    const match = TERM_RE.exec(text)
    if (!match) throw new DiceError(`Не удалось разобрать «${input}» начиная с «${text.slice(start)}»`)
    const [, signText, countText, sidesText, keepType, keepCountText, constantText] = match
    if (!signText && terms.length > 0) throw new DiceError(`Между частями «${input}» нужен знак + или −`)
    const sign = signText === '-' ? -1 : 1

    if (constantText !== undefined) {
      terms.push({ kind: 'constant', sign, value: Number(constantText) })
      continue
    }

    const count = countText === '' ? 1 : Number(countText)
    const sides = Number(sidesText)
    if (count < 1 || count > MAX_DICE) throw new DiceError(`Количество кубиков должно быть от 1 до ${MAX_DICE}`)
    if (sides < 2 || sides > MAX_SIDES) throw new DiceError(`У кубика должно быть от 2 до ${MAX_SIDES} граней`)
    const term: DiceTerm = { kind: 'dice', sign, count, sides }
    if (keepType) {
      const keepCount = keepCountText === '' ? 1 : Number(keepCountText)
      if (keepCount < 1 || keepCount > count) {
        throw new DiceError(`Оставить можно от 1 до ${count} кубиков, а не ${keepCount}`)
      }
      term.keep = { highest: keepType === 'h', count: keepCount }
    }
    terms.push(term)
  }

  if (!terms.some((term) => term.kind === 'dice')) throw new DiceError('В записи броска нет ни одного кубика')
  return { notation: formatExpression(terms), terms }
}

function formatExpression(terms: DiceExpression['terms']): string {
  return terms
    .map((term, i) => {
      const sign = term.sign < 0 ? '-' : i > 0 ? '+' : ''
      if (term.kind === 'constant') return `${sign}${term.value}`
      const keep = term.keep ? `k${term.keep.highest ? 'h' : 'l'}${term.keep.count}` : ''
      return `${sign}${term.count}d${term.sides}${keep}`
    })
    .join('')
}

/** Криптографически стойкий генератор браузера — честные кубики по умолчанию. */
export const cryptoRng: Rng = () => {
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return buffer[0] / 2 ** 32
}

/** Одно значение на кубике с `sides` гранями. */
export function rollDie(sides: number, rng: Rng = cryptoRng): number {
  const value = Math.floor(rng() * sides) + 1
  // Защита от генератора, вернувшего ровно 1 или выход за [0, 1).
  return Math.min(Math.max(value, 1), sides)
}

export interface RollOptions {
  mode?: RollMode
  rng?: Rng
}

/** Бросает кубики по записи или разобранному выражению и возвращает подробный результат. */
export function roll(input: string | DiceExpression, { mode = 'normal', rng = cryptoRng }: RollOptions = {}): RollResult {
  const expression = typeof input === 'string' ? parseDice(input) : input
  let terms = expression.terms

  if (mode !== 'normal') {
    const d20s = terms.filter((term) => term.kind === 'dice')
    const single = d20s.length === 1 && d20s[0].sides === 20 && d20s[0].count === 1 && !d20s[0].keep
    if (!single) throw new DiceError('Преимущество и помеха применяются только к броску одного d20')
    // Преимущество/помеха: бросаем 2d20 и оставляем лучший/худший.
    terms = terms.map((term) =>
      term.kind === 'dice' ? { ...term, count: 2, keep: { highest: mode === 'advantage', count: 1 } } : term,
    )
  }

  const groups: DiceGroupResult[] = []
  let modifier = 0
  for (const term of terms) {
    if (term.kind === 'constant') {
      modifier += term.sign * term.value
      continue
    }
    const values = Array.from({ length: term.count }, () => rollDie(term.sides, rng))
    const kept = keptMask(values, term.keep)
    const dice = values.map((value, i) => ({ sides: term.sides, value, kept: kept[i] }))
    const subtotal = term.sign * dice.reduce((sum, die) => sum + (die.kept ? die.value : 0), 0)
    groups.push({ sign: term.sign, count: term.count, sides: term.sides, keep: term.keep, dice, subtotal })
  }

  const total = groups.reduce((sum, group) => sum + group.subtotal, 0) + modifier
  const natural = naturalD20(groups)
  const critical: Critical = natural === 20 ? 'success' : natural === 1 ? 'failure' : null
  return { notation: expression.notation, mode, groups, modifier, total, natural, critical }
}

/** Какие кубики оставить: при равенстве отбрасывается ровно столько, сколько нужно. */
function keptMask(values: number[], keep: DiceTerm['keep']): boolean[] {
  if (!keep) return values.map(() => true)
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => (keep.highest ? b.value - a.value : a.value - b.value) || a.index - b.index)
  const keptIndexes = new Set(order.slice(0, keep.count).map((entry) => entry.index))
  return values.map((_, index) => keptIndexes.has(index))
}

function naturalD20(groups: DiceGroupResult[]): number | null {
  if (groups.length !== 1) return null
  const [group] = groups
  if (group.sides !== 20 || group.sign < 0) return null
  const kept = group.dice.filter((die) => die.kept)
  return kept.length === 1 ? kept[0].value : null
}

const MODE_LABELS: Record<RollMode, string> = {
  normal: '',
  advantage: ', преимущество',
  disadvantage: ', помеха',
}

/** Запись броска в русской нотации: «1d20+5» → «1к20+5». */
export const formatNotation = (notation: string) => notation.replace(/d/g, 'к')

/** Текстовое описание результата, например «1к20+5, преимущество: [17, (4)] + 5 = 22». */
export function formatRoll(result: RollResult): string {
  const parts = result.groups.map((group, i) => {
    const dice = group.dice.map((die) => (die.kept ? String(die.value) : `(${die.value})`)).join(', ')
    const sign = group.sign < 0 ? '− ' : i > 0 ? '+ ' : ''
    return `${sign}[${dice}]`
  })
  if (result.modifier !== 0) parts.push(`${result.modifier < 0 ? '−' : '+'} ${Math.abs(result.modifier)}`)
  return `${formatNotation(result.notation)}${MODE_LABELS[result.mode]}: ${parts.join(' ')} = ${result.total}`
}
