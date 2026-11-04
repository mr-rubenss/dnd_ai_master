// Темы дизайнера: JSON-файлы из design/themes/. Плагин Vite (`vite.config.ts`) читает файлы при сборке и передаёт
// их сюда; некорректный файл ломает сборку с понятной ошибкой. В браузер попадают уже проверенные темы — без zod.
import { parseTheme } from './schema.ts'
import type { Theme } from './types.ts'

/** Папка с темами дизайнера (от корня проекта). */
export const DESIGN_THEMES_DIR = 'design/themes'

export interface ThemeFile {
  /** Имя файла, например `high-contrast.json`. */
  name: string
  text: string
}

/** Проверяет файлы тем: JSON, схема темы, имя файла = `<id>.json`, id не повторяются (и не совпадают с `reservedIds`). */
export function loadDesignThemes(files: ThemeFile[], reservedIds: string[] = []): Theme[] {
  const seen = new Set(reservedIds)
  return [...files]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ name, text }) => {
      const where = `${DESIGN_THEMES_DIR}/${name}`
      let data: unknown
      try {
        data = JSON.parse(text)
      } catch (error) {
        throw new Error(`${where}: не JSON — ${(error as Error).message}`, { cause: error })
      }
      let theme: Theme
      try {
        theme = parseTheme(data)
      } catch (error) {
        throw new Error(`${where}: ${(error as Error).message}`, { cause: error })
      }
      if (name !== `${theme.id}.json`) throw new Error(`${where}: файл темы должен называться по её id — «${theme.id}.json»`)
      if (seen.has(theme.id)) throw new Error(`${where}: тема с id «${theme.id}» уже есть`)
      seen.add(theme.id)
      return theme
    })
}
