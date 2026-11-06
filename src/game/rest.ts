// Отдых по SRD 5.2 (до боевого этапа). Короткий (1 час): кости хитов по выбору игрока (бросок движком + мод. Тел),
// ячейки магии договора, умения «до короткого отдыха». Долгий (8 часов): все хиты, все кости хитов, все ячейки
// и бесплатные сотворения, все умения, −1 уровень Истощения; после него можно сменить подготовленные заклинания
// и приёмы оружия.
// Игровых суток пока нет — ограничения «один долгий отдых за 24 часа» тоже нет. Чистые функции.
import { abilityModifier } from '../engine/abilities'
import { roll, type Rng } from '../engine/dice'
import type { Character } from '../types/character'
import type { RulesData } from '../types/rules'
import type { PartyMember, RestHeroResult, RestKind, StoryEvent, StoryState } from '../types/story'
import { featureNames, featureResources, shortRestReturn } from './features'
import { classSpellcasting, type MagicRules } from './magic'

export type RestRules = MagicRules

export const REST_NAMES: Record<RestKind, string> = { short: 'Короткий отдых (1 час)', long: 'Долгий отдых (8 часов)' }

// ---------- Кости хитов ----------

export interface HitDice {
  /** Грани кости (к10 у Воина). */
  die: number
  total: number
  left: number
}

export function hitDiceOf(c: Pick<Character, 'classId' | 'level' | 'hitDiceUsed'>, rules: Pick<RulesData, 'classes'>): HitDice {
  const die = rules.classes[c.classId]?.hitDie ?? 8
  const total = c.level
  return { die, total, left: Math.max(0, total - (c.hitDiceUsed ?? 0)) }
}

// ---------- Умения с применениями — src/game/features.ts ----------

export { featureResources, resourceMax, type ResourceState } from './features'

// ---------- Отдых ----------

/** Почему герой не может отдыхать (или null). */
export function restBlocker(m: PartyMember): string | null {
  if (m.fallen) return `${m.character.name} погиб.`
  if (m.character.hp <= 0) return `${m.character.name} без сознания (0 хитов) — сначала его нужно привести в чувство.`
  return null
}

/** Проверка просьбы об отдыхе: кости хитов — не больше, чем осталось. */
export function restRequestProblem(story: StoryState, kind: RestKind, hitDice: Record<string, number>, rules: Pick<RulesData, 'classes'>): string | null {
  if (kind !== 'short' && kind !== 'long') return 'Отдых — короткий или долгий.'
  if (story.pendingRest) return 'Отдых уже начат — дождитесь ответа ведущего.'
  const resting = story.party.filter((m) => !restBlocker(m))
  if (resting.length === 0) return restBlocker(story.party[0]) ?? 'В отряде некому отдыхать.'
  for (const [heroId, n] of Object.entries(hitDice)) {
    const m = story.party.find((x) => x.heroId === heroId)
    if (!m) return 'Этого героя нет в отряде истории.'
    if (!Number.isInteger(n) || n < 0) return 'Число костей хитов — целое не меньше 0.'
    if (kind === 'long' && n > 0) return 'Кости хитов тратятся только на коротком отдыхе.'
    const left = hitDiceOf(m.character, rules).left
    if (n > left) return `У ${m.character.name} осталось костей хитов: ${left}.`
    if (n > 0 && restBlocker(m)) return restBlocker(m)
  }
  return null
}

/** Что даст отдых герою (без бросков: хиты от костей хитов добавит restEvents). */
function restoration(m: PartyMember, kind: RestKind, rules: RestRules): Omit<RestHeroResult, 'hpGained' | 'hitDiceRolls'> {
  const c = m.character
  const pact = classSpellcasting(c.classId, rules)?.progression === 'pact'
  const resources: Record<string, number> = {}
  for (const r of featureResources(c, rules)) {
    const back = kind === 'long' ? r.used : shortRestReturn(r)
    if (back > 0) resources[r.resource.id] = back
  }
  const hd = hitDiceOf(c, rules)
  return {
    heroId: m.heroId,
    hitDiceRegained: kind === 'long' ? hd.total - hd.left : 0,
    restoreSlots: kind === 'long' || pact,
    restoreFreeCasts: kind === 'long',
    resources,
    exhaustionRemoved: kind === 'long' && c.conditions.some((x) => x.id === 'exhaustion'),
    ...(kind === 'long' && rules.classes[c.classId]?.weaponMastery ? { masterySwap: true } : {}),
  }
}

export interface RestContext {
  rules: RestRules
  rng?: Rng
  now: () => number
  newId: () => string
}

/**
 * События отдыха: броски костей хитов (diceRolled) и restCompleted. Герои без сознания и погибшие не отдыхают.
 * Короткий: каждая кость — бросок + мод. Тел (не меньше 1). Долгий: хиты до максимума.
 */
export function restEvents(story: StoryState, kind: RestKind, hitDice: Record<string, number>, ctx: RestContext): StoryEvent[] {
  const events: StoryEvent[] = []
  const heroes: RestHeroResult[] = []
  for (const m of story.party) {
    if (restBlocker(m)) continue
    const c = m.character
    const hitDiceRolls: number[] = []
    if (kind === 'short') {
      const { die, left } = hitDiceOf(c, ctx.rules)
      const con = abilityModifier(c.abilities.con)
      for (let i = 0; i < Math.min(left, hitDice[m.heroId] ?? 0); i++) {
        const notation = `1d${die}${con > 0 ? `+${con}` : con < 0 ? `${con}` : ''}`
        const r = roll(notation, { rng: ctx.rng })
        events.push({ type: 'diceRolled', roll: { id: `roll-${ctx.newId()}`, label: `${c.name}: кость хитов`, timestamp: ctx.now(), result: r } })
        hitDiceRolls.push(Math.max(1, r.total))
      }
    }
    const healed = hitDiceRolls.reduce((a, b) => a + b, 0)
    const hpGained = kind === 'long' ? c.maxHp - c.hp : Math.min(c.maxHp - c.hp, healed)
    heroes.push({ ...restoration(m, kind, ctx.rules), hpGained, hitDiceRolls })
  }
  events.push({ type: 'restCompleted', messageId: ctx.newId(), kind, heroes })
  return events
}

/** Применить итог отдыха к герою (детерминированно — всё посчитано заранее). */
export function applyRestResult(c: Character, r: RestHeroResult): Character {
  const hitDiceUsed = Math.max(0, (c.hitDiceUsed ?? 0) + r.hitDiceRolls.length - r.hitDiceRegained)
  const featureUses = { ...c.featureUses }
  for (const [id, n] of Object.entries(r.resources)) featureUses[id] = Math.max(0, (featureUses[id] ?? 0) - n)
  for (const id of Object.keys(featureUses)) if (!featureUses[id]) delete featureUses[id]
  const magic = c.magic && {
    ...c.magic,
    ...(r.restoreSlots ? { slotsUsed: {} } : {}),
    ...(r.restoreFreeCasts ? { freeUsed: {} } : {}),
  }
  const conditions = r.exhaustionRemoved
    ? c.conditions.flatMap((x) => (x.id !== 'exhaustion' ? [x] : (x.level ?? 1) > 1 ? [{ ...x, level: (x.level ?? 1) - 1 }] : []))
    : c.conditions
  const next: Character = { ...c, hp: Math.min(c.maxHp, c.hp + r.hpGained), conditions, ...(magic ? { magic } : {}), ...(r.masterySwap ? { masterySwapReady: true } : {}) }
  if (hitDiceUsed) next.hitDiceUsed = hitDiceUsed
  else delete next.hitDiceUsed
  if (Object.keys(featureUses).length) next.featureUses = featureUses
  else delete next.featureUses
  return next
}

/** Проверка итога отдыха по листу героя. */
export function restResultProblem(m: PartyMember, kind: RestKind, r: RestHeroResult, rules: RestRules): string | null {
  const c = m.character
  if (restBlocker(m)) return restBlocker(m)
  const ints = [r.hpGained, r.hitDiceRegained, ...r.hitDiceRolls, ...Object.values(r.resources)]
  if (!ints.every((n) => Number.isInteger(n) && n >= 0)) return 'Итог отдыха — целые неотрицательные числа.'
  if (c.hp + r.hpGained > c.maxHp) return 'Хиты после отдыха больше максимума.'
  const hd = hitDiceOf(c, rules)
  if (kind === 'long' && r.hitDiceRolls.length > 0) return 'На долгом отдыхе кости хитов не бросают.'
  if (r.hitDiceRolls.length > hd.left) return `У ${c.name} осталось костей хитов: ${hd.left}.`
  if (kind === 'short' && (r.hitDiceRegained > 0 || r.restoreFreeCasts || r.exhaustionRemoved || r.masterySwap)) return 'Короткий отдых этого не восстанавливает.'
  if (r.masterySwap && !rules.classes[c.classId]?.weaponMastery) return 'У класса нет приёмов оружия.'
  if (kind === 'short' && r.restoreSlots && classSpellcasting(c.classId, rules)?.progression !== 'pact')
    return 'На коротком отдыхе восстанавливаются только ячейки магии договора.'
  const states = featureResources(c, rules)
  for (const [id, n] of Object.entries(r.resources)) {
    const s = states.find((x) => x.resource.id === id)
    if (!s || n > s.used) return 'Нельзя вернуть больше применений умения, чем потрачено.'
    if (kind === 'short' && n > shortRestReturn(s)) return `«${s.resource.name}» на коротком отдыхе возвращает не больше ${shortRestReturn(s)}.`
  }
  return null
}

/** Текст для ленты: чем закончился отдых. */
export function restSummaryText(kind: RestKind): string {
  return kind === 'long'
    ? 'Долгий отдых (8 часов) окончен. Подготовленные заклинания можно сменить во вкладке «Магия».'
    : 'Короткий отдых (1 час) окончен.'
}

/** Названия заклинаний и умений по id — для строки изменений. */
export function changeNames(rules: Pick<RulesData, 'spells' | 'classes'> & Partial<Pick<RulesData, 'species' | 'invocations'>>) {
  const spells = Object.fromEntries(Object.values(rules.spells).map((s) => [s.id, s.name]))
  return { spells, features: featureNames(rules) }
}
