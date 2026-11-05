// Ход ведущего через общий интерфейс src/ai/: ответ модели → выполнение инструментов → результаты обратно модели →
// финальный текст. ИИ меняет игру только инструментами (masterTools.ts): каждый вызов проверяет движок, недопустимый —
// отклоняется, и модель получает причину. Принятые действия записываются в историю через `commit` по одному.
import { AiError } from '../ai/errors'
import { VERBOSITY, type Verbosity } from '../ai/settings'
import type { AiMaster, AiMessage, AiRequest, AiResponse, AiToolCall } from '../ai/types'
import type { ActionAuthor, StoryEvent, StoryState } from '../types/story'
import { masterMessages } from './masterPrompt'
import type { MasterStateContext } from './masterState'
import { executeTool, MASTER_TOOLS, type ToolContext, type ToolOutcome } from './masterTools'
import { MASTER } from './storyActions'

/** Сколько раундов «вызовы инструментов → результаты» за один ход; последний раунд — уже без инструментов. */
export const MAX_TOOL_ROUNDS = 4

export interface MasterToolRuntime {
  /** Текущее состояние истории (после уже записанных действий). */
  getStory: () => StoryState
  /** Записать действие в историю; причина отказа или null. */
  commit: (event: StoryEvent, author: ActionAuthor) => Promise<string | null> | string | null
  /** Справочник, генератор бросков, время, id. */
  tools: ToolContext
  /** После каждого вызова инструмента (для интерфейса). */
  onTool?: (call: AiToolCall, outcome: ToolOutcome) => void
  /** Текст ответа записан, дальше — инструменты и новый ответ модели: интерфейс сбрасывает текущий поток текста. */
  onRound?: () => void
}

export interface MasterTurnOptions {
  verbosity: Verbosity
  /** Справочник предметов и правила — для листа персонажа и инвентаря в запросе. */
  context: MasterStateContext
  /** Инструменты ведущего; без них — только текст. */
  runtime?: MasterToolRuntime
  onText?: AiRequest['onText']
  onRetry?: AiRequest['onRetry']
  signal?: AbortSignal
}

export interface MasterTurnResult {
  /** Финальный текст (записать действием masterNarrated); пустой — если весь рассказ уже записан по ходу. */
  text: string
  truncated: boolean
  /** Все вызовы инструментов за ход и их итог. */
  toolCalls: { call: AiToolCall; outcome: ToolOutcome }[]
}

function emptyAnswer(response: AiResponse): never {
  if (response.reasoning)
    throw new AiError('bad-response', {
      message:
        'Ведущий не успел ответить: модель «размышляла», и ответ не поместился в лимит длины. Выберите «Подробно» в «Настройки» → «Ведущий» или нерассуждающую модель.',
    })
  throw new AiError('bad-response', { message: 'Ведущий прислал пустой ответ. Попробуйте ещё раз.' })
}

export async function runMasterTurn(master: AiMaster, story: StoryState, options: MasterTurnOptions): Promise<MasterTurnResult> {
  const { runtime } = options
  const current = () => runtime?.getStory() ?? story
  const messages: AiMessage[] = masterMessages(current(), options.verbosity, options.context)
  const toolCalls: MasterTurnResult['toolCalls'] = []
  let narrated = false

  for (let round = 0; ; round++) {
    const toolsAllowed = !!runtime && round < MAX_TOOL_ROUNDS
    // Состояние в системном промте — свежее на каждый раунд (после уже выполненных инструментов).
    messages[0] = masterMessages(current(), options.verbosity, options.context)[0]
    const response = await master.complete({
      messages,
      ...(runtime ? { tools: MASTER_TOOLS, toolChoice: toolsAllowed ? ('auto' as const) : ('none' as const) } : {}),
      maxTokens: VERBOSITY[options.verbosity].maxTokens,
      temperature: 0.9,
      onText: options.onText,
      onRetry: options.onRetry,
      signal: options.signal,
    })
    const text = response.text.trim()
    const calls = toolsAllowed ? response.toolCalls : []

    if (calls.length === 0) {
      if (!text && !narrated) emptyAnswer(response)
      return { text, truncated: response.finishReason === 'length', toolCalls }
    }

    // Текст перед вызовами («Ты пытаешься…») — в ленту сразу, перед карточками бросков.
    if (text) {
      const reason = await runtime!.commit({ type: 'masterNarrated', messageId: runtime!.tools.newId(), text }, MASTER)
      if (!reason) narrated = true
    }
    messages.push({ role: 'assistant', content: response.text || null, toolCalls: calls })
    runtime!.onRound?.()
    for (const call of calls) {
      let outcome = executeTool(current(), call, runtime!.tools)
      for (const { event, author } of outcome.events) {
        const reason = await runtime!.commit(event, author)
        if (reason) {
          outcome = { ok: false, result: { ok: false, error: reason }, events: [] }
          break
        }
      }
      toolCalls.push({ call, outcome })
      runtime!.onTool?.(call, outcome)
      messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(outcome.result) })
    }
  }
}
