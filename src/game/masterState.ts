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
import { currentLocation, storyTime } from './storyActions'
import { npcDigest } from './npcs'
import { outdoorLight, partOfDay, timeText, type PartOfDay } from '../engine/time'
import { checkSubjectOf, classOrderOf, weaponTraining } from './classOrder'
import { featureResources, hitDiceOf, REST_NAMES } from './rest'
import { recoveryText } from './features'
import { invocationLabel } from './invocations'
import { languageNames } from './languages'
import { masteryRule } from './weaponMastery'
import { MASTERY_LABELS } from '../components/itemText'
import { classSpellcasting, hasMagic, knownSpells, needsSpellChoice, spellcastingStats, spellSlots } from './magic'

export interface MasterStateContext {
  catalog: ItemCatalog
  rules: RulesData
  /** Прейскурант еды, ночлега и услуг — идёт в неизменную часть промта. */
  prices?: PriceList
}

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
    .map((s) => `${SKILL_DEFINITIONS[s].name} ${formatModifier(skillModifier(checkSubjectOf(c, ctx.rules), s))}${c.proficiencies.skills[s] === 'expertise' ? ' (компетентность)' : ''}`)
    .join(', ')
  const conditions = c.conditions.map((x) => CONDITION_DEFINITIONS[x.id].name + (x.level ? ` ${x.level}` : '')).join(', ')
  const feats = c.feats.map((f) => ctx.rules.feats[f]?.name ?? f).join(', ')
  const speed = ctx.rules.species[c.speciesId]?.speed
  const training = weaponTraining(c, ctx.rules)
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
    classOrderOf(c, ctx.rules) ? `${ctx.rules.classes[c.classId]?.order?.feature}: ${classOrderOf(c, ctx.rules)!.name} — ${classOrderOf(c, ctx.rules)!.description}` : '',
    ...originText(c, ctx),
    `Состояния: ${conditions || 'нет'}.`,
    `Экипировка: основная рука — ${name(inv.equipped.mainHand)}, вторая рука — ${name(inv.equipped.offHand)}, доспех — ${name(inv.equipped.armor)}.`,
    attacks.length ? `Атаки: ${attacks.join('; ')}.` : '',
    `Инвентарь: ${items.length ? items.join(', ') : 'пусто'}.`,
    ...restText(member, ctx),
    ...magicText(member, ctx),
    `Кошелёк: ${formatCoins(inv.coins)} (всего ${coinsValue(inv.coins)} мм; 1 зм = 10 см = 100 мм).`,
    `Положение на карте: клетка ${cell(member.position)}.`,
    ...heroPastText(c),
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Магия героя для ведущего: Сл и бонус атаки, ячейки (осталось/всего), заговоры, подготовленные и врождённые
 * заклинания. Чего здесь нет — герой не умеет, и ведущий не даёт это колдовать.
 */
export function magicText(member: PartyMember, ctx: MasterStateContext): string[] {
  const c = member.character
  const rules = ctx.rules
  if (!rules.spells || !hasMagic(c, rules)) return []
  const lines: string[] = []
  const sc = classSpellcasting(c.classId, rules)
  if (sc) {
    const stats = spellcastingStats(c, sc.ability)
    const slots = spellSlots(c, rules)
    lines.push(
      `Магия (${c.className}): характеристика ${ABILITY_ABBREVIATIONS[sc.ability]}, Сл спасброска ${stats.saveDc}, атака заклинанием ${formatModifier(stats.attackBonus)}. ` +
        `Ячейки${slots[0]?.pact ? ' магии договора' : ''}: ${slots.map((s) => `${s.level}-й круг ${s.left}/${s.total}`).join(', ') || 'нет'}.`,
    )
  }
  if (needsSpellChoice(c, rules)) lines.push('Заклинания ещё не выбраны игроком — пока колдовать нельзя (кроме магии вида).')
  const known = knownSpells(c, rules)
  const byGroup = (filter: (k: (typeof known)[number]) => boolean) =>
    known
      .filter(filter)
      .map((k) => `${k.spell.name} (${k.spell.id}${k.spell.ritual ? ', ритуал' : ''}${k.spell.concentration ? ', концентрация' : ''})`)
      .join(', ')
  const cantrips = byGroup((k) => k.source === 'class' && k.spell.level === 0)
  const prepared = byGroup((k) => k.source === 'class' && k.spell.level > 0 && !k.inBookOnly)
  const book = byGroup((k) => Boolean(k.inBookOnly))
  if (cantrips) lines.push(`Заговоры: ${cantrips}.`)
  if (prepared) lines.push(`Подготовлены: ${prepared}.`)
  if (book) lines.push(`В книге, не подготовлены (только ритуалом, если ритуал): ${book}.`)
  const innate = known.filter((k) => k.innate)
  if (innate.length)
    lines.push(
      `Магия черт и вида: ${innate
        .map((k) => {
          const i = k.innate!
          const stats = spellcastingStats(c, k.ability)
          return `${k.spell.name} (${k.spell.id}; ${i.sourceName}; Сл ${stats.saveDc}, атака ${formatModifier(stats.attackBonus)}${i.freeMax !== null ? `; без ячейки ${i.freeMax - i.freeUsed}/${i.freeMax}` : ''})`
        })
        .join(', ')}.`,
    )
  return lines
}

/** Кости хитов и умения с применениями (класс, вид, воззвания; бесплатные сотворения) — для отдыха и use_feature. */
export function restText(member: PartyMember, ctx: MasterStateContext): string[] {
  const c = member.character
  const hd = hitDiceOf(c, ctx.rules)
  const features = featureResources(c, ctx.rules)
  return [
    `Кости хитов: ${hd.left}/${hd.total} (к${hd.die}).`,
    features.length
      ? `Умения с применениями (use_feature): ${features.map((f) => `${f.resource.name} (${f.resource.id}; ${f.sourceName}) ${f.left}/${f.max}, восстановление — ${recoveryText(f.resource)}`).join(', ')}.`
      : '',
  ]
}

/**
 * Языки, приёмы оружия и воззвания. Языки — что герой понимает: речь и тексты на остальных ему непонятны.
 */
export function originText(c: PartyMember['character'], ctx: MasterStateContext): string[] {
  const rules = ctx.rules
  const lines: string[] = []
  if (rules.languages)
    lines.push(
      c.languages?.length
        ? `Языки (только их герой понимает, на остальных речь и надписи ему непонятны): ${languageNames(c.languages, rules)}.`
        : 'Языки ещё не выбраны игроком — считай, что герой знает только Общий.',
    )
  if (masteryRule(c.classId, rules) && c.weaponMasteries?.length)
    lines.push(
      `Приёмы оружия освоены: ${c.weaponMasteries
        .map((id) => {
          const m = ctx.catalog[id]?.weapon?.mastery
          return `${ctx.catalog[id]?.name ?? id}${m ? ` — ${MASTERY_LABELS[m]}` : ''}`
        })
        .join(', ')} (эффекты в бою — позже).`,
    )
  if (c.invocations?.length && rules.invocations)
    lines.push(`Таинственные воззвания: ${c.invocations.map((x) => `${invocationLabel(x, rules)} — ${rules.invocations[x.id]?.description ?? ''}`).join('; ')}`)
  return lines
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
  const npcs = location.npcs.map(npcDigest)
  return [
    `### ${location.name}`,
    location.description,
    `Карта ${location.width}×${location.height} клеток, клетка — ${location.cellFeet} фт.`,
    rooms.length ? `Помещения: ${rooms.join('; ')}.` : '',
    objects.length ? `Объекты:\n${objects.join('\n')}` : '',
    doors.length ? `Двери:\n${doors.join('\n')}` : '',
    npcs.length
      ? `НПС (личность — твои заметки: не выдавай сразу, раскрывай по крупицам; реплики — из цели и манеры речи):\n${npcs.join('\n')}`
      : 'НПС: никого.',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Что обычно бывает в это время суток — подсказка ведущему. */
const PART_OF_DAY_HINTS: Record<PartOfDay, string> = {
  morning: 'утро: лавки и рынки открываются, люди идут на работу, в тавернах завтракают',
  day: 'день: светло, лавки, мастерские и рынки открыты, на улицах людно',
  evening: 'вечер: смеркается, лавки закрываются, таверны полны, зажигают огни',
  night: 'ночь: темно, лавки закрыты, улицы пусты, в тавернах лишь засидевшиеся гости, по городу ходит стража',
}

/** Раздел «Время»: день, час, время суток и что из этого следует. */
export function timeSectionText(story: Pick<StoryState, 'time' | 'lastLongRestAt'>): string {
  const t = storyTime(story)
  const light = outdoorLight(t)
  const lightText = light === 'bright' ? 'яркий дневной свет' : light === 'dim' ? 'сумерки (тусклый свет)' : 'темнота'
  return [
    `## Время\nСейчас ${timeText(t)}. Под открытым небом — ${lightText}.`,
    `Учитывай время суток: ${PART_OF_DAY_HINTS[partOfDay(t)]}.`,
    'Прошло заметное время (долгий разговор, дорога, ожидание, сон) — вызови advance_time. Время не идёт назад.',
  ].join('\n')
}

/** Раздел «Состояние игры» для системного промта — собирается заново для каждого запроса (факты — отдельной частью). */
export function gameStateText(story: StoryState, ctx: MasterStateContext): string {
  const heroes = story.party.map((m) => heroSheetText(m, ctx)).join('\n\n')
  const quests = story.world.quests.map((q) => `- ${q.title} — ${q.status === 'active' ? 'в работе' : q.status === 'completed' ? 'выполнено' : 'провалено'}`)
  return [
    '## Состояние игры (ведёт код; это главнее твоей памяти)',
    timeSectionText(story),
    `## Отряд (лист персонажа и инвентарь)\n\n${heroes}`,
    `## Текущая локация\n\n${locationText(story)}`,
    quests.length ? `## Задания\n${quests.join('\n')}` : '',
    story.pendingRest
      ? `## Отдых\nИгрок просит: ${REST_NAMES[story.pendingRest.kind].toLowerCase()}. Реши, безопасно ли здесь отдыхать: можно — вызови rest (kind: ${story.pendingRest.kind}), опасно — interrupt_rest с причиной. Если не вызовешь ни то ни другое, отряд отдохнёт.`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}
