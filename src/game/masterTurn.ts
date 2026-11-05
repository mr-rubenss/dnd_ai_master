// Ход ведущего: собрать запрос по истории, получить ответ через общий интерфейс src/ai/ (потоком), вернуть текст.
// Записать его в историю (действие masterNarrated) — дело вызывающего кода.
import { AiError } from '../ai/errors'
import { VERBOSITY, type Verbosity } from '../ai/settings'
import type { AiMaster, AiRequest } from '../ai/types'
import type { StoryState } from '../types/story'
import { masterMessages } from './masterPrompt'
import type { MasterStateContext } from './masterState'

export interface MasterTurnOptions {
  verbosity: Verbosity
  /** Справочник предметов и правила — для листа персонажа и инвентаря в запросе. */
  context: MasterStateContext
  onText?: AiRequest['onText']
  onRetry?: AiRequest['onRetry']
  signal?: AbortSignal
}

export async function runMasterTurn(master: AiMaster, story: StoryState, options: MasterTurnOptions): Promise<{ text: string; truncated: boolean }> {
  const response = await master.complete({
    messages: masterMessages(story, options.verbosity, options.context),
    maxTokens: VERBOSITY[options.verbosity].maxTokens,
    temperature: 0.9,
    onText: options.onText,
    onRetry: options.onRetry,
    signal: options.signal,
  })
  const text = response.text.trim()
  if (!text && response.reasoning)
    throw new AiError('bad-response', {
      message:
        'Ведущий не успел ответить: модель «размышляла», и ответ не поместился в лимит длины. Выберите «Подробно» в «Настройки» → «Ведущий» или нерассуждающую модель.',
    })
  if (!text) throw new AiError('bad-response', { message: 'Ведущий прислал пустой ответ. Попробуйте ещё раз.' })
  return { text, truncated: response.finishReason === 'length' }
}
