import { describe, expect, it } from 'vitest'
import { calibrated, estimate, MAX_FACTOR, MESSAGE_OVERHEAD, MIN_FACTOR, rawMessageTokens, rawTokens, rawToolsTokens } from './tokens'

describe('примерный подсчёт токенов', () => {
  it('по символам, кириллица дороже латиницы', () => {
    expect(rawTokens('')).toBe(0)
    const ru = rawTokens('а'.repeat(260))
    const en = rawTokens('a'.repeat(260))
    expect(ru).toBe(100)
    expect(en).toBe(69)
    expect(ru).toBeGreaterThan(en)
  })

  it('сообщение: текст, вызовы инструментов и служебные токены', () => {
    expect(rawMessageTokens({ role: 'user', content: '' })).toBe(MESSAGE_OVERHEAD)
    const withCall = rawMessageTokens({ role: 'assistant', content: null, toolCalls: [{ id: 'a', name: 'note_fact', arguments: {}, rawArguments: '{"text":"x"}' }] })
    expect(withCall).toBeGreaterThan(2 * MESSAGE_OVERHEAD)
    expect(rawToolsTokens([])).toBe(0)
    expect(rawToolsTokens([{ name: 'x', description: 'y', parameters: {} }])).toBeGreaterThan(0)
  })

  it('поправка по usage: сглаженно, в пределах, без деления на ноль', () => {
    expect(calibrated(1, 1000, 1500)).toBe(1.2)
    expect(calibrated(1.2, 1000, 1500)).toBe(1.32)
    expect(calibrated(1, 1000, 100_000)).toBe(MAX_FACTOR)
    expect(calibrated(1, 1000, 1)).toBe(0.6)
    expect(calibrated(0.6, 1000, 1)).toBe(MIN_FACTOR)
    expect(calibrated(1.1, 0, 500)).toBe(1.1)
    expect(calibrated(1.1, 500, 0)).toBe(1.1)
    expect(estimate(1000, 1.25)).toBe(1250)
  })
})
