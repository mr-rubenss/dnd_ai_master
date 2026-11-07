// «Что-то не так»: кнопка, окно тестового отчёта (описание игрока, «Скопировать», «Скачать файл») и предложение
// составить отчёт после сбоя. Отчёт собирает src/game/testReport.ts из журнала действий, записей ходов этой вкладки
// (src/game/turnTrace.ts), ошибок консоли и настроек ведущего — без ключа и адреса API.
import { useEffect, useId, useRef, useState } from 'react'
import { byteSize, reportFileName } from '../game/testReport'
import { collectReport } from './reportCollect'
import { reportStore, useReportUi } from './reportStore'

/** Кнопка «Что-то не так». */
export function ReportButton({ className = 'report-button', hint, testId = 'report-button' }: { className?: string; hint?: string; testId?: string }) {
  return (
    <button type="button" className={className} onClick={() => reportStore.open(hint)} data-testid={testId}>
      Что-то не так
    </button>
  )
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Нет доступа к буферу — запасной способ через выделение текста.
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Окно отчёта: «Что пошло не так?», «Скопировать», «Скачать файл». */
export function ReportDialog({ storyId }: { storyId: string | null }) {
  const ui = useReportUi()
  const [description, setDescription] = useState(ui.hint)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const titleId = useId()
  const fieldRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fieldRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') reportStore.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const run = async (action: 'copy' | 'download') => {
    setBusy(true)
    setStatus(null)
    try {
      const text = await collectReport(description, storyId)
      const size = `${Math.ceil(byteSize(text) / 1024)} КБ`
      if (action === 'download') {
        download(text, reportFileName(Date.now()))
        setStatus(`Файл отчёта сохранён (${size}).`)
      } else setStatus((await copyText(text)) ? `Отчёт скопирован (${size}) — вставьте его в сообщение разработчику.` : 'Не удалось скопировать — скачайте файл.')
    } catch (error) {
      setStatus(`Не удалось собрать отчёт: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hero-dialog-backdrop">
      <section className="panel hero-dialog report-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="report-dialog">
        <header className="hero-dialog-header">
          <span className="hero-portrait" aria-hidden="true">
            🐞
          </span>
          <div>
            <h3 id={titleId}>Тестовый отчёт</h3>
            <p className="hero-meta">
              В отчёт войдут последние ходы (запросы ведущему и ответы модели, инструменты, броски), журнал действий, ошибки и
              настройки ведущего. Ключ API и адрес API в отчёт не попадают.
            </p>
          </div>
        </header>
        <div className="report-body">
          <label className="new-story-label" htmlFor={`${titleId}-text`}>
            Что пошло не так?
          </label>
          <textarea
            ref={fieldRef}
            id={`${titleId}-text`}
            className="text-input report-text"
            rows={5}
            maxLength={4000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Что вы сделали, что ожидали и что получилось вместо этого."
            data-testid="report-description"
          />
          {status && (
            <p className="hint" role="status" data-testid="report-status">
              {status}
            </p>
          )}
        </div>
        <footer className="new-story-footer report-footer">
          <button type="button" className="secondary-button" onClick={reportStore.close}>
            Закрыть
          </button>
          <button type="button" className="secondary-button" onClick={() => void run('copy')} disabled={busy} data-testid="report-copy">
            Скопировать
          </button>
          <button type="button" className="primary-button" onClick={() => void run('download')} disabled={busy} data-testid="report-download">
            Скачать файл
          </button>
        </footer>
      </section>
    </div>
  )
}

/** После сбоя игра сама предлагает составить отчёт. */
export function ReportOffer() {
  const ui = useReportUi()
  if (!ui.offer || ui.open) return null
  return (
    <div className="report-offer" role="alert" data-testid="report-offer">
      <p>Похоже, что-то сломалось: {ui.offer}</p>
      <button type="button" className="item-action is-primary" onClick={() => reportStore.open(`Сбой: ${ui.offer}`)}>
        Составить отчёт
      </button>
      <button type="button" className="item-action" onClick={reportStore.dismiss}>
        Не нужно
      </button>
    </div>
  )
}
