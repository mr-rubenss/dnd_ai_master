// Запуск запроса к ИИ вне ленты с этапами, отменой и ошибками (в том числе тайм-аутом) — для AiProgress/AiTaskError.
import { useCallback, useEffect, useRef, useState } from 'react'
import { AiError } from '../ai/errors'

export interface AiTaskState {
  status: 'idle' | 'running' | 'error'
  /** Что происходит сейчас: «Отправляю историю…». */
  stage: string
  startedAt: number
  /** Сколько символов ответа уже пришло. */
  received: number
  error: string | null
  /** Ошибка — это тайм-аут (для подсказки, что делать). */
  timedOut: boolean
}

export interface AiTaskControls {
  signal: AbortSignal
  setStage: (stage: string) => void
  setReceived: (chars: number) => void
}

const IDLE: AiTaskState = { status: 'idle', stage: '', startedAt: 0, received: 0, error: null, timedOut: false }

/** Чем кончился запрос: ответ, отмена игроком (или уход с экрана) или ошибка (текст — в state.error). */
export type AiTaskResult<T> = { status: 'done'; value: T } | { status: 'cancelled' } | { status: 'error'; timedOut: boolean }

/**
 * Запуск запроса к ИИ с отменой. run возвращает итог: ответ, отмену или ошибку (её текст — в state.error).
 * Уход с экрана отменяет запрос.
 */
export function useAiTask() {
  const [state, setState] = useState<AiTaskState>(IDLE)
  const controllerRef = useRef<AbortController | null>(null)
  useEffect(() => () => controllerRef.current?.abort(), [])

  const run = useCallback(async <T,>(firstStage: string, task: (controls: AiTaskControls) => Promise<T>): Promise<AiTaskResult<T>> => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setState({ ...IDLE, status: 'running', stage: firstStage, startedAt: Date.now() })
    const live = () => controllerRef.current === controller
    try {
      const result = await task({
        signal: controller.signal,
        setStage: (stage) => live() && setState((s) => ({ ...s, stage })),
        setReceived: (received) => live() && setState((s) => ({ ...s, received })),
      })
      if (live()) setState(IDLE)
      return controller.signal.aborted ? { status: 'cancelled' } : { status: 'done', value: result }
    } catch (error) {
      if (!live()) return { status: 'cancelled' }
      if (controller.signal.aborted || (error instanceof AiError && error.kind === 'aborted')) {
        setState(IDLE)
        return { status: 'cancelled' }
      }
      const timedOut = error instanceof AiError && error.kind === 'timeout'
      setState({ ...IDLE, status: 'error', error: error instanceof Error ? error.message : 'Не удалось получить ответ.', timedOut })
      return { status: 'error', timedOut }
    } finally {
      if (live()) controllerRef.current = null
    }
  }, [])

  const cancel = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setState(IDLE)
  }, [])
  const reset = useCallback(() => setState(IDLE), [])
  return { state, run, cancel, reset }
}

