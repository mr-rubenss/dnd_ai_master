// Краткое состояние истории для тестового отчёта: вместо полного раздела «Состояние игры» из запроса ведущему —
// несколько строк (время, локация, герои: хиты, КД, кошелёк, состояния, место на карте; отдых, вне игры, память).
import { CONDITION_DEFINITIONS } from '../engine/conditions'
import { timeText } from '../engine/time'
import type { ItemCatalog } from '../types/items'
import type { StoryState } from '../types/story'
import { armorClass } from './character'
import { formatCoins } from './coins'
import { storyTime } from './storyActions'

/** Где и когда: «День 1, 19:00 (вечер) · «Пьяный грифон»». */
export function whereAndWhen(story: StoryState): string {
  const location = story.world.locations[story.world.currentLocationId]
  return `${timeText(storyTime(story))} · «${location?.name ?? story.world.currentLocationId}»`
}

export function briefState(story: StoryState, catalog: ItemCatalog): string {
  const location = story.world.locations[story.world.currentLocationId]
  const lines = [`Время и место: ${whereAndWhen(story)}`]
  for (const m of story.party) {
    const c = m.character
    let ac = '?'
    try {
      ac = String(armorClass(c, m.inventory, catalog))
    } catch {
      // Старый лист без нужных полей — КД в кратком состоянии не обязателен.
    }
    const conditions = c.conditions.map((x) => `${CONDITION_DEFINITIONS[x.id]?.name ?? x.id}${x.level ? ` ${x.level}` : ''}`).join(', ') || 'нет'
    const coins = m.inventory.coins ? formatCoins(m.inventory.coins) : '—'
    lines.push(
      `${c.name} (${c.className} ${c.level} ур.${m.fallen ? ', погиб' : ''}): хиты ${c.hp}/${c.maxHp}, КД ${ac}, кошелёк ${coins}, ` +
        `предметов ${m.inventory.items.length}, состояния: ${conditions}, клетка (${m.position.x}, ${m.position.y})`,
    )
  }
  if (location) lines.push(`НПС в локации: ${location.npcs.map((n) => n.name).join(', ') || 'нет'}`)
  const extra = [
    story.pendingRest ? `ждёт решения об отдыхе (${story.pendingRest.kind === 'long' ? 'долгий' : 'короткий'})` : '',
    story.outOfGame ? 'вопрос вне игры' : '',
    story.memory ? `сводка памяти покрывает ${story.memory.covered} сообщ.` : '',
    `фактов: ${story.world.facts.length}`,
    `заданий: ${story.world.quests.length}`,
  ].filter(Boolean)
  lines.push(extra.join('; '))
  return lines.join('\n')
}
