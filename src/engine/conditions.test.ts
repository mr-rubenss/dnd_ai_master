import { describe, expect, it } from 'vitest'
import { CONDITION_DEFINITIONS, CONDITIONS, conditionEffects, effectiveConditions, resolveRollMode } from './conditions'

describe('состояния', () => {
  it('в SRD 5.2 15 состояний, у каждого есть название и описание', () => {
    expect(CONDITIONS).toHaveLength(15)
    for (const id of CONDITIONS) {
      expect(CONDITION_DEFINITIONS[id].name).not.toBe('')
      expect(CONDITION_DEFINITIONS[id].summary).not.toBe('')
    }
  })

  it('Без сознания включает Недееспособен и Сбит с ног', () => {
    expect([...effectiveConditions([{ id: 'unconscious' }])].sort()).toEqual(['incapacitated', 'prone', 'unconscious'])
    expect(effectiveConditions([{ id: 'stunned' }]).has('incapacitated')).toBe(true)
  })

  it('влияние на броски атаки самого существа', () => {
    expect(conditionEffects([{ id: 'invisible' }], { kind: 'attack' }).advantage).toEqual(['Невидим'])
    expect(conditionEffects([{ id: 'blinded' }], { kind: 'attack' }).disadvantage).toEqual(['Ослеплён'])
    expect(conditionEffects([{ id: 'unconscious' }], { kind: 'attack' }).disadvantage).toEqual(['Сбит с ног'])
    expect(conditionEffects([{ id: 'poisoned' }, { id: 'restrained' }], { kind: 'attack' }).disadvantage).toEqual(['Отравлен', 'Опутан'])
  })

  it('Истощение уменьшает любой бросок к20 на 2 × уровень', () => {
    for (const kind of ['check', 'save', 'attack'] as const) {
      expect(conditionEffects([{ id: 'exhaustion', level: 2 }], { kind, ability: 'str' }).penalty).toBe(4)
    }
  })

  it('Очарован, Схвачен и Недееспособен не меняют собственные проверки', () => {
    const effects = conditionEffects([{ id: 'charmed' }, { id: 'grappled' }, { id: 'incapacitated' }], { kind: 'check', ability: 'cha' })
    expect(effects).toEqual({ advantage: [], disadvantage: [], autoFail: null, penalty: 0 })
  })

  it('преимущество и помеха отменяют друг друга', () => {
    expect(resolveRollMode(true, true)).toBe('normal')
    expect(resolveRollMode(true, false)).toBe('advantage')
    expect(resolveRollMode(false, true)).toBe('disadvantage')
    expect(resolveRollMode(false, false)).toBe('normal')
  })
})
