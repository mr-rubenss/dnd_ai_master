// Ход ведущего: собрать запрос по истории, получить ответ через общий интерфейс src/ai/ (потоком), вернуть текст.
// Записать его в историю (действие masterNarrated) — дело вызывающего кода.
import { AiError } from '../ai/errors'
import { VERBOSITY, type Verbosity } from '../ai/settings'
import type { AiMaster, AiRequest } from '../ai/types'
import type { StoryState } from '../types/story'
import { masterMessages } from './masterPrompt'

export interface MasterTurnOptions {
  verbosity: Verbosity
  onText?: AiRequest['onText']
  onRetry?: AiRequest['onRetry']
  signal?: AbortSignal
}

export async function runMasterTurn(master: AiMaster, story: StoryState, options: MasterTurnOptions): Promise<{ text: string; truncated: boolean }> {
  const response = await master.complete({
    messages: masterMessages(story, options.verbosity),
    maxTokens: VERBOSITY[options.verbosity].maxTokens,
    temperature: 0.9,
    onText: options.onText,
    onRetry: options.onRetry,
    signal: options.signal,
  })
  const text = response.text.trim()
  if (!text) throw new AiError('bad-response', { message: 'Ведущий прислал пустой ответ. Попробуйте ещё раз.' })
  return { text, truncated: response.finishReason === 'length' }
}
