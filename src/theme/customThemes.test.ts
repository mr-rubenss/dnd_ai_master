import { describe, expect, it } from 'vitest'
import { ACCENTS, APPEARANCE_KEY, appearanceBootData, CUSTOM_THEMES_KEY, DEFAULT_APPEARANCE, MASTER_FONTS } from './appearance'
import { bootAppearance } from './boot'
import {
  contrastLabelsComplete,
  customRecord,
  EDITABLE_COLORS,
  exportThemeFile,
  importThemeFile,
  newCustomId,
  readabilityWarnings,
  readCustomThemes,
  themeFromSettings,
  themeNameProblem,
  withColor,
} from './customThemes'
import { darkFantasy } from './darkFantasy'
import { parseTheme } from './schema'

const mine = themeFromSettings(darkFantasy, DEFAULT_APPEARANCE, 'custom-abc', ' Ночной лес ')

describe('своя тема из текущих настроек', () => {
  it('копия действующей темы с новым id и названием', () => {
    expect(mine.id).toBe('custom-abc')
    expect(mine.name).toBe('Ночной лес')
    expect({ ...mine, id: darkFantasy.id, name: darkFantasy.name }).toEqual(darkFantasy)
    expect(parseTheme(mine)).toEqual(mine)
  })

  it('акцент, шрифт ведущего и компактная плотность запекаются в токены', () => {
    const t = themeFromSettings(
      darkFantasy,
      { ...DEFAULT_APPEARANCE, accent: 'jade', masterFont: 'lora', density: 'compact', textSize: 'xlarge' },
      'custom-x',
      'Нефрит',
    )
    expect(t.colors.accent).toBe(ACCENTS.jade.color)
    expect(t.colors.accentTint).toBe('rgba(111, 180, 143, 0.1)')
    expect(t.fonts.master).toBe(MASTER_FONTS.lora.stack)
    expect(t.space['12']).toBe('8px')
    // Размер текста — настройка устройства, тему не меняет.
    expect(t.fontSizes).toEqual(darkFantasy.fontSizes)
    expect(parseTheme(t)).toEqual(t)
  })

  it('название обязательно и не длиннее 40 символов; id подходит схеме', () => {
    expect(themeNameProblem('  ')).toBe('Введите название темы.')
    expect(themeNameProblem('я'.repeat(41))).toBe('Название — не длиннее 40 символов.')
    expect(themeNameProblem('Сепия')).toBeNull()
    expect(newCustomId(() => 0.5)).toMatch(/^custom-[a-z0-9]+$/)
  })
})

describe('редактор цветов', () => {
  it('меняет токен, не трогая исходную тему', () => {
    const t = withColor(mine, ['colors', 'bg'], '#102030')
    expect(t.colors.bg).toBe('#102030')
    expect(mine.colors.bg).toBe(darkFantasy.colors.bg)
  })

  it('акцент тянет светлый вариант и подложки; пол — и чередующийся оттенок', () => {
    const a = withColor(mine, ['colors', 'accent'], '#79a7d9')
    expect(a.colors.accentBright).not.toBe(mine.colors.accentBright)
    expect(a.colors.focusRing).toBe('rgba(121, 167, 217, 0.2)')
    const f = withColor(mine, ['map', 'floorWood'], '#504030')
    expect([f.map.floorWood, f.map.floorWoodAlt]).toEqual(['#504030', '#504030'])
    expect(parseTheme(a)).toEqual(a)
  })

  it('редактируются фон, текст, акцент, панели и карта', () => {
    const refs = EDITABLE_COLORS.map((c) => c.ref.join('.'))
    expect(refs).toEqual(expect.arrayContaining(['colors.bg', 'colors.fg', 'colors.accent', 'colors.panel', 'map.floorWood', 'map.wallStone']))
  })
})

describe('предупреждение о читаемости', () => {
  it('у «Тёмного фэнтези» предупреждений нет', () => {
    expect(readabilityWarnings(darkFantasy)).toEqual([])
    expect(contrastLabelsComplete()).toBe(true)
  })

  it('плохо читаемый текст — понятное предупреждение с контрастом и порогом', () => {
    const dim = withColor(mine, ['colors', 'fg'], '#3a3530')
    const warnings = readabilityWarnings(dim)
    expect(warnings.map((w) => w.text)).toContain('текст на фоне «фон»')
    expect(warnings.map((w) => w.text)).toContain('текст на фоне «панель»')
    expect(warnings.every((w) => w.ratio < 4.5 && w.required === 4.5)).toBe(true)
  })
})

describe('экспорт и импорт', () => {
  it('экспорт — JSON в формате тем дизайнера, импорт проверяет схему и даёт новый id', () => {
    const file = exportThemeFile(mine)
    expect(file.filename).toBe('custom-abc.json')
    expect(parseTheme(JSON.parse(file.text))).toEqual(mine)
    const imported = importThemeFile(file.text, parseTheme, 'custom-new')
    expect(imported).toEqual({ ...mine, id: 'custom-new' })
  })

  it('не JSON, ошибка схемы — понятная ошибка; длинное название заменяется', () => {
    expect(() => importThemeFile('<html>', parseTheme, 'custom-n')).toThrow('Файл не похож на тему: это не JSON.')
    const broken = { ...structuredClone(mine), colors: { ...mine.colors, bg: 'фиолетовый' } }
    expect(() => importThemeFile(JSON.stringify(broken), parseTheme, 'custom-n')).toThrow('colors.bg: ожидается цвет')
    const { fonts: _fonts, ...noFonts } = mine
    void _fonts
    expect(() => importThemeFile(JSON.stringify(noFonts), parseTheme, 'custom-n')).toThrow('fonts: нет значения')
    expect(importThemeFile(JSON.stringify({ ...mine, name: 'я'.repeat(60) }), parseTheme, 'custom-n').name).toBe('Импортированная тема')
  })
})

describe('хранение своих тем', () => {
  it('из хранилища читаются только корректные записи', () => {
    const good = customRecord(mine)
    const raw = JSON.stringify([good, { theme: { ...mine, id: 'dark-fantasy' } }, { theme: { ...mine, id: 'custom-z', colors: {} } }, null, 5])
    expect(readCustomThemes(raw, darkFantasy)).toEqual([mine])
    expect(readCustomThemes('не json', darkFantasy)).toEqual([])
    expect(readCustomThemes(null, darkFantasy)).toEqual([])
  })

  it('своя тема, сохранённая до новых токенов карты, дополняется значениями эталона', () => {
    const old = structuredClone(mine)
    delete (old.map as Partial<typeof old.map>).floorTile
    delete (old.map as Partial<typeof old.map>).lightWarm
    const [read] = readCustomThemes(JSON.stringify([customRecord(old)]), darkFantasy)
    expect(read.map.floorTile).toBe(darkFantasy.map.floorTile)
    expect(read.map.floorWood).toBe(mine.map.floorWood)
  })

  it('загрузочный скрипт применяет свою тему из хранилища до отрисовки; битые записи пропускает', () => {
    const blue = withColor(mine, ['colors', 'bg'], '#102030')
    const items: Record<string, string> = {
      [APPEARANCE_KEY]: JSON.stringify({ themeId: blue.id }),
      [CUSTOM_THEMES_KEY]: JSON.stringify([{ theme: { id: 'custom-bad' }, compiled: { vars: 'x' } }, customRecord(blue)]),
    }
    const vars: Record<string, string> = {}
    const root = {
      style: { setProperty: (n: string, v: string) => void (vars[n] = v), colorScheme: '', fontSize: '' },
      dataset: {} as Record<string, string | undefined>,
    }
    const result = bootAppearance(appearanceBootData([darkFantasy]), { root, storage: { getItem: (k) => items[k] ?? null } })
    expect(result.themeId).toBe('custom-abc')
    expect(vars['--color-bg']).toBe('#102030')
    expect(root.dataset.theme).toBe('custom-abc')
  })
})
