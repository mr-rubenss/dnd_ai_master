// Общие помощники для валидации данных из JSON.

/** Ошибка валидации со списком понятных проблем на русском. */
export class ValidationError extends Error {
  readonly problems: string[]

  constructor(title: string, problems: string[]) {
    super(`${title}:\n- ${problems.join('\n- ')}`)
    this.name = 'ValidationError'
    this.problems = problems
  }
}

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
export const isInt = (value: unknown): value is number => Number.isInteger(value)
export const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
export const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''
export const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value)
