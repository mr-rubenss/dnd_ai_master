import { describe, expect, it } from 'vitest'
import { MAX_SUGGESTION_LENGTH, parseSuggestions, rewritableMessageId, splitSuggestions, streamingText, suggestionsProblem } from './masterSuggestions'

describe('подсказки ведущего: строка «Варианты: …»', () => {
  it('вырезается из конца рассказа', () => {
    expect(splitSuggestions('Дверь скрипит.\n\nВарианты: Войти | Прислушаться | Позвать стражу')).toEqual({
      text: 'Дверь скрипит.',
      suggestions: ['Войти', 'Прислушаться', 'Позвать стражу'],
    })
  })

  it('без строки — рассказ как есть, подсказок нет', () => {
    expect(splitSuggestions('  Дверь скрипит.  ')).toEqual({ text: 'Дверь скрипит.', suggestions: [] })
    // «варианты» внутри рассказа — не строка подсказок.
    expect(splitSuggestions('Есть варианты: бежать или драться.').suggestions).toEqual([])
  })

  it('терпимо к разметке, кавычкам, нумерации, переносу и «;»', () => {
    expect(splitSuggestions('Тишина.\n**Варианты:** «Войти»; 2. Прислушаться').suggestions).toEqual(['Войти', 'Прислушаться'])
    expect(splitSuggestions('Тишина.\n- варианты:\nВойти | Уйти').suggestions).toEqual(['Войти', 'Уйти'])
  })

  it('не больше трёх, без повторов, пустых и слишком длинных', () => {
    expect(parseSuggestions('А | б | | А | В | Г')).toEqual(['А', 'б', 'В'])
    expect(parseSuggestions(`${'х'.repeat(MAX_SUGGESTION_LENGTH + 1)} | Уйти`)).toEqual(['Уйти'])
  })

  it('в потоке: строка подсказок и её недописанное начало не показываются', () => {
    expect(streamingText('Дверь скрипит.')).toBe('Дверь скрипит.')
    expect(streamingText('Дверь скрипит.\n\nВар')).toBe('Дверь скрипит.')
    expect(streamingText('Дверь скрипит.\n\n**Варианты:** Войти | Уй')).toBe('Дверь скрипит.')
    expect(streamingText('Дверь скрипит.\nВдруг')).toBe('Дверь скрипит.\nВдруг')
  })

  it('проверка подсказок в действии', () => {
    expect(suggestionsProblem(undefined)).toBeNull()
    expect(suggestionsProblem(['Войти', 'Уйти'])).toBeNull()
    expect(suggestionsProblem(['а', 'б', 'в', 'г'])).toBe('Подсказок может быть не больше 3.')
    expect(suggestionsProblem([' '])).toBe('Подсказка должна быть короткой непустой строкой.')
    expect(suggestionsProblem('Войти')).toBe('Подсказок может быть не больше 3.')
  })

  it('переписать можно только последний ответ ведущего, не карточку броска', () => {
    expect(rewritableMessageId([])).toBeNull()
    expect(rewritableMessageId([{ id: 'm', author: 'master', text: 'а' }])).toBe('m')
    expect(rewritableMessageId([{ id: 'm', author: 'master', text: 'а' }, { id: 'p', author: 'player', text: 'б' }])).toBeNull()
    expect(rewritableMessageId([{ id: 'c', author: 'system', text: 'бросок', check: {} as never }])).toBeNull()
  })
})
