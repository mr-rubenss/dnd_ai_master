// Изменения листа за ход ведущего: что на самом деле изменилось (деньги, предметы, хиты, состояния) — по сравнению
// состояния героев до и после хода — и сверка с тем, что ведущий заявил в служебном инструменте end_turn.
// Если заявленное не сделано инструментами, ведущий один раз довызывает нужные инструменты.
// Строка изменений для ленты («−4 мм (эль)», «−1 стрела», «+5 хитов»). Чистые функции.
import type { AiTool } from '../ai/types'
import { CONDITION_DEFINITIONS, CONDITIONS, type ConditionId } from '../engine/conditions'
import type { TurnChange } from '../types/game'
import type { ItemCatalog } from '../types/items'
import type { PartyMember, StoryState } from '../types/story'
import { COIN_UNITS, coinsValue, formatCp, priceToCp, type CoinUnit } from './coins'
import { isObject } from './validation'

export const END_TURN = 'end_turn'

/** Состояние героя, по которому считаются изменения. */
interface HeroLedger {
  name: string
  money: number
  /** Предметы в «единицах»: штуки, у предметов с зарядами — применения. */
  items: Map<string, number>
  hp: number
  conditions: Set<ConditionId>
  /** Потрачено ячеек по кругам и бесплатных сотворений (ключ «источник:заклинание»). */
  slots: Map<string, number>
  free: Map<string, number>
}

export type TurnLedger = Map<string, HeroLedger>

const units = (entry: { quantity: number; charges?: number }, perItem: number | undefined) =>
  perItem ? (entry.quantity - 1) * perItem + (entry.charges ?? perItem) : entry.quantity

function heroLedger(m: PartyMember, catalog: ItemCatalog): HeroLedger {
  return {
    name: m.character.name,
    money: coinsValue(m.inventory.coins),
    items: new Map(m.inventory.items.map((e) => [e.itemId, units(e, catalog[e.itemId]?.use?.charges)])),
    hp: m.character.hp,
    conditions: new Set(m.character.conditions.map((c) => c.id)),
    slots: new Map(Object.entries(m.character.magic?.slotsUsed ?? {})),
    free: new Map(Object.entries(m.character.magic?.freeUsed ?? {})),
  }
}

/** Снимок отряда в начале хода. */
export const ledgerOf = (story: StoryState, catalog: ItemCatalog): TurnLedger => new Map(story.party.map((m) => [m.heroId, heroLedger(m, catalog)]))

export interface TurnDelta {
  money: Map<string, number>
  items: Map<string, Map<string, number>>
  hp: Map<string, number>
  added: Map<string, ConditionId[]>
  removed: Map<string, ConditionId[]>
  /** Потрачено (плюс) или восстановлено (минус) ячеек по кругам за ход. */
  slots: Map<string, Map<string, number>>
  /** Бесплатные сотворения врождённых заклинаний за ход. */
  free: Map<string, Map<string, number>>
}

const counterDiff = (a: Map<string, number>, b: Map<string, number>) => {
  const diff = new Map<string, number>()
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const d = (a.get(k) ?? 0) - (b.get(k) ?? 0)
    if (d) diff.set(k, d)
  }
  return diff
}

/** Что изменилось между двумя снимками. */
export function turnDelta(before: TurnLedger, after: TurnLedger): TurnDelta {
  const d: TurnDelta = { money: new Map(), items: new Map(), hp: new Map(), added: new Map(), removed: new Map(), slots: new Map(), free: new Map() }
  for (const [heroId, a] of after) {
    const b = before.get(heroId)
    if (!b) continue
    if (a.money !== b.money) d.money.set(heroId, a.money - b.money)
    if (a.hp !== b.hp) d.hp.set(heroId, a.hp - b.hp)
    const items = new Map<string, number>()
    for (const id of new Set([...a.items.keys(), ...b.items.keys()])) {
      const diff = (a.items.get(id) ?? 0) - (b.items.get(id) ?? 0)
      if (diff) items.set(id, diff)
    }
    if (items.size) d.items.set(heroId, items)
    const added = [...a.conditions].filter((c) => !b.conditions.has(c))
    const removed = [...b.conditions].filter((c) => !a.conditions.has(c))
    if (added.length) d.added.set(heroId, added)
    if (removed.length) d.removed.set(heroId, removed)
    const slots = counterDiff(a.slots ?? new Map(), b.slots ?? new Map())
    const free = counterDiff(a.free ?? new Map(), b.free ?? new Map())
    if (slots.size) d.slots.set(heroId, slots)
    if (free.size) d.free.set(heroId, free)
  }
  return d
}

/** Русское число: 1 хит, 2 хита, 5 хитов. */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return forms[2]
  if (b === 1) return forms[0]
  if (b >= 2 && b <= 4) return forms[1]
  return forms[2]
}

const signed = (n: number) => `${n > 0 ? '+' : '−'}${Math.abs(n)}`
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

/** Строка изменений для ленты. reasons — за что платили/получали (из change_gold), по героям. */
export function changeList(
  delta: TurnDelta,
  story: StoryState,
  catalog: ItemCatalog,
  reasons: Map<string, string[]> = new Map(),
  /** Названия заклинаний по id — для строки о бесплатном сотворении. */
  spellNames?: Record<string, string>,
): TurnChange[] {
  const multi = story.party.length > 1
  const changes: TurnChange[] = []
  for (const m of story.party) {
    const who = multi ? `${m.character.name}: ` : ''
    const push = (kind: TurnChange['kind'], text: string, gain: boolean) => changes.push({ heroId: m.heroId, kind, text: who + text, tone: gain ? 'gain' : 'loss' })
    const money = delta.money.get(m.heroId)
    if (money) {
      const why = [...new Set(reasons.get(m.heroId) ?? [])].join(', ')
      push('money', `${money > 0 ? '+' : '−'}${formatCp(money)}${why ? ` (${why})` : ''}`, money > 0)
    }
    for (const [itemId, n] of delta.items.get(m.heroId) ?? []) {
      const item = catalog[itemId]
      const name = lowerFirst(item?.name ?? itemId)
      push('item', item?.use?.charges ? `${signed(n)} ${plural(n, ['применение', 'применения', 'применений'])} (${name})` : `${signed(n)} ${name}`, n > 0)
    }
    const hp = delta.hp.get(m.heroId)
    if (hp) push('hp', `${signed(hp)} ${plural(hp, ['хит', 'хита', 'хитов'])}`, hp > 0)
    for (const c of delta.added.get(m.heroId) ?? []) push('condition', `состояние: ${CONDITION_DEFINITIONS[c].name}`, false)
    for (const c of delta.removed.get(m.heroId) ?? []) push('condition', `снято: ${CONDITION_DEFINITIONS[c].name}`, true)
    for (const [level, n] of delta.slots.get(m.heroId) ?? [])
      push('spell', `${signed(-n)} ${plural(n, ['ячейка', 'ячейки', 'ячеек'])} ${level}-го круга`, n < 0)
    for (const [key, n] of delta.free.get(m.heroId) ?? []) {
      const spellName = spellNames?.[key.split(':')[1] ?? ''] ?? key
      push('spell', `${signed(-n)} ${plural(n, ['бесплатное сотворение', 'бесплатных сотворения', 'бесплатных сотворений'])} («${spellName}»)`, n < 0)
    }
  }
  return changes
}

// ---------- end_turn ----------

/** Служебный инструмент: ведущий перечисляет изменения листа за ход (или пустой список). */
export const END_TURN_TOOL: AiTool = {
  name: END_TURN,
  description:
    'Служебный, обязателен в конце КАЖДОГО ответа: перечисли изменения листа героя за этот ход по твоему рассказу — ' +
    'деньги, предметы, хиты, состояния — или пустой список, если ничего не менялось. Это не меняет игру: изменения делаются ' +
    'инструментами (change_gold, use_item, give_item, remove_item, change_hp, add_condition…). Движок сверит список с ними.',
  parameters: {
    type: 'object',
    properties: {
      changes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['money', 'item', 'hp', 'condition'] },
            hero: { type: 'string', description: 'Имя героя (можно не указывать — герой игрока).' },
            amount: { type: 'number', description: 'money — сколько (минус — заплатил); item — штук/применений (минус — потратил/отдал); hp — хиты (минус — урон).' },
            currency: { type: 'string', enum: ['cp', 'sp', 'gp'], description: 'Для money: монеты amount (по умолчанию gp).' },
            item: { type: 'string', description: 'Для item: id или название предмета.' },
            condition: { type: 'string', description: 'Для condition: id или название состояния.' },
            added: { type: 'boolean', description: 'Для condition: true — наложено, false — снято.' },
          },
          required: ['kind'],
        },
      },
    },
    required: ['changes'],
  },
}

const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е')

function heroIdOf(story: StoryState, query: unknown): string | null {
  if (typeof query !== 'string' || !query.trim()) return story.party.find((m) => !m.fallen)?.heroId ?? null
  return story.party.find((m) => m.heroId === query || norm(m.character.name) === norm(query))?.heroId ?? null
}

/**
 * Сверка end_turn с тем, что на самом деле изменилось за ход. Возвращает список того, чего не хватает
 * (по-русски, с подсказкой, какой инструмент вызвать); пусто — всё сходится.
 */
export function verifyEndTurn(args: unknown, delta: TurnDelta, story: StoryState, catalog: ItemCatalog): string[] {
  const list = isObject(args) && Array.isArray(args.changes) ? args.changes : null
  if (!list) return ['end_turn: нужен список changes (пустой, если ничего не менялось).']
  const problems: string[] = []
  for (const raw of list) {
    if (!isObject(raw)) continue
    const heroId = heroIdOf(story, raw.hero)
    const hero = story.party.find((m) => m.heroId === heroId)
    if (!heroId || !hero) {
      problems.push(`Героя «${String(raw.hero)}» нет в отряде.`)
      continue
    }
    const amount = typeof raw.amount === 'number' ? raw.amount : Number(raw.amount)
    if (raw.kind === 'money') {
      const unit: CoinUnit = (COIN_UNITS as readonly string[]).includes(raw.currency as string) ? (raw.currency as CoinUnit) : 'gp'
      const want = Number.isFinite(amount) ? priceToCp(amount, unit) : null
      const got = delta.money.get(heroId) ?? 0
      if (want === null || want === 0) problems.push('Деньги: укажи amount и currency (например −4 и cp).')
      else if (want !== got)
        problems.push(
          `Деньги ${hero.character.name}: заявлено ${want < 0 ? '−' : '+'}${formatCp(want)}, а в листе ${got ? `${got < 0 ? '−' : '+'}${formatCp(got)}` : 'ничего не изменилось'} — вызови change_gold на разницу (${want - got < 0 ? '−' : '+'}${formatCp(want - got)}).`,
        )
    } else if (raw.kind === 'item') {
      const query = typeof raw.item === 'string' ? raw.item : ''
      const item = catalog[query] ?? Object.values(catalog).find((i) => norm(i.name) === norm(query))
      const got = item ? (delta.items.get(heroId)?.get(item.id) ?? 0) : 0
      if (!item) problems.push(`Предмета «${query}» нет в справочнике.`)
      else if (!Number.isFinite(amount) || amount === 0) problems.push(`Предмет «${item.name}»: укажи amount (минус — потратил или отдал).`)
      else if (got !== amount)
        problems.push(
          `Предмет «${item.name}» у ${hero.character.name}: заявлено ${signed(amount)}, изменилось ${got ? signed(got) : '0'} — ${
            amount < 0 ? 'вызови use_item (израсходовал) или remove_item (отдал, потерял, сломал)' : 'вызови give_item'
          }.`,
        )
    } else if (raw.kind === 'hp') {
      const got = delta.hp.get(heroId) ?? 0
      if (!Number.isFinite(amount) || amount === 0) problems.push('Хиты: укажи amount (минус — урон).')
      else if (Math.sign(got) !== Math.sign(amount))
        problems.push(`Хиты ${hero.character.name}: заявлено ${signed(amount)}, изменилось ${got ? signed(got) : '0'} — вызови change_hp${amount > 0 ? ' или use_item (зелье)' : ''}.`)
    } else if (raw.kind === 'condition') {
      const query = typeof raw.condition === 'string' ? raw.condition : ''
      const id = CONDITIONS.find((c) => c === query || norm(CONDITION_DEFINITIONS[c].name) === norm(query))
      const added = raw.added !== false
      const got = id ? ((added ? delta.added : delta.removed).get(heroId) ?? []).includes(id) : false
      if (!id) problems.push(`Состояния «${query}» нет.`)
      else if (!got) problems.push(`Состояние «${CONDITION_DEFINITIONS[id].name}» у ${hero.character.name} не ${added ? 'наложено' : 'снято'} — вызови ${added ? 'add_condition' : 'remove_condition'}.`)
    }
  }
  return problems
}
