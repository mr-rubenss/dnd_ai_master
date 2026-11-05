import { useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'

interface Props {
  onSend: (text: string) => void
  disabled?: boolean
  /** Элемент слева от поля ввода (кнопка игрового стола). */
  leading?: ReactNode
  /** Подсказки действий от ведущего: нажатие вставляет текст в поле (не отправляет). */
  suggestions?: string[]
}

/** Поле ответа игрока. Enter — отправить, Shift+Enter — новая строка. */
export function PlayerInput({ onSend, disabled, leading, suggestions = [] }: Props) {
  const [text, setText] = useState('')
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
    onSend(trimmed)
    setText('')
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
    <form className="player-input" onSubmit={handleSubmit}>
      {leading}
      <textarea
        ref={fieldRef}
        value={text}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Что вы делаете?"
        aria-label="Ваш ответ"
        rows={2}
      />
      <button type="submit" disabled={disabled || !text.trim()}>
        Отправить
      </button>
      {suggestions.length > 0 && !disabled && (
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
