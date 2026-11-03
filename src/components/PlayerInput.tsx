import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'

interface Props {
  onSend: (text: string) => void
  disabled?: boolean
  /** Элемент слева от поля ввода (кнопка игрового стола). */
  leading?: ReactNode
}

/** Поле ответа игрока. Enter — отправить, Shift+Enter — новая строка. */
export function PlayerInput({ onSend, disabled, leading }: Props) {
  const [text, setText] = useState('')

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
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Что вы делаете?"
        aria-label="Ваш ответ"
        rows={2}
      />
      <button type="submit" disabled={disabled || !text.trim()}>
        Отправить
      </button>
    </form>
  )
}
