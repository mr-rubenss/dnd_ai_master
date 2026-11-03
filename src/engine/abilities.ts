// Характеристики и бонус мастерства (SRD 5.2). Чистые функции.

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const
export type Ability = (typeof ABILITIES)[number]
export type AbilityScores = Record<Ability, number>

export const ABILITY_NAMES: Record<Ability, string> = {
  str: 'Сила',
  dex: 'Ловкость',
  con: 'Телосложение',
  int: 'Интеллект',
  wis: 'Мудрость',
  cha: 'Харизма',
}

/** Название в родительном падеже: «спасбросок Мудрости». */
export const ABILITY_NAMES_GENITIVE: Record<Ability, string> = {
  str: 'Силы',
  dex: 'Ловкости',
  con: 'Телосложения',
  int: 'Интеллекта',
  wis: 'Мудрости',
  cha: 'Харизмы',
}

export const ABILITY_ABBREVIATIONS: Record<Ability, string> = {
  str: 'СИЛ',
  dex: 'ЛОВ',
  con: 'ТЕЛ',
  int: 'ИНТ',
  wis: 'МДР',
  cha: 'ХАР',
}

/** Модификатор характеристики: (значение − 10) / 2 с округлением вниз. */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2)
}

/** Бонус мастерства по уровню персонажа: +2 на 1–4, +3 на 5–8, +4 на 9–12, +5 на 13–16, +6 на 17–20. */
export function proficiencyBonus(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) throw new RangeError(`Уровень должен быть от 1 до 20, а не ${level}`)
  return 2 + Math.floor((level - 1) / 4)
}

/** Модификатор со знаком: «+3», «−1», «+0». */
export function formatModifier(value: number): string {
  return value < 0 ? `−${Math.abs(value)}` : `+${value}`
}
