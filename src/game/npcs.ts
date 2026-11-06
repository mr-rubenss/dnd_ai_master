// Живые НПС: личность (предыстория, цель, страх, манера речи, чем занят) — короткие заметки ведущего.
// Проверка полей, применение изменений и компактная выжимка для запроса ведущему (только НПС текущей локации).
// Чистые функции.
import { NPC_ATTITUDES, NPC_PERSONALITY_FIELDS, NPC_PERSONALITY_LIMITS, type Npc, type NpcPersonality } from '../types/location'
import type { NpcChanges } from '../types/story'

const ATTITUDE: Record<string, string> = { friendly: 'дружелюбное', neutral: 'нейтральное', hostile: 'враждебное' }

/** Подписи полей личности — для выжимки ведущему. */
export const NPC_FIELD_LABELS: Record<keyof NpcPersonality, string> = {
  activity: 'сейчас',
  goal: 'цель',
  fear: 'страх/слабость',
  speech: 'речь',
  backstory: 'прошлое',
}

/** Проверка полей личности (и описания/отношения): строки не длиннее предела. null — всё в порядке. */
export function npcChangesProblem(changes: NpcChanges | Npc | undefined): string | null {
  if (!changes || typeof changes !== 'object') return 'Изменения НПС — объект.'
  for (const key of NPC_PERSONALITY_FIELDS) {
    const v = changes[key]
    if (v === undefined) continue
    if (typeof v !== 'string') return `«${key}» — строка.`
    if (v.length > NPC_PERSONALITY_LIMITS[key]) return `«${key}» слишком длинное (${v.length} симв., можно до ${NPC_PERSONALITY_LIMITS[key]}) — сократи до сути.`
  }
  if (changes.description !== undefined && typeof changes.description !== 'string') return '«description» — строка.'
  if (changes.attitude !== undefined && !(NPC_ATTITUDES as readonly string[]).includes(changes.attitude)) return `«attitude» — одно из: ${NPC_ATTITUDES.join(', ')}.`
  return null
}

/** НПС после изменений: пустая строка убирает поле. */
export function applyNpcChanges(npc: Npc, changes: NpcChanges): Npc {
  const next: Npc = { ...npc }
  for (const [key, value] of Object.entries(changes) as [keyof NpcChanges, string | undefined][]) {
    if (value === undefined) continue
    if (typeof value === 'string' && value.trim() === '') delete (next as Partial<Npc>)[key]
    else (next as unknown as Record<string, unknown>)[key] = typeof value === 'string' ? value.trim() : value
  }
  return next
}

/** Есть ли у НПС заполненная личность. */
export const hasPersonality = (npc: Npc) => NPC_PERSONALITY_FIELDS.some((k) => Boolean(npc[k]?.trim()))

/**
 * Выжимка о НПС для ведущего — одна-две строки: клетка, отношение, внешность, затем личность (сейчас, цель,
 * страх, речь, прошлое). У старых НПС без личности — как раньше: только описание.
 */
export function npcDigest(npc: Npc): string {
  const head = `- ${npc.name} (${npc.x}, ${npc.y})${npc.attitude ? `, отношение: ${ATTITUDE[npc.attitude] ?? npc.attitude}` : ''}${npc.description ? `: ${npc.description}` : ''}`
  if (!hasPersonality(npc)) return head
  const order: (keyof NpcPersonality)[] = ['activity', 'goal', 'fear', 'speech', 'backstory']
  const parts = order.filter((k) => npc[k]?.trim()).map((k) => `${NPC_FIELD_LABELS[k]}: ${npc[k]!.trim()}`)
  return `${head}\n  ${parts.join(' | ')}`
}
