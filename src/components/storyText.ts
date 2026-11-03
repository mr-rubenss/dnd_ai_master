// Тексты об историях для игрока.
import type { StoryMeta } from '../types/story'

/** Отряд одной строкой: «Ратибор · Воин 1 ур.»; для нескольких героев — через запятую. */
export function partyLine(story: StoryMeta): string {
  return story.party.map((m) => `${m.name} · ${m.className} ${m.level} ур.`).join(', ')
}
