import { describe, expect, it } from 'vitest'
import { armorTrainingText } from './itemText'

describe('armorTrainingText', () => {
  it.each([
    [['light', 'medium', 'heavy', 'shield'], 'Все доспехи, щиты'],
    [['light', 'medium', 'shield'], 'Лёгкие и средние доспехи, щиты'],
    [['light', 'shield'], 'Лёгкие доспехи, щиты'],
    [['light'], 'Лёгкие доспехи'],
    [['light', 'medium', 'heavy'], 'Все доспехи'],
    [['shield'], 'Щиты'],
    [[], 'нет'],
  ] as const)('%j → «%s»', (training, text) => {
    expect(armorTrainingText(training)).toBe(text)
  })
})
