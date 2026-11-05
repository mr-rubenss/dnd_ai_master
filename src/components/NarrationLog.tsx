import { useEffect, useRef } from 'react'
import type { ChatMessage } from '../types/game'
import { rewritableMessageId } from '../game/masterSuggestions'
import { CheckCardView } from './CheckCardView'

const AUTHOR_LABELS: Record<ChatMessage['author'], string> = {
  master: 'Ведущий',
  player: 'Вы',
  system: 'Бросок',
}

interface Props {
  messages: ChatMessage[]
  /** Ответ ведущего, который ещё приходит потоком ('' — ведущий думает); null — нет. */
  pending?: string | null
  /** Ответ, который сейчас переписывается: вместо него показывается поток нового текста. */
  replacingId?: string | null
  /** «Переписать ответ» у последнего ответа ведущего; без обработчика кнопки нет. */
  onRewrite?: (messageId: string) => void
  /** Кнопка «Переписать ответ» недоступна (ведущий отвечает). */
  rewriteDisabled?: boolean
}

/** «Мастер думает…» с бегущими точками (анимация отключается настройкой «Анимации»). */
export function MasterThinking() {
  return (
    <span className="master-thinking" data-testid="master-thinking">
      Мастер думает
      <span className="thinking-dots" aria-hidden="true">
        <span>.</span>
        <span>.</span>
        <span>.</span>
      </span>
    </span>
  )
}

/** Лента сообщений ведущего и игрока. Новые сообщения появляются снизу. */
export function NarrationLog({ messages, pending = null, replacingId = null, onRewrite, rewriteDisabled }: Props) {
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

  const rewritableId = onRewrite ? rewritableMessageId(messages) : null

  return (
    <section ref={logRef} className="narration-log" aria-label="Повествование" aria-live="polite">
      {messages.map((message) =>
        message.id === replacingId && pending !== null ? null : message.check ? (
          <CheckCardView key={message.id} card={message.check} />
        ) : (
          <article key={message.id} className={`message message--${message.author}`}>
            <span className="message-author">{AUTHOR_LABELS[message.author]}</span>
            <p className="message-text">{message.text}</p>
            {message.id === rewritableId && pending === null && (
              <button
                type="button"
                className="message-rewrite"
                data-testid="master-rewrite"
                onClick={() => onRewrite?.(message.id)}
                disabled={rewriteDisabled}
              >
                ↻ Переписать ответ
              </button>
            )}
          </article>
        ),
      )}
      {pending !== null && (
        <article
          className={`message message--master is-streaming${pending ? '' : ' is-thinking'}`}
          data-testid="master-streaming"
          aria-busy="true"
        >
          <span className="message-author">{AUTHOR_LABELS.master}</span>
          <p className="message-text">{pending || <MasterThinking />}</p>
        </article>
      )}
    </section>
  )
}
