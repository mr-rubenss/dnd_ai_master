import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { findsOf, startLevelOf } from '../game/epilogue'
import { MAX_EPILOGUE_LENGTH } from '../game/storyActions'
import type { ItemCatalog } from '../types/items'
import type { StoryState } from '../types/story'

interface Props {
  /** Завершённая история (с итогом). */
  story: StoryState
  catalog: ItemCatalog
  /** Сохранить правку итога; возвращает причину отказа или null. */
  onSave: (text: { summary: string; outcome: string }) => Promise<string | null>
  onClose: () => void
}

/** Окно итога завершённой истории: краткое содержание, чем всё кончилось, уровни и находки героев. */
export function EpilogueDialog({ story, catalog, onSave, onClose }: Props) {
  const epilogue = story.epilogue!
  const [summary, setSummary] = useState(epilogue.summary)
  const [outcome, setOutcome] = useState(epilogue.outcome)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const titleId = useId()
  const firstRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    firstRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (summary === epilogue.summary && outcome === epilogue.outcome) return onClose()
    setSaving(true)
    const reason = await onSave({ summary, outcome })
    setSaving(false)
    setError(reason)
    if (!reason) onClose()
  }

  return (
    <div className="hero-dialog-backdrop">
      <form className="panel hero-dialog epilogue" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={submit}>
        <header className="hero-dialog-header epilogue-header">
          <span className="hero-portrait" aria-hidden="true">
            🏆
          </span>
          <div>
            <h3 id={titleId}>Итог истории «{story.title}»</h3>
            <p className="hero-meta">История завершена и доступна только для чтения. Итог попадёт в «Летопись» героев.</p>
          </div>
        </header>

        <div className="epilogue-body">
          <label className="new-story-label" htmlFor={`${titleId}-summary`}>
            Краткое содержание
          </label>
          <textarea
            ref={firstRef}
            id={`${titleId}-summary`}
            className="text-input epilogue-text"
            rows={6}
            maxLength={MAX_EPILOGUE_LENGTH}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
          <p className="new-story-hint">Черновик собран из выполненных заданий и журнала фактов — его можно поправить.</p>

          <label className="new-story-label" htmlFor={`${titleId}-outcome`}>
            Чем всё кончилось
          </label>
          <textarea
            id={`${titleId}-outcome`}
            className="text-input epilogue-text"
            rows={2}
            maxLength={MAX_EPILOGUE_LENGTH}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
          />

          <ul className="epilogue-heroes">
            {story.party.map((member) => {
              const finds = findsOf(story, member.heroId, catalog)
              return (
                <li key={member.heroId} data-testid={`epilogue-hero-${member.heroId}`}>
                  <strong>{member.character.name}</strong>
                  {member.fallen && <span className="fate-badge fate-badge--fallen">Гибель</span>}
                  <span data-testid="epilogue-levels">
                    Уровень: {startLevelOf(member)} → {member.character.level}
                  </span>
                  <span data-testid="epilogue-finds">Ключевые находки: {finds.length > 0 ? finds.join(', ') : 'нет'}</span>
                </li>
              )
            })}
          </ul>

          {error && (
            <p className="equip-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="new-story-footer epilogue-footer">
          <button type="button" className="secondary-button" onClick={onClose}>
            Закрыть
          </button>
          <button type="submit" className="primary-button" disabled={saving}>
            Сохранить в летопись
          </button>
        </footer>
      </form>
    </div>
  )
}
