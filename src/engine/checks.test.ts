import { describe, expect, it, vi } from 'vitest'
import {
  abilityCheck,
  CheckError,
  formatD20Test,
  passivePerception,
  savingThrow,
  savingThrowModifier,
  skillModifier,
  type CheckSubject,
} from './checks'
import type { ActiveCondition } from './conditions'
import type { Rng } from './dice'
import { SKILLS } from './skills'

/** Генератор, который выдаёт заданные значения к20 по очереди. */
function d20(...faces: number[]): Rng & { calls: () => number } {
  const queue = faces.map((f) => (f - 0.5) / 20)
  let calls = 0
  const rng = () => {
    calls++
    if (queue.length === 0) throw new Error('Лишний бросок к20')
    return queue.shift()!
  }
  return Object.assign(rng, { calls: () => calls })
}

/** Ратибор: воин 1-го уровня, Солдат. СИЛ 17, ЛОВ 14, ТЕЛ 14, ИНТ 8, МДР 12, ХАР 10. */
function ratibor(conditions: ActiveCondition[] = []): CheckSubject {
  return {
    level: 1,
    abilities: { str: 17, dex: 14, con: 14, int: 8, wis: 12, cha: 10 },
    proficiencies: {
      savingThrows: ['str', 'con'],
      skills: { athletics: 'proficient', intimidation: 'proficient', perception: 'proficient', survival: 'proficient' },
      armor: ['light', 'medium', 'heavy', 'shield'],
      tools: [],
    },
    conditions,
  }
}

/** Плут 5-го уровня с компетентностью в Скрытности и Ловкости рук. ЛОВ 18, БМ +3. */
const rogue: CheckSubject = {
  level: 5,
  abilities: { str: 10, dex: 18, con: 12, int: 13, wis: 14, cha: 8 },
  proficiencies: {
    savingThrows: ['dex', 'int'],
    skills: { stealth: 'expertise', 'sleight-of-hand': 'expertise', perception: 'proficient' },
    armor: ['light'],
    tools: ['thieves-tools'],
  },
  conditions: [],
}

describe('модификаторы навыков и спасбросков', () => {
  it('навык с владением: характеристика + БМ', () => {
    expect(skillModifier(ratibor(), 'athletics')).toBe(3 + 2)
    expect(skillModifier(ratibor(), 'perception')).toBe(1 + 2)
  })

  it('навык без владения: только характеристика', () => {
    expect(skillModifier(ratibor(), 'stealth')).toBe(2)
    expect(skillModifier(ratibor(), 'arcana')).toBe(-1)
  })

  it('компетентность удваивает бонус мастерства', () => {
    expect(skillModifier(rogue, 'stealth')).toBe(4 + 2 * 3)
    expect(skillModifier(rogue, 'perception')).toBe(2 + 3)
    expect(skillModifier(rogue, 'athletics')).toBe(0)
  })

  it('спасброски: БМ только при владении', () => {
    expect(savingThrowModifier(ratibor(), 'str')).toBe(5)
    expect(savingThrowModifier(ratibor(), 'con')).toBe(4)
    expect(savingThrowModifier(ratibor(), 'dex')).toBe(2)
    expect(savingThrowModifier(ratibor(), 'wis')).toBe(1)
  })

  it('все 18 навыков считаются для любого персонажа', () => {
    expect(SKILLS).toHaveLength(18)
    for (const skill of SKILLS) expect(Number.isInteger(skillModifier(rogue, skill))).toBe(true)
  })
})

describe('пассивное Восприятие', () => {
  it('10 + модификатор Внимательности', () => {
    expect(passivePerception(ratibor())).toBe(13)
    expect(passivePerception(rogue)).toBe(15)
  })

  it('+5 при преимуществе, −5 при помехе', () => {
    expect(passivePerception(ratibor(), 'advantage')).toBe(18)
    expect(passivePerception(ratibor(), 'disadvantage')).toBe(8)
  })

  it('Отравлен даёт помеху на проверки — и пассивную тоже', () => {
    expect(passivePerception(ratibor([{ id: 'poisoned' }]))).toBe(8)
    // Преимущество и помеха гасят друг друга.
    expect(passivePerception(ratibor([{ id: 'poisoned' }]), 'advantage')).toBe(13)
  })
})

describe('проверка характеристики или навыка', () => {
  it('успех, если итог равен Сл', () => {
    const result = abilityCheck(ratibor(), { skill: 'athletics' }, { dc: 15, rng: d20(10) })
    expect(result).toMatchObject({
      kind: 'check',
      ability: 'str',
      skill: 'athletics',
      label: 'Сила (Атлетика)',
      modifier: 5,
      total: 15,
      success: true,
      margin: 0,
      mode: 'normal',
    })
    expect(result.modifiers).toEqual([
      { label: 'Сила', value: 3 },
      { label: 'Владение', value: 2 },
    ])
  })

  it('провал, если итог на 1 меньше Сл', () => {
    const result = abilityCheck(ratibor(), { skill: 'athletics' }, { dc: 15, rng: d20(9) })
    expect(result).toMatchObject({ total: 14, success: false, margin: -1 })
  })

  it('проверка чистой характеристики — без бонуса мастерства', () => {
    const result = abilityCheck(ratibor(), { ability: 'int' }, { dc: 10, rng: d20(10) })
    expect(result).toMatchObject({ label: 'Проверка Интеллекта', modifier: -1, total: 9, success: false })
  })

  it('компетентность попадает в разбивку модификатора', () => {
    const result = abilityCheck(rogue, { skill: 'stealth' }, { dc: 20, rng: d20(10) })
    expect(result.modifiers).toEqual([
      { label: 'Ловкость', value: 4 },
      { label: 'Компетентность', value: 6 },
    ])
    expect(result).toMatchObject({ total: 20, success: true })
  })

  it('натуральная 20 не даёт автоуспеха, натуральная 1 — автопровала', () => {
    expect(abilityCheck(ratibor(), { ability: 'int' }, { dc: 25, rng: d20(20) })).toMatchObject({ total: 19, success: false })
    expect(abilityCheck(ratibor(), { skill: 'athletics' }, { dc: 5, rng: d20(1) })).toMatchObject({ total: 6, success: true })
  })

  it('преимущество: бросает два к20 и берёт больший', () => {
    const rng = d20(4, 17)
    const result = abilityCheck(ratibor(), { skill: 'perception' }, { dc: 15, mode: 'advantage', rng })
    expect(rng.calls()).toBe(2)
    expect(result).toMatchObject({ mode: 'advantage', total: 20, success: true, advantageReasons: ['запрошено'] })
  })

  it('помеха: берёт меньший', () => {
    const result = abilityCheck(ratibor(), { skill: 'perception' }, { dc: 10, mode: 'disadvantage', rng: d20(4, 17) })
    expect(result).toMatchObject({ mode: 'disadvantage', total: 7, success: false })
  })

  it.each([0, 31, 12.5])('Сл %s — ошибка', (dc) => {
    expect(() => abilityCheck(ratibor(), { ability: 'str' }, { dc, rng: d20(10) })).toThrow(CheckError)
  })
})

describe('спасброски', () => {
  it('с владением добавляется БМ', () => {
    const result = savingThrow(ratibor(), 'con', { dc: 12, rng: d20(8) })
    expect(result).toMatchObject({ kind: 'save', label: 'Спасбросок Телосложения', modifier: 4, total: 12, success: true })
  })

  it('без владения — только характеристика', () => {
    expect(savingThrow(ratibor(), 'wis', { dc: 12, rng: d20(10) })).toMatchObject({ modifier: 1, total: 11, success: false })
  })
})

describe('влияние состояний', () => {
  it('Отравлен: помеха на проверки, но не на спасброски', () => {
    const poisoned = ratibor([{ id: 'poisoned' }])
    const check = abilityCheck(poisoned, { skill: 'athletics' }, { dc: 10, rng: d20(18, 3) })
    expect(check).toMatchObject({ mode: 'disadvantage', disadvantageReasons: ['Отравлен'], total: 8, success: false })
    const save = savingThrow(poisoned, 'con', { dc: 10, rng: d20(18) })
    expect(save).toMatchObject({ mode: 'normal', total: 22 })
  })

  it('Испуган: помеха на проверки', () => {
    const result = abilityCheck(ratibor([{ id: 'frightened' }]), { skill: 'intimidation' }, { dc: 10, rng: d20(15, 5) })
    expect(result).toMatchObject({ mode: 'disadvantage', disadvantageReasons: ['Испуган'], total: 7 })
  })

  it('преимущество от помощи и помеха от яда отменяют друг друга — бросается один к20', () => {
    const rng = d20(12)
    const result = abilityCheck(ratibor([{ id: 'poisoned' }]), { skill: 'athletics' }, { dc: 10, mode: 'advantage', rng })
    expect(rng.calls()).toBe(1)
    expect(result).toMatchObject({
      mode: 'normal',
      advantageReasons: ['запрошено'],
      disadvantageReasons: ['Отравлен'],
      total: 17,
    })
  })

  it('Ослеплён: проверка, требующая зрения, проваливается без броска', () => {
    const rng = d20()
    const result = abilityCheck(ratibor([{ id: 'blinded' }]), { skill: 'perception' }, { dc: 5, requiresSight: true, rng })
    expect(rng.calls()).toBe(0)
    expect(result).toMatchObject({ roll: null, total: null, success: false, autoFailReason: 'Ослеплён: проверка требует зрения' })
  })

  it('Ослеплён: проверка без зрения (например, на слух) бросается как обычно', () => {
    const result = abilityCheck(ratibor([{ id: 'blinded' }]), { skill: 'perception' }, { dc: 10, requiresHearing: true, rng: d20(10) })
    expect(result).toMatchObject({ success: true, total: 13, autoFailReason: null })
  })

  it('Оглох: проверка на слух проваливается', () => {
    const result = abilityCheck(ratibor([{ id: 'deafened' }]), { skill: 'perception' }, { dc: 5, requiresHearing: true, rng: d20() })
    expect(result.autoFailReason).toBe('Оглох: проверка требует слуха')
  })

  it.each([
    ['paralyzed', 'Парализован'],
    ['stunned', 'Ошеломлён'],
    ['unconscious', 'Без сознания'],
    ['petrified', 'Окаменел'],
  ] as const)('%s: спасброски Силы и Ловкости проваливаются автоматически, Телосложения — нет', (id, name) => {
    const subject = ratibor([{ id }])
    expect(savingThrow(subject, 'str', { dc: 1, rng: d20() })).toMatchObject({
      success: false,
      roll: null,
      autoFailReason: `${name}: спасбросок Силы автоматически провален`,
    })
    expect(savingThrow(subject, 'dex', { dc: 1, rng: d20() }).autoFailReason).toBe(`${name}: спасбросок Ловкости автоматически провален`)
    expect(savingThrow(subject, 'con', { dc: 10, rng: d20(10) })).toMatchObject({ success: true, autoFailReason: null })
  })

  it('Опутан: помеха только на спасброски Ловкости', () => {
    const subject = ratibor([{ id: 'restrained' }])
    expect(savingThrow(subject, 'dex', { dc: 10, rng: d20(15, 6) })).toMatchObject({ mode: 'disadvantage', total: 8 })
    expect(savingThrow(subject, 'str', { dc: 10, rng: d20(15) })).toMatchObject({ mode: 'normal' })
    expect(abilityCheck(subject, { skill: 'acrobatics' }, { dc: 10, rng: d20(15) })).toMatchObject({ mode: 'normal' })
  })

  it('Истощение 3: −6 к проверкам и спасброскам, штраф виден в разбивке', () => {
    const subject = ratibor([{ id: 'exhaustion', level: 3 }])
    const check = abilityCheck(subject, { skill: 'athletics' }, { dc: 10, rng: d20(10) })
    expect(check.modifiers).toContainEqual({ label: 'Истощение 3', value: -6 })
    expect(check).toMatchObject({ modifier: -1, total: 9, success: false })
    expect(savingThrow(subject, 'con', { dc: 10, rng: d20(10) })).toMatchObject({ modifier: -2, total: 8 })
  })

  it('Отравлен и Испуган одновременно — всё равно одна помеха (два к20)', () => {
    const rng = d20(20, 2)
    const result = abilityCheck(ratibor([{ id: 'poisoned' }, { id: 'frightened' }]), { ability: 'str' }, { dc: 10, rng })
    expect(rng.calls()).toBe(2)
    expect(result).toMatchObject({ mode: 'disadvantage', disadvantageReasons: ['Отравлен', 'Испуган'], total: 5 })
  })
})

describe('formatD20Test', () => {
  it('описывает успех, провал и автопровал', () => {
    expect(formatD20Test(abilityCheck(ratibor(), { skill: 'perception' }, { dc: 15, mode: 'advantage', rng: d20(4, 17) }))).toBe(
      'Мудрость (Внимательность), Сл 15, преимущество: 1к20+3 → [(4), 17] + 3 = 20 — успех',
    )
    expect(formatD20Test(abilityCheck(ratibor(), { ability: 'int' }, { dc: 10, rng: d20(5) }))).toBe(
      'Проверка Интеллекта, Сл 10: 1к20-1 → [5] − 1 = 4 — провал',
    )
    expect(formatD20Test(savingThrow(ratibor([{ id: 'stunned' }]), 'dex', { dc: 12, rng: vi.fn() }))).toBe(
      'Спасбросок Ловкости, Сл 12: автоматический провал (Ошеломлён: спасбросок Ловкости автоматически провален)',
    )
  })
})
