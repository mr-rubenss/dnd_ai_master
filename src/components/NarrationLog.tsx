import { useEffect, useRef } from 'react'
import type { ChatMessage } from '../types/game'

const AUTHOR_LABELS: Record<ChatMessage['author'], string> = {
  master: 'Ведущий',
  player: 'Вы',
  system: 'Бросок',
}

interface Props {
  messages: ChatMessage[]
  /** Ответ ведущего, который ещё приходит потоком ('' — ведущий думает); null — нет. */
  pending?: string | null
}

/** Лента сообщений ведущего и игрока. Новые сообщения появляются снизу. */
export function NarrationLog({ messages, pending = null }: Props) {
  const logRef = useRef<HTMLElement>(null)
  const isFirstRender = useRef(true)

  useEffect(() => {
    // Прокручиваем только ленту, а не всю страницу (важно на телефоне).
    const log = logRef.current
    if (!log) return
    // При первой отрисовке — сразу вниз, дальше — плавно.
    log.scrollTo({ top: log.scrollHeight, behavior: isFirstRender.current ? 'instant' : 'smooth' })
    isFirstRender.current = false
  }, [messages, pending])

  return (
    <section ref={logRef} className="narration-log" aria-label="Повествование" aria-live="polite">
      {messages.map((message) => (
        <article key={message.id} className={`message message--${message.author}`}>
          <span className="message-author">{AUTHOR_LABELS[message.author]}</span>
          <p className="message-text">{message.text}</p>
        </article>
      ))}
      {pending !== null && (
        <article className="message message--master is-streaming" data-testid="master-streaming" aria-busy="true">
          <span className="message-author">{AUTHOR_LABELS.master}</span>
          <p className="message-text">{pending || <span className="master-thinking">Ведущий думает…</span>}</p>
        </article>
      )}
    </section>
  )
}
