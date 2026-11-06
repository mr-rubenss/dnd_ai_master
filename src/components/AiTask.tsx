// Общий индикатор запроса к ИИ вне ленты (подбор предыстории, проверка подключения, итог истории): этап, секунды
// ожидания, анимация, сколько уже пришло, «Отменить»; при тайм-ауте или ошибке — сообщение и действия.
// Сроки — src/ai/timeouts.ts, обрыв запроса — src/ai/timed.ts.
import { useEffect, useState, type ReactNode } from 'react'
import type { AiTaskState } from './useAiTask'

/** Секунды с начала, обновляются раз в секунду. */
function useSeconds(startedAt: number, active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return active ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0
}

/** Индикатор: анимация, этап, секунды ожидания, сколько пришло, «Отменить». */
export function AiProgress({ state, onCancel, note, testId = 'ai-progress' }: { state: AiTaskState; onCancel: () => void; note?: ReactNode; testId?: string }) {
  const seconds = useSeconds(state.startedAt, state.status === 'running')
  if (state.status !== 'running') return null
  return (
    <div className="ai-progress" role="status" aria-live="polite" data-testid={testId}>
      <span className="ai-progress-spinner" aria-hidden="true" />
      <span className="ai-progress-text">
        <strong data-testid="ai-progress-stage">{state.stage}</strong>
        <span className="ai-progress-meta">
          <span data-testid="ai-progress-seconds">{seconds} с</span>
          {state.received > 0 && <span> · получено {state.received.toLocaleString('ru-RU')} симв.</span>}
        </span>
        {note && <span className="ai-progress-note">{note}</span>}
      </span>
      <button type="button" className="secondary-button" onClick={onCancel} data-testid="ai-cancel">
        Отменить
      </button>
    </div>
  )
}

/** Ошибка запроса (в том числе тайм-аут) и что можно сделать дальше. */
export function AiTaskError({ state, children, testId = 'ai-error' }: { state: AiTaskState; children?: ReactNode; testId?: string }) {
  if (state.status !== 'error') return null
  return (
    <div className="ai-task-error" role="alert" data-testid={testId} data-timeout={state.timedOut || undefined}>
      <p>{state.error}</p>
      {children && <div className="ai-task-actions">{children}</div>}
    </div>
  )
}
