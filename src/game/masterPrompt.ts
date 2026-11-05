// Запрос к ИИ-ведущему по состоянию истории. Чистые функции: только общий интерфейс src/ai/ (сообщения),
// никакого знания о поставщике модели.
import type { AiMessage } from '../ai/types'
import { VERBOSITY, type Verbosity } from '../ai/settings'
import type { StoryState } from '../types/story'
import { currentLocation, TONE_LABELS } from './storyActions'

/** Сколько последних сообщений ленты отдаём модели. */
export const HISTORY_LIMIT = 40

const ATTITUDE: Record<string, string> = { friendly: 'дружелюбен', neutral: 'нейтрален', hostile: 'враждебен' }

/** Системный промт: роль, правила (код — правила и кубики), история, отряд, место, длина ответа. */
export function masterSystemPrompt(story: StoryState, verbosity: Verbosity): string {
  const location = currentLocation(story)
  const party = story.party
    .map((m) => {
      const c = m.character
      return `- ${c.name}: ${c.species}, ${c.className} ${c.level} ур., хиты ${c.hp}/${c.maxHp}${m.fallen ? ', погиб' : ''}`
    })
    .join('\n')
  const npcs = location.npcs.map(
    (n) => `- ${n.name}${n.attitude ? ` (${ATTITUDE[n.attitude] ?? n.attitude})` : ''}${n.description ? `: ${n.description}` : ''}`,
  )
  const facts = story.world.facts.slice(-10).map((f) => `- ${f.text}`)
  const quests = story.world.quests.filter((q) => q.status === 'active').map((q) => `- ${q.title}`)
  return [
    'Ты — ведущий (Мастер) текстовой ролевой игры по правилам D&D 2024 (SRD 5.2). Веди игру только на русском языке.',
    'Правила, броски кубиков и состояние игры (хиты, предметы, положение на карте) ведёт код игры, а не ты: не придумывай результаты бросков и не меняй состояние сам — описывай сцену, говори за НПС и предлагай, что можно сделать.',
    'Не решай за героя игрока — описывай мир и реакцию на его действия.',
    `История: «${story.title}». Тон: ${TONE_LABELS[story.tone]}.`,
    `Место: ${location.name}. ${location.description}`,
    npcs.length ? `Здесь находятся:\n${npcs.join('\n')}` : '',
    `Отряд:\n${party}`,
    quests.length ? `Текущие задания:\n${quests.join('\n')}` : '',
    facts.length ? `Известные факты:\n${facts.join('\n')}` : '',
    VERBOSITY[verbosity].instruction,
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Сообщения для модели: системный промт и последние реплики (игрок — user, ведущий — assistant, броски — заметки). */
export function masterMessages(story: StoryState, verbosity: Verbosity): AiMessage[] {
  const names = new Map(story.party.map((m) => [m.heroId, m.character.name]))
  const multi = story.party.length > 1
  const history: AiMessage[] = story.messages.slice(-HISTORY_LIMIT).map((m) => {
    if (m.author === 'master') return { role: 'assistant', content: m.text }
    if (m.author === 'player') return { role: 'user', content: multi && m.heroId ? `${names.get(m.heroId) ?? 'Игрок'}: ${m.text}` : m.text }
    return { role: 'user', content: `[Код игры] ${m.text}` }
  })
  return [{ role: 'system', content: masterSystemPrompt(story, verbosity) }, ...history]
}
