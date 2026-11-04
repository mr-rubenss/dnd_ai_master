import { describe, expect, it } from 'vitest'
import { darkFantasy } from './darkFantasy'
import { loadDesignThemes } from './designThemes'
import { DEFAULT_THEME_ID, defaultTheme, themeById, themes } from './registry'
import { parseTheme } from './schema'
import type { Theme } from './types'

const variant = (id: string, name = id): Theme => ({ ...structuredClone(darkFantasy), id, name })
const file = (theme: unknown, name = `${(theme as Theme).id}.json`) => ({ name, text: JSON.stringify(theme) })

describe('реестр тем', () => {
  it('по умолчанию — «Тёмное фэнтези», она первая в списке', () => {
    expect(DEFAULT_THEME_ID).toBe('dark-fantasy')
    expect(defaultTheme.name).toBe('Тёмное фэнтези')
    expect(themes[0]).toBe(defaultTheme)
    expect(themeById('dark-fantasy')).toBe(defaultTheme)
    expect(themeById('нет-такой')).toBeUndefined()
  })

  it('каждая тема реестра проходит схему, id не повторяются', () => {
    for (const theme of themes) expect(parseTheme(theme)).toEqual(theme)
    expect(new Set(themes.map((t) => t.id)).size).toBe(themes.length)
  })
})

describe('темы дизайнера из design/themes/', () => {
  it('корректные файлы попадают в реестр по порядку имён', () => {
    const loaded = loadDesignThemes([file(variant('sepia', 'Сепия')), file(variant('high-contrast'))], ['dark-fantasy'])
    expect(loaded.map((t) => t.id)).toEqual(['high-contrast', 'sepia'])
    expect(loaded[1].name).toBe('Сепия')
    expect(loadDesignThemes([])).toEqual([])
  })

  it('не JSON — ошибка с именем файла', () => {
    expect(() => loadDesignThemes([{ name: 'sepia.json', text: '{ id: sepia' }])).toThrow(/^design\/themes\/sepia\.json: не JSON/)
  })

  it('ошибка схемы — с именем файла и полем', () => {
    const theme = variant('sepia')
    theme.colors.bg = 'коричневый'
    delete (theme.map as Partial<Theme['map']>).door
    const load = () => loadDesignThemes([file(theme)])
    expect(load).toThrow('design/themes/sepia.json: Тема оформления некорректна')
    expect(load).toThrow('colors.bg: ожидается цвет')
    expect(load).toThrow('map.door: нет значения')
    expect(() => loadDesignThemes([file({ ...variant('sepia'), extra: 1 })])).toThrow('лишние ключи: extra')
  })

  it('имя файла — по id темы', () => {
    expect(() => loadDesignThemes([file(variant('sepia'), 'Сепия.json')])).toThrow(
      'design/themes/Сепия.json: файл темы должен называться по её id — «sepia.json»',
    )
  })

  it('id не повторяются и не занимают id встроенной темы', () => {
    expect(() => loadDesignThemes([file(variant('dark-fantasy'))], ['dark-fantasy'])).toThrow('тема с id «dark-fantasy» уже есть')
  })
})
