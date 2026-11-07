import { useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'

/** Что отправляет игрок: действие героя (ход) или вопрос мастеру вне игры (не ход — игра не меняется). */
export type InputMode = 'action' | 'question'

const MODES: { id: InputMode; label: string; placeholder: string }[] = [
  { id: 'action', label: 'Действие героя', placeholder: 'Что вы делаете?' },
  { id: 'question', label: 'Вопрос мастеру', placeholder: 'Вопрос вне игры: правила, что было раньше, что знает герой…' },
]

interface Props {
  onSend: (text: string, mode: InputMode) => void
  disabled?: boolean
  /** Элемент слева от поля ввода (кнопка игрового стола). */
  leading?: ReactNode
  /** Подсказки действий от ведущего: нажатие вставляет текст в поле (не отправляет). */
  suggestions?: string[]
  /** Справа над полем (кнопка «Что-то не так»). */
  aside?: ReactNode
}

/** Поле ответа игрока. Enter — отправить, Shift+Enter — новая строка. */
export function PlayerInput({ onSend, disabled, leading, suggestions = [], aside }: Props) {
  const [text, setText] = useState('')
  const [mode, setMode] = useState<InputMode>('action')
  const current = MODES.find((m) => m.id === mode)!
  const fieldRef = useRef<HTMLTextAreaElement>(null)

  const pickSuggestion = (suggestion: string) => {
    setText(suggestion)
    const field = fieldRef.current
    if (!field) return
    field.focus()
    // Курсор — в конец, чтобы подсказку было удобно дописать.
    requestAnimationFrame(() => field.setSelectionRange(suggestion.length, suggestion.length))
  }

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    onSend(trimmed, mode)
    setText('')
    // Вопрос вне игры — разовый: дальше снова действие героя.
    setMode('action')
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    submit()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form className={`player-input${mode === 'question' ? ' is-question' : ''}`} onSubmit={handleSubmit}>
      <div className="input-toolbar">
      <div className="segmented input-mode" role="radiogroup" aria-label="Что отправить" data-testid="input-mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={mode === m.id}
            className={mode === m.id ? 'is-active' : undefined}
            onClick={() => setMode(m.id)}
            data-mode={m.id}
          >
            {m.label}
          </button>
        ))}
      </div>
      {aside}
      </div>
      {leading}
      <textarea
        ref={fieldRef}
        value={text}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={current.placeholder}
        aria-label={mode === 'question' ? 'Вопрос мастеру' : 'Ваш ответ'}
        rows={2}
      />
      <button type="submit" disabled={disabled || !text.trim()}>
        Отправить
      </button>
      {suggestions.length > 0 && !disabled && mode === 'action' && (
        <div className="player-suggestions" role="group" aria-label="Подсказки ведущего" data-testid="suggestions">
          {suggestions.map((suggestion) => (
            <button key={suggestion} type="button" className="suggestion-chip" onClick={() => pickSuggestion(suggestion)}>
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </form>
  )
}
