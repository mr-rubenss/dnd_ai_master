// Итог завершённой истории и «Летопись» героя. Чистые функции.
//
// Пока ИИ не подключён, черновик краткого содержания собирается из выполненных (и проваленных) квестов
// и журнала фактов. Игрок может его отредактировать; на этапе ИИ черновик напишет ведущий.

import type { CharacterSheet, ChronicleEntry } from '../types/character'
import type { ItemCatalog } from '../types/items'
import type { PartyMember, StoryEpilogue, StoryState } from '../types/story'
import { TONE_LABELS } from './storyActions'

export const MIN_SUMMARY_SENTENCES = 3
export const MAX_SUMMARY_SENTENCES = 6

/** Предложение с точкой в конце. */
const sentence = (text: string) => {
  const t = text.trim()
  return /[.!?…][»"]?$/.test(t) ? t : `${t}.`
}

const quoted = (titles: string[]) => titles.map((t) => `«${t}»`).join(', ')

/** Уровень героя в начале истории (у старых историй поля нет — считаем, что уровень не менялся). */
export const startLevelOf = (member: PartyMember) => member.startLevel ?? member.character.level

/** Ключевые находки героя: предметы, полученные в истории, с количеством. */
export function findsOf(state: StoryState, heroId: string, catalog: ItemCatalog): string[] {
  const total = new Map<string, number>()
  for (const f of state.finds ?? []) if (f.heroId === heroId) total.set(f.itemId, (total.get(f.itemId) ?? 0) + f.quantity)
  return [...total].map(([itemId, quantity]) => `${catalog[itemId]?.name ?? itemId}${quantity > 1 ? ` ×${quantity}` : ''}`)
}

/** Черновик краткого содержания: 3–6 предложений из квестов и фактов. */
export function draftSummary(state: StoryState): string {
  const names = state.party.map((m) => m.character.name).join(', ')
  const start = state.world.locations[state.world.currentLocationId]?.name
  const opening = sentence(`${TONE_LABELS[state.tone]}: история «${state.title}» разворачивалась в месте «${start}», в отряде — ${names}`)
  const done = state.world.quests.filter((q) => q.status === 'completed').map((q) => q.title)
  const failed = state.world.quests.filter((q) => q.status === 'failed').map((q) => q.title)
  const middle: string[] = []
  if (done.length > 0) middle.push(sentence(`${done.length === 1 ? 'Выполнено задание' : 'Выполнены задания'} ${quoted(done)}`))
  if (failed.length > 0) middle.push(sentence(`${failed.length === 1 ? 'Провалено задание' : 'Провалены задания'} ${quoted(failed)}`))
  // Факты — по одному предложению, сколько поместится в 6 предложений (последние — самые свежие).
  const room = MAX_SUMMARY_SENTENCES - 2 - middle.length
  const facts = state.world.facts.slice(-room).map((f) => sentence(f.text))
  if (middle.length === 0 && facts.length === 0) middle.push('Заметных событий в журнале не записано.')
  const turns = state.messages.filter((m) => m.author === 'player').length
  const closing = `Сделано ходов: ${turns}.`
  return [opening, ...middle, ...facts, closing].join(' ')
}

/** Черновик «чем всё кончилось»: кто жив, кто погиб. */
export function draftOutcome(state: StoryState): string {
  const fallen = state.party.filter((m) => m.fallen).map((m) => m.character.name)
  const alive = state.party.filter((m) => !m.fallen).map((m) => m.character.name)
  const onward = alive.length === 1 ? 'снова в пути и может начать новую историю' : 'снова в пути и могут начать новые истории'
  if (fallen.length === 0) return `История завершена. ${alive.join(', ')} — ${onward}.`
  if (alive.length === 0) return `История завершена гибелью: ${fallen.join(', ')}.`
  return `История завершена. ${fallen.length === 1 ? 'Погиб герой' : 'Погибли герои'}: ${fallen.join(', ')}. ${alive.join(', ')} — ${onward}.`
}

export function draftEpilogue(state: StoryState, now: number): StoryEpilogue {
  return { summary: draftSummary(state), outcome: draftOutcome(state), endedAt: now }
}

/** Запись «Летописи» героя об этой истории. */
export function chronicleEntry(state: StoryState, member: PartyMember, epilogue: StoryEpilogue, catalog: ItemCatalog): ChronicleEntry {
  return {
    storyId: state.id,
    storyTitle: state.title,
    endedAt: epilogue.endedAt,
    summary: epilogue.summary.trim(),
    outcome: epilogue.outcome.trim(),
    startLevel: startLevelOf(member),
    endLevel: member.character.level,
    finds: findsOf(state, member.heroId, catalog),
    fate: member.fallen ? 'fallen' : 'survived',
  }
}

/** Дописать запись в «Летопись» героя; запись той же истории заменяется (правка итога). */
export function withChronicle(sheet: CharacterSheet, entry: ChronicleEntry): CharacterSheet {
  const chronicle = [...(sheet.character.chronicle ?? []).filter((e) => e.storyId !== entry.storyId), entry].sort((a, b) => a.endedAt - b.endedAt)
  return { ...sheet, character: { ...sheet.character, chronicle } }
}
