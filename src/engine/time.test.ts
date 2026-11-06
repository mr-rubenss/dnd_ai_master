import { describe, expect, it } from 'vitest'
import {
  advanceProblem,
  advanceTime,
  checkpointsBetween,
  clockText,
  dayOf,
  durationText,
  gameTime,
  hourOf,
  isDaytime,
  longRestWait,
  minutesUntilHour,
  minutesUntilPart,
  outdoorLight,
  partOfDay,
  timeLabel,
  timeText,
  travelMinutes,
} from './time'

describe('игровое время', () => {
  it('день, час, время суток и подписи', () => {
    const t = gameTime(3, 19, 5)
    expect(dayOf(t)).toBe(3)
    expect(hourOf(t)).toBe(19)
    expect(clockText(t)).toBe('19:05')
    expect(timeLabel(t)).toBe('День 3, вечер')
    expect(timeText(t)).toBe('День 3, 19:05 (вечер)')
    expect(dayOf(gameTime(1, 23, 59))).toBe(1)
    expect(dayOf(gameTime(1, 23, 59) + 1)).toBe(2)
  })

  it('границы времени суток: утро 6–11, день 12–17, вечер 18–21, ночь 22–5', () => {
    const parts = Array.from({ length: 24 }, (_, h) => partOfDay(gameTime(1, h)))
    expect(parts.slice(0, 6).every((p) => p === 'night')).toBe(true)
    expect(parts.slice(6, 12).every((p) => p === 'morning')).toBe(true)
    expect(parts.slice(12, 18).every((p) => p === 'day')).toBe(true)
    expect(parts.slice(18, 22).every((p) => p === 'evening')).toBe(true)
    expect(parts.slice(22).every((p) => p === 'night')).toBe(true)
    expect(isDaytime(gameTime(1, 9))).toBe(true)
    expect(isDaytime(gameTime(1, 20))).toBe(false)
  })

  it('время идёт только вперёд', () => {
    expect(advanceTime(gameTime(1, 19), 90)).toBe(gameTime(1, 20, 30))
    expect(advanceProblem(0)).toMatch(/не идёт назад/)
    expect(advanceProblem(-60)).toMatch(/не идёт назад/)
    expect(advanceProblem(1.5)).toMatch(/целое/)
    expect(advanceProblem(31 * 24 * 60)).toMatch(/30 дней/)
    expect(() => advanceTime(0, -1)).toThrow(RangeError)
  })

  it('«до утра» и «до часа» — ближайший в будущем', () => {
    expect(minutesUntilPart(gameTime(1, 22), 'morning')).toBe(8 * 60)
    expect(minutesUntilPart(gameTime(2, 3), 'morning')).toBe(3 * 60)
    expect(minutesUntilHour(gameTime(1, 7), 7)).toBe(24 * 60)
    expect(minutesUntilHour(gameTime(1, 7, 30), 8)).toBe(30)
  })

  it('длительность словами', () => {
    expect(durationText(45)).toBe('45 мин')
    expect(durationText(150)).toBe('2 ч 30 мин')
    expect(durationText(28 * 60)).toBe('1 д 4 ч')
  })

  it('свет под открытым небом: день — яркий, сумерки — тусклый, ночь — тьма', () => {
    expect(outdoorLight(gameTime(1, 12))).toBe('bright')
    expect(outdoorLight(gameTime(1, 6))).toBe('dim')
    expect(outdoorLight(gameTime(1, 19))).toBe('dim')
    expect(outdoorLight(gameTime(1, 23))).toBe('darkness')
  })

  it('путешествия по темпу SRD 5.2.1: 4/3/2 мили в час', () => {
    expect(travelMinutes(24)).toBe(8 * 60)
    expect(travelMinutes(6, 'fast')).toBe(90)
    expect(travelMinutes(1, 'slow')).toBe(30)
  })

  it('случайные встречи: сколько отметок «каждые N часов» пройдено', () => {
    expect(checkpointsBetween(gameTime(1, 19), gameTime(2, 7), 4)).toBe(3) // 20:00, 0:00, 4:00
    expect(checkpointsBetween(gameTime(1, 19), gameTime(1, 19, 30), 4)).toBe(0)
    expect(checkpointsBetween(gameTime(1, 10), gameTime(1, 9), 4)).toBe(0)
  })

  it('долгий отдых: следующий — не раньше чем через 16 часов', () => {
    expect(longRestWait(undefined, gameTime(1, 8))).toBe(0)
    expect(longRestWait(gameTime(2, 6), gameTime(2, 20))).toBe(2 * 60)
    expect(longRestWait(gameTime(2, 6), gameTime(2, 22))).toBe(0)
  })
})
