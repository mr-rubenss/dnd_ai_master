import { describe, expect, it } from 'vitest'
import { AI_PRESETS, aiConnection, baseUrlProblem, DEFAULT_AI_SETTINGS, parseAiSettings, settingsProblems, VERBOSITY } from './settings'

describe('настройки ведущего', () => {
  it('пресет DeepSeek: адрес и модель — из пресета', () => {
    expect(AI_PRESETS.deepseek).toEqual({ name: 'DeepSeek', format: 'openai-chat', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' })
    expect(aiConnection({ ...DEFAULT_AI_SETTINGS, baseUrl: 'https://evil.example', model: 'x' }, ' sk-1 ')).toEqual({
      format: 'openai-chat',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKey: 'sk-1',
    })
  })

  it('«Свой»: адрес и модель вводятся вручную', () => {
    const custom = { ...DEFAULT_AI_SETTINGS, provider: 'custom' as const, baseUrl: ' https://api.example.com/v1 ', model: ' gpt-x ' }
    expect(aiConnection(custom, 'k')).toMatchObject({ baseUrl: 'https://api.example.com/v1', model: 'gpt-x' })
    expect(settingsProblems(custom, 'k')).toEqual([])
    expect(settingsProblems({ ...custom, baseUrl: '', model: '' }, '')).toEqual([
      'Укажите адрес API.',
      'Укажите название модели.',
      'Введите ключ API.',
    ])
    expect(settingsProblems(DEFAULT_AI_SETTINGS, '')).toEqual(['Введите ключ API.'])
  })

  it('адрес API: только https (http — для localhost), без логина и параметров', () => {
    expect(baseUrlProblem('https://api.deepseek.com')).toBeNull()
    expect(baseUrlProblem('http://localhost:8787')).toBeNull()
    expect(baseUrlProblem('http://api.example.com')).toContain('https://')
    expect(baseUrlProblem('api.example.com')).toBe('Адрес API должен начинаться с https://')
    expect(baseUrlProblem('https://user:pass@api.example.com')).toContain('логин')
    expect(baseUrlProblem('https://api.example.com/v1?key=1')).toContain('без параметров')
  })

  it('из хранилища: неизвестные значения — стандартные; ключ в настройках не хранится', () => {
    expect(parseAiSettings(null)).toEqual(DEFAULT_AI_SETTINGS)
    expect(parseAiSettings('{битое')).toEqual(DEFAULT_AI_SETTINGS)
    expect(parseAiSettings(JSON.stringify({ provider: 'openai', format: 'claude', verbosity: 'epic', baseUrl: 5 }))).toEqual(DEFAULT_AI_SETTINGS)
    const custom = { provider: 'custom', format: 'openai-chat', baseUrl: 'https://x.io', model: 'm', verbosity: 'short', apiKey: 'sk-zzz' }
    expect(parseAiSettings(JSON.stringify(custom))).toEqual({
      provider: 'custom',
      format: 'openai-chat',
      baseUrl: 'https://x.io',
      model: 'm',
      verbosity: 'short',
    })
  })

  it('длина ответов: коротко / обычно / подробно', () => {
    expect(Object.values(VERBOSITY).map((v) => v.name)).toEqual(['Коротко', 'Обычно', 'Подробно'])
    expect(VERBOSITY.short.maxTokens).toBeLessThan(VERBOSITY.normal.maxTokens)
    expect(VERBOSITY.normal.maxTokens).toBeLessThan(VERBOSITY.detailed.maxTokens)
  })
})
