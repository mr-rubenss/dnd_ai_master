// Актуальное состояние игры для запроса ведущему: лист персонажа, инвентарь, текущая локация с объектами и НПС.
// Чистые функции; данные (справочник предметов, правила) передаются параметрами.
import type { PriceList } from './prices'
import { coinsValue, formatCoins } from './coins'
import { ABILITIES, ABILITY_ABBREVIATIONS, abilityModifier, formatModifier, proficiencyBonus } from '../engine/abilities'
import { passivePerception, savingThrowModifier, skillModifier } from '../engine/checks'
import { CONDITION_DEFINITIONS } from '../engine/conditions'
import { SKILL_DEFINITIONS, SKILLS } from '../engine/skills'
import type { ItemCatalog } from '../types/items'
import type { DoorState } from '../types/location'
import type { RulesData } from '../types/rules'
import type { PartyMember, StoryState } from '../types/story'
import { weaponAttacks } from './attacks'
import { armorClass } from './character'
import { currentLocation } from './storyActions'

export interface MasterStateContext {
  catalog: ItemCatalog
  rules: RulesData
  /** Прейскурант еды, ночлега и услуг — идёт в неизменную часть промта. */
  prices?: PriceList
}

const ATTITUDE: Record<string, string> = { friendly: 'дружелюбное', neutral: 'нейтральное', hostile: 'враждебное' }
const DOOR_STATE: Record<DoorState, string> = { open: 'открыта', closed: 'закрыта', locked: 'заперта' }
const cell = (p: { x: number; y: number }) => `(${p.x}, ${p.y})`

/** Лист персонажа и инвентарь одного героя. */
export function heroSheetText(member: PartyMember, ctx: MasterStateContext): string {
  const c = member.character
  const inv = member.inventory
  const pb = proficiencyBonus(c.level)
  const abilities = ABILITIES.map((a) => `${ABILITY_ABBREVIATIONS[a]} ${c.abilities[a]} (${formatModifier(abilityModifier(c.abilities[a]))})`).join(', ')
  const saves = ABILITIES.map((a) => `${ABILITY_ABBREVIATIONS[a]} ${formatModifier(savingThrowModifier(c, a))}${c.proficiencies.savingThrows.includes(a) ? '*' : ''}`).join(', ')
  const skills = SKILLS.filter((s) => c.proficiencies.skills[s])
    .map((s) => `${SKILL_DEFINITIONS[s].name} ${formatModifier(skillModifier(c, s))}${c.proficiencies.skills[s] === 'expertise' ? ' (компетентность)' : ''}`)
    .join(', ')
  const conditions = c.conditions.map((x) => CONDITION_DEFINITIONS[x.id].name + (x.level ? ` ${x.level}` : '')).join(', ')
  const feats = c.feats.map((f) => ctx.rules.feats[f]?.name ?? f).join(', ')
  const speed = ctx.rules.species[c.speciesId]?.speed
  const training = ctx.rules.classes[c.classId]?.martialWeapons ?? 'all'
  const attacks = weaponAttacks(c, inv.equipped, ctx.catalog, training).map(
    (a) => `${a.name}: атака ${formatModifier(a.attackBonus)}, урон ${a.damageDice}${a.damageBonus ? formatModifier(a.damageBonus) : ''}${a.notes.length ? ` (${a.notes.join('; ')})` : ''}`,
  )
  const name = (id: string | null) => (id ? (ctx.catalog[id]?.name ?? id) : 'пусто')
  const items = inv.items.map((e) => `${ctx.catalog[e.itemId]?.name ?? e.itemId}${e.quantity > 1 ? ` ×${e.quantity}` : ''}`)
  return [
    `### ${c.name}${member.fallen ? ' (погиб)' : ''}`,
    `${c.species}, ${c.className} ${c.level} ур., предыстория: ${c.background}.`,
    `Хиты ${c.hp}/${c.maxHp}, КД ${armorClass(c, inv, ctx.catalog)}${speed ? `, скорость ${speed} фт.` : ''}, бонус мастерства ${formatModifier(pb)}, пассивная Внимательность ${passivePerception(c)}.`,
    `Характеристики: ${abilities}.`,
    `Спасброски (* — владение): ${saves}.`,
    `Навыки с владением: ${skills || 'нет'}.`,
    feats ? `Черты: ${feats}.` : '',
    `Состояния: ${conditions || 'нет'}.`,
    `Экипировка: основная рука — ${name(inv.equipped.mainHand)}, вторая рука — ${name(inv.equipped.offHand)}, доспех — ${name(inv.equipped.armor)}.`,
    attacks.length ? `Атаки: ${attacks.join('; ')}.` : '',
    `Инвентарь: ${items.length ? items.join(', ') : 'пусто'}.`,
    `Кошелёк: ${formatCoins(inv.coins)} (всего ${coinsValue(inv.coins)} мм; 1 зм = 10 см = 100 мм).`,
    `Положение на карте: клетка ${cell(member.position)}.`,
    ...heroPastText(c),
  ]
    .filter(Boolean)
    .join('\n')
}

/** Сколько последних записей «Летописи» идёт в запрос. */
export const CHRONICLE_IN_PROMPT = 5

/**
 * Прошлое героя — источник зацепок для сюжета: «История героя» словами игрока и «Летопись» прошлых приключений
 * (старые враги и друзья, что кончилось и как).
 */
export function heroPastText(c: PartyMember['character']): string[] {
  const lines: string[] = []
  if (c.backstory?.trim()) lines.push(`История героя (словами игрока; источник зацепок для сюжета): ${c.backstory.trim()}`)
  const chronicle = (c.chronicle ?? []).slice(-CHRONICLE_IN_PROMPT)
  if (chronicle.length)
    lines.push(
      `Летопись (прошлые приключения героя — старые враги, друзья, долги):\n${chronicle
        .map((e) => `- «${e.storyTitle}» (${e.fate === 'fallen' ? 'погиб' : `ур. ${e.startLevel}→${e.endLevel}`}): ${e.summary} ${e.outcome}`.trim())
        .join('\n')}`,
    )
  return lines
}

/** Текущая локация: описание, комнаты, объекты, двери (с состоянием в этой истории), НПС. */
export function locationText(story: StoryState): string {
  const location = currentLocation(story)
  const doorStates = story.world.doors[location.id] ?? {}
  const rooms = location.rooms.filter((r) => r.name).map((r) => `${r.name} (клетки ${r.x}–${r.x + r.w - 1} × ${r.y}–${r.y + r.h - 1})`)
  // Объекты с описанием — по одному; одинаковые без описания (стулья) — одной строкой с количеством.
  const plain = new Map<string, number>()
  for (const o of location.objects) if (!o.description) plain.set(o.name, (plain.get(o.name) ?? 0) + 1)
  const objects = [
    ...location.objects.filter((o) => o.description).map((o) => `- ${o.name} ${cell(o)}: ${o.description}`),
    ...[...plain].map(([name, n]) => `- ${name}${n > 1 ? ` ×${n}` : ''}`),
  ]
  const doors = location.doors.map((d) => `- ${d.name} — ${DOOR_STATE[doorStates[d.id] ?? d.state]}${d.description ? `: ${d.description}` : ''}`)
  const npcs = location.npcs.map(
    (n) => `- ${n.name} ${cell(n)}${n.attitude ? `, отношение: ${ATTITUDE[n.attitude] ?? n.attitude}` : ''}${n.description ? `: ${n.description}` : ''}`,
  )
  return [
    `### ${location.name}`,
    location.description,
    `Карта ${location.width}×${location.height} клеток, клетка — ${location.cellFeet} фт.`,
    rooms.length ? `Помещения: ${rooms.join('; ')}.` : '',
    objects.length ? `Объекты:\n${objects.join('\n')}` : '',
    doors.length ? `Двери:\n${doors.join('\n')}` : '',
    npcs.length ? `НПС:\n${npcs.join('\n')}` : 'НПС: никого.',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Раздел «Состояние игры» для системного промта — собирается заново для каждого запроса (факты — отдельной частью). */
export function gameStateText(story: StoryState, ctx: MasterStateContext): string {
  const heroes = story.party.map((m) => heroSheetText(m, ctx)).join('\n\n')
  const quests = story.world.quests.map((q) => `- ${q.title} — ${q.status === 'active' ? 'в работе' : q.status === 'completed' ? 'выполнено' : 'провалено'}`)
  return [
    '## Состояние игры (ведёт код; это главнее твоей памяти)',
    `## Отряд (лист персонажа и инвентарь)\n\n${heroes}`,
    `## Текущая локация\n\n${locationText(story)}`,
    quests.length ? `## Задания\n${quests.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}
