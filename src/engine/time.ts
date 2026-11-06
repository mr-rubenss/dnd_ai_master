// Игровое время истории: минуты с полуночи первого дня (День 1, 00:00 = 0). День, час, время суток, сдвиг вперёд
// (время не идёт назад) и функции для будущих правил: свет и тьма, путешествия (темп SRD 5.2.1), случайные встречи,
// отдых (после долгого отдыха — не меньше 16 часов до следующего, SRD 5.2.1). Чистые функции.

export const MINUTES_PER_HOUR = 60
export const HOURS_PER_DAY = 24
export const MINUTES_PER_DAY = MINUTES_PER_HOUR * HOURS_PER_DAY
/** Самый большой шаг времени за один вызов ведущего — 30 дней (защита от опечаток). */
export const MAX_ADVANCE_MINUTES = 30 * MINUTES_PER_DAY

/** Игровое время — минуты с полуночи Дня 1. */
export type GameTime = number

/** Время суток. */
export type PartOfDay = 'morning' | 'day' | 'evening' | 'night'

export const PART_OF_DAY_NAMES: Record<PartOfDay, string> = { morning: 'утро', day: 'день', evening: 'вечер', night: 'ночь' }

/** Границы времени суток (час начала): утро 6–11, день 12–17, вечер 18–21, ночь 22–5. */
export const PART_OF_DAY_START: Record<PartOfDay, number> = { morning: 6, day: 12, evening: 18, night: 22 }

/** Время по дню и часу: День 1, 19:00 → gameTime(1, 19). */
export const gameTime = (day: number, hour: number, minute = 0): GameTime => (day - 1) * MINUTES_PER_DAY + hour * MINUTES_PER_HOUR + minute

/** Номер дня (с 1). */
export const dayOf = (t: GameTime) => Math.floor(t / MINUTES_PER_DAY) + 1
/** Час (0–23). */
export const hourOf = (t: GameTime) => Math.floor((t % MINUTES_PER_DAY) / MINUTES_PER_HOUR)
/** Минуты часа (0–59). */
export const minuteOf = (t: GameTime) => t % MINUTES_PER_HOUR

export function partOfDay(t: GameTime): PartOfDay {
  const h = hourOf(t)
  if (h >= PART_OF_DAY_START.night || h < PART_OF_DAY_START.morning) return 'night'
  if (h >= PART_OF_DAY_START.evening) return 'evening'
  if (h >= PART_OF_DAY_START.day) return 'day'
  return 'morning'
}

/** Светлое время (утро и день) — значок солнца; вечер и ночь — луна. */
export const isDaytime = (t: GameTime) => {
  const p = partOfDay(t)
  return p === 'morning' || p === 'day'
}

/** «19:05». */
export const clockText = (t: GameTime) => `${String(hourOf(t)).padStart(2, '0')}:${String(minuteOf(t)).padStart(2, '0')}`

/** Коротко для шапки: «День 3, вечер». */
export const timeLabel = (t: GameTime) => `День ${dayOf(t)}, ${PART_OF_DAY_NAMES[partOfDay(t)]}`

/** Полностью: «День 3, 19:05 (вечер)». */
export const timeText = (t: GameTime) => `День ${dayOf(t)}, ${clockText(t)} (${PART_OF_DAY_NAMES[partOfDay(t)]})`

/** Длительность словами: «2 ч 30 мин», «1 д 4 ч», «45 мин». */
export function durationText(minutes: number): string {
  const d = Math.floor(minutes / MINUTES_PER_DAY)
  const h = Math.floor((minutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR)
  const m = minutes % MINUTES_PER_HOUR
  const parts = [d ? `${d} д` : '', h ? `${h} ч` : '', m ? `${m} мин` : ''].filter(Boolean)
  return parts.length ? parts.join(' ') : '0 мин'
}

/** Почему так сдвинуть время нельзя (или null): шаг — целое число минут больше 0 и не больше 30 дней. */
export function advanceProblem(minutes: unknown): string | null {
  if (typeof minutes !== 'number' || !Number.isInteger(minutes)) return 'Время сдвигается на целое число минут.'
  if (minutes <= 0) return 'Время не идёт назад и не стоит на месте: сдвиг — больше 0 минут.'
  if (minutes > MAX_ADVANCE_MINUTES) return 'За один раз время можно сдвинуть не больше чем на 30 дней.'
  return null
}

/** Время через `minutes` минут (только вперёд). */
export function advanceTime(t: GameTime, minutes: number): GameTime {
  const problem = advanceProblem(minutes)
  if (problem) throw new RangeError(problem)
  return t + minutes
}

/** Сколько минут до ближайшего наступления часа `hour` (строго в будущем: в 7:00 «до 7 утра» — сутки). */
export function minutesUntilHour(t: GameTime, hour: number, minute = 0): number {
  const target = hour * MINUTES_PER_HOUR + minute
  const now = t % MINUTES_PER_DAY
  const diff = target - now
  return diff > 0 ? diff : diff + MINUTES_PER_DAY
}

/** Сколько минут до начала времени суток («проспали до утра» — до 6:00). */
export const minutesUntilPart = (t: GameTime, part: PartOfDay) => minutesUntilHour(t, PART_OF_DAY_START[part])

/** Прошло минут между двумя моментами (не меньше 0). */
export const elapsed = (from: GameTime, to: GameTime) => Math.max(0, to - from)

// ---------- Свет и тьма ----------

/** Естественный свет под открытым небом: день — яркий, сумерки (6-й и 18–21-й часы) — тусклый, ночь — тьма. */
export type AmbientLight = 'bright' | 'dim' | 'darkness'

export function outdoorLight(t: GameTime): AmbientLight {
  const h = hourOf(t)
  if (h >= PART_OF_DAY_START.night || h < PART_OF_DAY_START.morning) return 'darkness'
  if (h === PART_OF_DAY_START.morning || h >= PART_OF_DAY_START.evening) return 'dim'
  return 'bright'
}

// ---------- Путешествия (SRD 5.2.1, «Travel Pace») ----------

export type TravelPace = 'fast' | 'normal' | 'slow'

/** Мили в час по темпу (быстрый — 4, обычный — 3, медленный — 2); за день — 30, 24 и 18 миль. */
export const TRAVEL_MILES_PER_HOUR: Record<TravelPace, number> = { fast: 4, normal: 3, slow: 2 }
export const TRAVEL_MILES_PER_DAY: Record<TravelPace, number> = { fast: 30, normal: 24, slow: 18 }

/** Сколько минут займёт путь в `miles` миль выбранным темпом (округление вверх до минуты). */
export const travelMinutes = (miles: number, pace: TravelPace = 'normal') => Math.ceil((miles / TRAVEL_MILES_PER_HOUR[pace]) * MINUTES_PER_HOUR)

// ---------- Случайные встречи ----------

/**
 * Сколько раз за промежуток (from, to] наступила отметка «каждые `everyHours` часов» с полуночи Дня 1 —
 * столько бросков на случайную встречу (например, каждые 4 часа пути или ночёвки).
 */
export function checkpointsBetween(from: GameTime, to: GameTime, everyHours: number): number {
  const step = everyHours * MINUTES_PER_HOUR
  if (step <= 0 || to <= from) return 0
  return Math.floor(to / step) - Math.floor(from / step)
}

// ---------- Отдых ----------

/** После долгого отдыха следующий можно начать не раньше чем через 16 часов (SRD 5.2.1). */
export const LONG_REST_COOLDOWN_MINUTES = 16 * MINUTES_PER_HOUR
export const SHORT_REST_MINUTES = 60
export const LONG_REST_MINUTES = 8 * MINUTES_PER_HOUR

/** Сколько минут ещё ждать до следующего долгого отдыха (0 — можно). lastEnd — конец прошлого долгого отдыха. */
export function longRestWait(lastEnd: GameTime | undefined, now: GameTime): number {
  if (lastEnd === undefined) return 0
  return Math.max(0, lastEnd + LONG_REST_COOLDOWN_MINUTES - now)
}
