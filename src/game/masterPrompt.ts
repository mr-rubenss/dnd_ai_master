// Запрос к ИИ-ведущему по истории. Системный промт — src/ai/dm-prompt.md (роль, стиль, честность), к нему — эта
// история, длина ответа и актуальное состояние игры (masterState.ts), собранное заново для каждого запроса.
// Чистые функции: только общий интерфейс src/ai/ (сообщения), никакого знания о поставщике модели.
import dmPrompt from '../ai/dm-prompt.md?raw'
import { VERBOSITY, type Verbosity } from '../ai/settings'
import type { AiMessage } from '../ai/types'
import type { StoryState } from '../types/story'
import { gameStateText, type MasterStateContext } from './masterState'
import { TONE_LABELS } from './storyActions'

/** Сколько последних сообщений ленты отдаём модели. */
export const HISTORY_LIMIT = 40

/** Системный промт ведущего (текст из dm-prompt.md). */
export const DM_PROMPT = dmPrompt.trim()

/** Системный промт: правила ведущего, эта история, длина ответа, состояние игры. */
export function masterSystemPrompt(story: StoryState, verbosity: Verbosity, ctx: MasterStateContext): string {
  return [
    DM_PROMPT,
    `## Эта история\n«${story.title}». Тон: ${TONE_LABELS[story.tone]} — держи его в описаниях и в поведении НПС.`,
    `## Длина ответа\n${VERBOSITY[verbosity].instruction}`,
    gameStateText(story, ctx),
  ].join('\n\n')
}

/** Сообщения для модели: системный промт и последние реплики (игрок — user, ведущий — assistant, броски — заметки). */
export function masterMessages(story: StoryState, verbosity: Verbosity, ctx: MasterStateContext): AiMessage[] {
  const names = new Map(story.party.map((m) => [m.heroId, m.character.name]))
  const multi = story.party.length > 1
  const history: AiMessage[] = story.messages.slice(-HISTORY_LIMIT).map((m) => {
    if (m.author === 'master') return { role: 'assistant', content: m.text }
    if (m.author === 'player') return { role: 'user', content: multi && m.heroId ? `${names.get(m.heroId) ?? 'Игрок'}: ${m.text}` : m.text }
    return { role: 'user', content: `[Код игры] ${m.text}` }
  })
  return [{ role: 'system', content: masterSystemPrompt(story, verbosity, ctx) }, ...history]
}
