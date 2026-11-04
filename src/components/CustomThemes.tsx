import { useId, useRef, useState, type FormEvent } from 'react'
import { toHex6 } from '../theme/appearance'
import { appearanceStore } from '../theme/appearanceStore'
import { EDITABLE_COLORS, MAX_THEME_NAME_LENGTH, readabilityWarnings } from '../theme/customThemes'
import type { Theme } from '../theme/types'
import { ThemePreview } from './ThemePreview'

/** Скачать текст файлом. */
function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/** Предупреждение, если текст темы плохо читается (контраст ниже WCAG AA). */
function ContrastWarning({ theme }: { theme: Theme }) {
  const warnings = readabilityWarnings(theme)
  if (warnings.length === 0) return null
  return (
    <div className="contrast-warning" role="status" data-testid="contrast-warning">
      <strong>Текст может плохо читаться</strong> (контраст ниже WCAG AA):
      <ul>
        {warnings.map((w) => (
          <li key={w.text}>
            {w.text}: {w.ratio.toFixed(2)}:1, нужно не меньше {w.required}:1
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Сохранить текущее оформление как свою тему, импорт и экспорт темы, предупреждения о читаемости. */
export function ThemeLibraryActions({ theme }: { theme: Theme }) {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const nameId = useId()

  const save = (event: FormEvent) => {
    event.preventDefault()
    const reason = appearanceStore.saveCustom(name)
    setError(reason)
    if (!reason) {
      setNote(`Тема «${name.trim()}» сохранена и выбрана.`)
      setNaming(false)
      setName('')
    }
  }

  const importFile = async (file: File | undefined) => {
    if (!file) return
    const reason = await appearanceStore.importTheme(await file.text())
    setError(reason)
    setNote(reason ? null : `Тема из файла «${file.name}» добавлена и выбрана.`)
    if (fileRef.current) fileRef.current.value = ''
  }

  const exportCurrent = () => {
    const file = appearanceStore.exportTheme(theme.id)
    if (file) download(file.filename, file.text)
  }

  return (
    <div className="theme-library">
      {naming ? (
        <form className="theme-name-form" onSubmit={save}>
          <label className="appearance-label" htmlFor={nameId}>
            Название своей темы
          </label>
          <input
            id={nameId}
            className="text-input"
            value={name}
            maxLength={MAX_THEME_NAME_LENGTH}
            onChange={(e) => setName(e.target.value)}
            placeholder="Например, «Ночной лес»"
            autoFocus
            data-testid="custom-theme-name"
          />
          <div className="theme-library-row">
            <button type="submit" className="primary-button" data-testid="custom-theme-save">
              Сохранить
            </button>
            <button type="button" className="secondary-button" onClick={() => (setNaming(false), setError(null))}>
              Отмена
            </button>
          </div>
        </form>
      ) : (
        <div className="theme-library-row">
          <button type="button" className="secondary-button" onClick={() => (setNaming(true), setNote(null))} data-testid="custom-theme-new">
            Сохранить как свою тему
          </button>
          <button type="button" className="secondary-button" onClick={exportCurrent} data-testid="theme-export">
            Экспорт в файл
          </button>
          <button type="button" className="secondary-button" onClick={() => fileRef.current?.click()} data-testid="theme-import">
            Импорт из файла
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => void importFile(e.target.files?.[0])}
            data-testid="theme-import-file"
          />
        </div>
      )}
      <p className="appearance-hint">
        Сохраняет тему, акцент, шрифт ведущего и плотность. Файлом темы можно поделиться с друзьями — его откроет «Импорт».
      </p>
      {error && (
        <p className="equip-error" role="alert" data-testid="theme-error">
          {error}
        </p>
      )}
      {note && (
        <p className="appearance-note" role="status">
          {note}
        </p>
      )}
      {!appearanceStore.isCustom(theme.id) && <ContrastWarning theme={theme} />}
    </div>
  )
}

/** Своя тема: название, удаление и редактор основных цветов с живым предпросмотром (тема применена к странице). */
export function CustomThemeEditor({ theme }: { theme: Theme }) {
  const [name, setName] = useState(theme.name)
  const [error, setError] = useState<string | null>(null)
  const titleId = useId()

  const rename = (event: FormEvent) => {
    event.preventDefault()
    setError(appearanceStore.renameCustom(theme.id, name))
  }

  const remove = () => {
    if (!window.confirm(`Удалить свою тему «${theme.name}»? Это нельзя отменить.`)) return
    setError(appearanceStore.deleteCustom(theme.id))
  }

  const groups = [...new Set(EDITABLE_COLORS.map((c) => c.group))]

  return (
    <section className="appearance-section custom-theme" aria-labelledby={titleId} data-testid="custom-theme-editor">
      <h3 id={titleId}>Своя тема</h3>
      <form className="theme-library-row" onSubmit={rename}>
        <input
          className="text-input custom-theme-rename"
          aria-label="Название темы"
          value={name}
          maxLength={MAX_THEME_NAME_LENGTH}
          onChange={(e) => setName(e.target.value)}
          data-testid="custom-theme-rename"
        />
        <button type="submit" className="secondary-button" disabled={name.trim() === theme.name} data-testid="custom-theme-rename-save">
          Переименовать
        </button>
        <button type="button" className="secondary-button item-action--danger" onClick={remove} data-testid="custom-theme-delete">
          Удалить
        </button>
      </form>
      {error && (
        <p className="equip-error" role="alert">
          {error}
        </p>
      )}

      <div className="custom-theme-preview">
        <ThemePreview theme={theme} />
        <p className="appearance-hint">Цвета меняются сразу — на всей странице и в превью.</p>
      </div>

      {groups.map((group) => (
        <fieldset key={group} className="color-editor">
          <legend>{group}</legend>
          {EDITABLE_COLORS.filter((c) => c.group === group).map(({ ref, label }) => {
            const value = (theme[ref[0]] as Record<string, string>)[ref[1]]
            const id = `${titleId}-${ref.join('-')}`
            return (
              <label key={id} className="color-field" htmlFor={id}>
                <input
                  id={id}
                  type="color"
                  value={toHex6(value)}
                  onChange={(e) => setError(appearanceStore.setCustomColor(theme.id, ref, e.target.value))}
                  data-testid={`color-${ref.join('.')}`}
                />
                <span>{label}</span>
              </label>
            )
          })}
        </fieldset>
      ))}
      <ContrastWarning theme={theme} />
    </section>
  )
}
