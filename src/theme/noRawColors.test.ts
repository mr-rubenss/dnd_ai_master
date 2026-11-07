import { describe, expect, it } from 'vitest'
import { findRawColors } from './rawColors'

// Все стили и компоненты, кроме самих тем (src/theme/) и тестов.
const files = import.meta.glob(['../**/*.{css,ts,tsx}', '!./**', '!../**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('цвета только из токенов темы', () => {
  it('проверяются стили и компоненты', () => {
    const names = Object.keys(files)
    expect(names).toContain('../index.css')
    expect(names).toContain('../components/MapDefs.tsx')
    expect(names.some((n) => n.startsWith('./'))).toBe(false)
    // Тексты настоящие (Vitest без `css: true` отдал бы CSS пустым — и проверка прошла бы вхолостую).
    expect(files['../index.css']).toContain('var(--color-bg)')
    expect(files['../components/MapDefs.tsx']).toContain("token('map', 'fireGlow')")
  })

  it('ни в стилях, ни в компонентах нет цветов, заданных напрямую', () => {
    const problems = Object.entries(files).flatMap(([name, source]) =>
      findRawColors(source, name.endsWith('.css') ? 'css' : 'code').map((c) => `${name.slice(3)}:${c.line} — ${c.text}`),
    )
    expect(problems, 'используйте токены темы: var(--color-…) в CSS, token(группа, ключ) в коде (src/theme/)').toEqual([])
  })
})

describe('поиск цветов мимо токенов', () => {
  it('находит hex, цветовые функции и именованные цвета в CSS', () => {
    const css = ['.a { color: #fff; }', '.b { background: rgba(0, 0, 0, 0.5); }', '.c {', '  border: 1px solid red;', '  box-shadow: 0 0 2px hsl(10 20% 30%);', '}'].join('\n')
    expect(findRawColors(css, 'css')).toEqual([
      { line: 1, text: '#fff' },
      { line: 2, text: 'rgba(…)' },
      { line: 4, text: 'red' },
      { line: 5, text: 'hsl(…)' },
    ])
  })

  it('находит цвета в разметке и стилях компонентов', () => {
    const code = ['<stop stopColor="#ff9a3c" />', '<rect fill="white" />', "const s = { color: 'black' }", "const t = { background: 'rgb(1, 2, 3)' }"].join('\n')
    expect(findRawColors(code, 'code').map((c) => [c.line, c.text])).toEqual([
      [1, '#ff9a3c'],
      [2, 'white'],
      [3, 'black'],
      [4, 'rgb(…)'],
    ])
  })

  it('пропускает токены, служебные значения, ссылки на элементы и комментарии', () => {
    const css = [
      '.a { color: var(--color-fg); background: transparent; fill: url(#fire-glow); stroke: currentColor; }',
      '/* было: #c9a45c, rgba(0, 0, 0, 0.5) */',
      '.b { font-family: var(--font-ui); white-space: nowrap; border-color: inherit; }',
      '.c { grid-template-areas: "red blue"; }',
    ].join('\n')
    expect(findRawColors(css, 'css')).toEqual([])
    const code = [
      "<rect fill=\"url(#cell-grid)\" style={{ stopColor: token('map', 'fireGlow') }} />",
      '// цвет #fff задаётся темой',
      "const label = 'Красный дракон'; const url = 'https://example.com/#abc'",
    ].join('\n')
    expect(findRawColors(code, 'code')).toEqual([])
  })
})
