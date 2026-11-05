// Инструменты ИИ-ведущего: единственный способ ведущего менять игру. Модель только предлагает вызов —
// движок проверяет аргументы и состояние, превращает вызов в действия истории (StoryEvent), прогоняет их через
// checkAction на копии состояния и возвращает результат для модели. Недопустимый вызов отклоняется с причиной,
// ничего не меняя. Чистые функции; запись действий в историю делает вызывающий код (masterTurn.ts).
import type { AiTool, AiToolCall } from '../ai/types'
import { ABILITIES, ABILITY_NAMES, type Ability } from '../engine/abilities'
import { abilityCheck, CheckError, MAX_DC, MIN_DC, savingThrow, type D20TestResult } from '../engine/checks'
import { CONDITION_DEFINITIONS, CONDITIONS, MAX_EXHAUSTION, type ActiveCondition, type ConditionId } from '../engine/conditions'
import type { RollMode, Rng } from '../engine/dice'
import { SKILL_DEFINITIONS, SKILLS, type SkillId } from '../engine/skills'
import type { ItemCatalog } from '../types/items'
import { DOOR_STATES, NPC_ATTITUDES, OBJECT_TYPES, type DoorState, type MapObject, type MapObjectType, type NpcAttitude } from '../types/location'
import type { ActionAuthor, PartyMember, StoryEvent, StoryState } from '../types/story'
import { placementProblem } from './mapPlacement'
import { applyAction, checkAction, ENGINE, makeAction, MASTER } from './storyActions'

/** Типы урона SRD 5.2. */
export const DAMAGE_TYPE_NAMES = {
  acid: 'кислотой',
  bludgeoning: 'дробящий',
  cold: 'холодом',
  fire: 'огнём',
  force: 'силовым полем',
  lightning: 'электричеством',
  necrotic: 'некротический',
  piercing: 'колющий',
  poison: 'ядом',
  psychic: 'психический',
  radiant: 'излучением',
  slashing: 'рубящий',
  thunder: 'звуком',
} as const
type DamageTypeId = keyof typeof DAMAGE_TYPE_NAMES

const HERO = { type: 'string', description: 'Имя или id героя. Можно не указывать — тогда это герой игрока.' }
const int = (description: string, min?: number, max?: number) => ({
  type: 'integer',
  description,
  ...(min !== undefined ? { minimum: min } : {}),
  ...(max !== undefined ? { maximum: max } : {}),
})
const str = (description: string) => ({ type: 'string', description })
const oneOf = (values: readonly string[], description: string) => ({ type: 'string', enum: [...values], description })
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})

/** Описания инструментов для модели. */
export const MASTER_TOOLS: AiTool[] = [
  {
    name: 'request_check',
    description:
      'Попросить движок бросить проверку навыка или характеристики (или спасбросок) героя против Сл. Вызывай, когда исход действия неочевиден. ' +
      'Движок бросит кубик сам и вернёт результат — по нему опиши исход. Укажи ровно одно: skill или ability.',
    parameters: object(
      {
        hero: HERO,
        skill: oneOf(SKILLS, `Навык: ${SKILLS.map((s) => `${s} — ${SKILL_DEFINITIONS[s].name}`).join(', ')}.`),
        ability: oneOf(ABILITIES, `Характеристика (если проверка без навыка): ${ABILITIES.map((a) => `${a} — ${ABILITY_NAMES[a]}`).join(', ')}.`),
        saving_throw: { type: 'boolean', description: 'true — спасбросок этой характеристики (только с ability).' },
        dc: int('Сложность: 10 — просто, 15 — средне, 20 — трудно, 25 — почти невозможно.', MIN_DC, MAX_DC),
        reason: str('Зачем проверка, коротко: «убедить Гуннара открыть кладовую».'),
        mode: oneOf(['normal', 'advantage', 'disadvantage'], 'Преимущество или помеха от обстоятельств (состояния героя движок учтёт сам).'),
      },
      ['dc', 'reason'],
    ),
  },
  {
    name: 'give_item',
    description: 'Дать герою предмет из справочника игры (нашёл, купил, получил в награду).',
    parameters: object(
      {
        hero: HERO,
        item: str('id предмета или его точное русское название из справочника.'),
        quantity: int('Сколько штук (по умолчанию 1).', 1, 999),
      },
      ['item'],
    ),
  },
  {
    name: 'remove_item',
    description: 'Забрать у героя предмет (потратил, отдал, потерял, сломал). Нельзя забрать то, чего у героя нет.',
    parameters: object({ hero: HERO, item: str('id предмета или его название.'), quantity: int('Сколько штук (по умолчанию 1).', 1, 999) }, ['item']),
  },
  {
    name: 'change_gold',
    description: 'Изменить золото героя: положительное число — получил, отрицательное — заплатил. Нельзя уйти в минус.',
    parameters: object(
      { hero: HERO, amount: { type: 'number', description: 'Сколько золотых (зм), например 5 или −2.5.' }, reason: str('За что.') },
      ['amount'],
    ),
  },
  {
    name: 'change_hp',
    description:
      'Нанести герою урон (с типом) или вылечить. Хиты не опускаются ниже 0 и не поднимаются выше максимума; при 0 хитов герой теряет сознание — это движок применит сам.',
    parameters: object(
      {
        hero: HERO,
        kind: oneOf(['damage', 'healing'], 'damage — урон, healing — лечение.'),
        amount: int('Сколько хитов.', 1, 999),
        damage_type: oneOf(Object.keys(DAMAGE_TYPE_NAMES), 'Тип урона (для damage).'),
        source: str('Источник: «удар дубинкой», «падение с лестницы».'),
      },
      ['kind', 'amount'],
    ),
  },
  {
    name: 'move_npc',
    description: 'Переместить НПС на текущей карте в свободную клетку пола.',
    parameters: object({ npc: str('id или имя НПС.'), x: int('Столбец клетки.', 0), y: int('Строка клетки.', 0) }, ['npc', 'x', 'y']),
  },
  {
    name: 'add_npc',
    description: 'Добавить на текущую карту нового НПС (вошёл в таверну, вылез из погреба) в свободную клетку пола.',
    parameters: object(
      {
        name: str('Имя.'),
        x: int('Столбец клетки.', 0),
        y: int('Строка клетки.', 0),
        attitude: oneOf(NPC_ATTITUDES, 'Отношение к героям.'),
        description: str('Кто это, как выглядит.'),
      },
      ['name', 'x', 'y'],
    ),
  },
  {
    name: 'remove_npc',
    description: 'Убрать НПС с текущей карты (ушёл, сбежал, погиб).',
    parameters: object({ npc: str('id или имя НПС.') }, ['npc']),
  },
  {
    name: 'add_condition',
    description: 'Наложить на героя состояние SRD 5.2 (отравлен, сбит с ног…). Истощение — с уровнем.',
    parameters: object(
      {
        hero: HERO,
        condition: oneOf(CONDITIONS, `Состояние: ${CONDITIONS.map((c) => `${c} — ${CONDITION_DEFINITIONS[c].name}`).join(', ')}.`),
        level: int('Уровень Истощения (только для exhaustion).', 1, MAX_EXHAUSTION),
      },
      ['condition'],
    ),
  },
  {
    name: 'remove_condition',
    description: 'Снять с героя состояние.',
    parameters: object({ hero: HERO, condition: oneOf(CONDITIONS, 'Состояние.') }, ['condition']),
  },
  {
    name: 'note_fact',
    description: 'Записать в журнал важный факт о мире, который нужно помнить дальше: «Тобиас работает на гильдию воров».',
    parameters: object({ text: str('Факт одним предложением.') }, ['text']),
  },
  {
    name: 'add_object',
    description:
      'Добавить на текущую карту объект обстановки: огонь, обломки, упавшую люстру, ящик. Движок проверит, что клетки на карте, это пол и они свободны.',
    parameters: object(
      {
        name: str('Название: «Упавшая люстра».'),
        type: oneOf(OBJECT_TYPES, 'Вид: table, chair, bar, fireplace, barrel, fire — огонь, debris — обломки, item — прочий предмет.'),
        x: int('Столбец левой верхней клетки.', 0),
        y: int('Строка левой верхней клетки.', 0),
        w: int('Ширина в клетках (по умолчанию 1).', 1, 10),
        h: int('Высота в клетках (по умолчанию 1).', 1, 10),
        description: str('Как выглядит.'),
      },
      ['name', 'type', 'x', 'y'],
    ),
  },
  {
    name: 'remove_object',
    description: 'Убрать объект с текущей карты (сгорел, унесли, разобрали).',
    parameters: object({ object: str('id или название объекта.') }, ['object']),
  },
  {
    name: 'update_object',
    description: 'Изменить объект на карте: опрокинутый стол, загоревшаяся бочка, сдвинутый шкаф. Укажи только то, что меняется.',
    parameters: object(
      {
        object: str('id или название объекта.'),
        name: str('Новое название.'),
        description: str('Новое описание.'),
        type: oneOf(OBJECT_TYPES, 'Новый вид.'),
        x: int('Новый столбец.', 0),
        y: int('Новая строка.', 0),
        w: int('Новая ширина.', 1, 10),
        h: int('Новая высота.', 1, 10),
      },
      ['object'],
    ),
  },
  {
    name: 'set_door',
    description: 'Открыть, закрыть или запереть дверь на текущей карте (в том числе выломанная дверь — open).',
    parameters: object({ door: str('id или название двери.'), state: oneOf(DOOR_STATES, 'open — открыта, closed — закрыта, locked — заперта.') }, [
      'door',
      'state',
    ]),
  },
]

export interface ToolContext {
  catalog: ItemCatalog
  /** Генератор случайных чисел для бросков (в тестах — подменённый). */
  rng?: Rng
  now: () => number
  newId: () => string
}

export interface ToolEvent {
  event: StoryEvent
  author: ActionAuthor
}

export interface ToolOutcome {
  ok: boolean
  /** Что вернуть модели (JSON). */
  result: Record<string, unknown>
  /** Действия для истории (пусто, если вызов отклонён). */
  events: ToolEvent[]
}

class ToolRejected extends Error {}
const reject = (reason: string): never => {
  throw new ToolRejected(reason)
}

// ---------- Разбор аргументов ----------

type Args = Record<string, unknown>
const text = (args: Args, key: string, required = false): string | undefined => {
  const v = args[key]
  if (v === undefined || v === null || v === '') return required ? reject(`Нужен параметр «${key}».`) : undefined
  return typeof v === 'string' && v.trim() ? v.trim() : reject(`«${key}» — непустая строка.`)
}
const integer = (args: Args, key: string, required = false): number | undefined => {
  const v = args[key]
  if (v === undefined || v === null) return required ? reject(`Нужен параметр «${key}».`) : undefined
  return typeof v === 'number' && Number.isInteger(v) ? v : reject(`«${key}» — целое число.`)
}
const choice = <T extends string>(args: Args, key: string, values: readonly T[], required = false): T | undefined => {
  const v = text(args, key, required)
  if (v === undefined) return undefined
  return (values as readonly string[]).includes(v) ? (v as T) : reject(`«${key}»: «${v}» — не из списка: ${values.join(', ')}.`)
}
const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е')

/** Найти по id или имени; несколько с одинаковым именем — попросить id. */
function findByName<T extends { id: string; name: string }>(list: readonly T[], query: string, what: string): T {
  const exact = list.find((x) => x.id === query)
  if (exact) return exact
  const named = list.filter((x) => norm(x.name) === norm(query))
  if (named.length === 1) return named[0]
  if (named.length > 1) return reject(`${what} с именем «${query}» несколько — укажи id: ${named.map((x) => x.id).join(', ')}.`)
  return reject(`${what} «${query}» здесь нет. Есть: ${list.map((x) => `${x.name} (${x.id})`).join(', ') || 'никого'}.`)
}

function heroOf(state: StoryState, args: Args): PartyMember {
  const query = text(args, 'hero')
  const living = state.party.filter((m) => !m.fallen)
  if (!query) return living[0] ?? reject('В отряде нет живых героев.')
  const member = state.party.find((m) => m.heroId === query || norm(m.character.name) === norm(query))
  if (!member) return reject(`Героя «${query}» нет в отряде. В отряде: ${state.party.map((m) => m.character.name).join(', ')}.`)
  return member.fallen ? reject(`${member.character.name} погиб.`) : member
}

function itemOf(catalog: ItemCatalog, query: string) {
  const item = catalog[query] ?? Object.values(catalog).find((i) => norm(i.name) === norm(query))
  if (item) return item
  const near = Object.values(catalog)
    .filter((i) => norm(i.name).includes(norm(query)) || norm(query).includes(norm(i.name)))
    .slice(0, 5)
  return reject(`Предмета «${query}» нет в справочнике.${near.length ? ` Похожие: ${near.map((i) => `${i.name} (${i.id})`).join(', ')}.` : ''}`)
}

const currentLocationOf = (state: StoryState) => state.world.locations[state.world.currentLocationId]
const heroesOnMap = (state: StoryState) => state.party.filter((m) => !m.fallen).map((m) => ({ name: m.character.name, position: m.position }))

/** id из названия: латиница/цифры не обязательны — берём короткий случайный хвост. */
const slugId = (prefix: string, existing: { id: string }[], newId: () => string) => {
  let id = `${prefix}-${newId()
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 8)
    .toLowerCase()}`
  while (existing.some((x) => x.id === id)) id += 'x'
  return id
}

// ---------- Инструменты ----------

type Handler = (state: StoryState, args: Args, ctx: ToolContext) => { events: ToolEvent[]; result: Record<string, unknown> }

const HANDLERS: Record<string, Handler> = {
  request_check(state, args, ctx) {
    const member = heroOf(state, args)
    const skill = choice<SkillId>(args, 'skill', SKILLS)
    const ability = choice<Ability>(args, 'ability', ABILITIES)
    const save = args.saving_throw === true
    if (!!skill === !!ability) reject('Укажи ровно одно: skill или ability.')
    if (save && !ability) reject('Спасбросок — с ability, а не со skill.')
    const dc = integer(args, 'dc', true)!
    const reason = text(args, 'reason', true)!
    const mode = choice<RollMode>(args, 'mode', ['normal', 'advantage', 'disadvantage']) ?? 'normal'
    let check: D20TestResult
    try {
      check = save
        ? savingThrow(member.character, ability!, { dc, mode, rng: ctx.rng })
        : abilityCheck(member.character, skill ? { skill } : { ability: ability! }, { dc, mode, rng: ctx.rng })
    } catch (error) {
      if (error instanceof CheckError) return reject(error.message)
      throw error
    }
    const id = ctx.newId()
    const roll = check.roll ? { id: `roll-${id}`, label: check.label, timestamp: ctx.now(), result: check.roll } : undefined
    return {
      events: [
        {
          event: {
            type: 'checkRolled',
            messageId: `check-${id}`,
            check: { heroId: member.heroId, heroName: member.character.name, reason, result: check },
            roll,
          },
          author: ENGINE,
        },
      ],
      result: {
        check: check.label,
        hero: member.character.name,
        dc,
        mode: check.mode,
        natural: check.roll?.natural ?? null,
        modifier: check.modifier,
        total: check.total,
        success: check.success,
        margin: check.margin,
        auto_fail: check.autoFailReason,
        message: `${check.label}, Сл ${dc}: ${check.total ?? 'автоматический провал'} — ${check.success ? 'успех' : 'провал'}. Опиши исход.`,
      },
    }
  },

  give_item(state, args, ctx) {
    const member = heroOf(state, args)
    const item = itemOf(ctx.catalog, text(args, 'item', true)!)
    const quantity = integer(args, 'quantity') ?? 1
    return {
      events: [{ event: { type: 'itemsGranted', heroId: member.heroId, items: [{ itemId: item.id, quantity }] }, author: MASTER }],
      result: { message: `${member.character.name} получает: ${item.name}${quantity > 1 ? ` ×${quantity}` : ''}.` },
    }
  },

  remove_item(state, args, ctx) {
    const member = heroOf(state, args)
    const query = text(args, 'item', true)!
    const owned = member.inventory.items.map((e) => ctx.catalog[e.itemId]).filter(Boolean)
    const item = ctx.catalog[query] ?? owned.find((i) => norm(i.name) === norm(query)) ?? itemOf(ctx.catalog, query)
    const quantity = integer(args, 'quantity') ?? 1
    return {
      events: [{ event: { type: 'itemsRemoved', heroId: member.heroId, items: [{ itemId: item.id, quantity }] }, author: MASTER }],
      result: { message: `${member.character.name} лишается: ${item.name}${quantity > 1 ? ` ×${quantity}` : ''}.` },
    }
  },

  change_gold(state, args) {
    const member = heroOf(state, args)
    const amount = args.amount
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount === 0) reject('«amount» — ненулевое число.')
    const delta = Math.round((amount as number) * 100) / 100
    return {
      events: [{ event: { type: 'goldChanged', heroId: member.heroId, delta }, author: MASTER }],
      result: {
        gold: Math.round((member.inventory.gold + delta) * 100) / 100,
        message: `Золото ${member.character.name}: ${delta > 0 ? '+' : ''}${delta} зм.`,
      },
    }
  },

  change_hp(state, args) {
    const member = heroOf(state, args)
    const kind = choice<'damage' | 'healing'>(args, 'kind', ['damage', 'healing'], true)!
    const amount = integer(args, 'amount', true)!
    if (amount < 1) reject('«amount» — не меньше 1.')
    const damageType = choice<DamageTypeId>(args, 'damage_type', Object.keys(DAMAGE_TYPE_NAMES) as DamageTypeId[])
    const c = member.character
    const events: ToolEvent[] = [
      { event: { type: 'hpChanged', heroId: member.heroId, kind, amount, ...(damageType ? { damageType } : {}) }, author: MASTER },
    ]
    const hp = kind === 'damage' ? Math.max(0, c.hp - amount) : Math.min(c.maxHp, c.hp + amount)
    const has = (id: ConditionId) => c.conditions.some((x) => x.id === id)
    let died = false
    let unconscious = has('unconscious')
    if (kind === 'damage' && hp === 0) {
      // SRD 5.2: урон, который сверх нуля хитов достигает максимума хитов, убивает сразу; иначе — без сознания.
      if (amount - c.hp >= c.maxHp) {
        died = true
        events.push({ event: { type: 'heroDied', heroId: member.heroId }, author: ENGINE })
      } else if (!unconscious) {
        unconscious = true
        events.push({
          event: { type: 'conditionsChanged', heroId: member.heroId, conditions: [...c.conditions, { id: 'unconscious' }] },
          author: ENGINE,
        })
      }
    }
    if (kind === 'healing' && c.hp === 0 && hp > 0 && unconscious) {
      unconscious = false
      events.push({
        event: { type: 'conditionsChanged', heroId: member.heroId, conditions: c.conditions.filter((x) => x.id !== 'unconscious') },
        author: ENGINE,
      })
    }
    const typeText = damageType ? ` (${DAMAGE_TYPE_NAMES[damageType]})` : ''
    return {
      events,
      result: {
        hp: died ? 0 : hp,
        max_hp: c.maxHp,
        unconscious,
        died,
        message: died
          ? `${c.name} погибает от массивного урона${typeText}.`
          : `${c.name}: ${kind === 'damage' ? `урон ${amount}${typeText}` : `лечение ${amount}`}, хиты ${hp}/${c.maxHp}${hp === 0 ? ', без сознания' : ''}.`,
      },
    }
  },

  move_npc(state, args) {
    const location = currentLocationOf(state)
    const npc = findByName(location.npcs, text(args, 'npc', true)!, 'НПС')
    const to = { x: integer(args, 'x', true)!, y: integer(args, 'y', true)! }
    const problem = placementProblem(location, heroesOnMap(state), to, { npcId: npc.id, creature: true })
    if (problem) reject(problem)
    return {
      events: [{ event: { type: 'npcMoved', locationId: location.id, npcId: npc.id, to }, author: MASTER }],
      result: { message: `${npc.name} — теперь в клетке (${to.x}, ${to.y}).` },
    }
  },

  add_npc(state, args, ctx) {
    const location = currentLocationOf(state)
    const name = text(args, 'name', true)!
    const x = integer(args, 'x', true)!
    const y = integer(args, 'y', true)!
    const attitude = choice<NpcAttitude>(args, 'attitude', NPC_ATTITUDES)
    const description = text(args, 'description')
    const problem = placementProblem(location, heroesOnMap(state), { x, y }, { creature: true })
    if (problem) reject(problem)
    const id = slugId('npc', location.npcs, ctx.newId)
    return {
      events: [
        {
          event: {
            type: 'npcAdded',
            locationId: location.id,
            npc: { id, name, x, y, ...(attitude ? { attitude } : {}), ...(description ? { description } : {}) },
          },
          author: MASTER,
        },
      ],
      result: { id, message: `${name} появляется в клетке (${x}, ${y}).` },
    }
  },

  remove_npc(state, args) {
    const location = currentLocationOf(state)
    const npc = findByName(location.npcs, text(args, 'npc', true)!, 'НПС')
    return {
      events: [{ event: { type: 'npcRemoved', locationId: location.id, npcId: npc.id }, author: MASTER }],
      result: { message: `${npc.name} уходит с карты.` },
    }
  },

  add_condition(state, args) {
    const member = heroOf(state, args)
    const condition = choice<ConditionId>(args, 'condition', CONDITIONS, true)!
    const level = integer(args, 'level')
    const current = member.character.conditions
    let next: ActiveCondition[]
    if (condition === 'exhaustion') {
      const was = current.find((c) => c.id === 'exhaustion')?.level ?? 0
      const target = level ?? was + 1
      if (target < 1 || target > MAX_EXHAUSTION) reject(`Уровень Истощения — от 1 до ${MAX_EXHAUSTION}.`)
      next = [...current.filter((c) => c.id !== 'exhaustion'), { id: 'exhaustion', level: target }]
    } else {
      if (level !== undefined) reject('Уровень бывает только у Истощения.')
      if (current.some((c) => c.id === condition)) reject(`${member.character.name} уже: ${CONDITION_DEFINITIONS[condition].name}.`)
      next = [...current, { id: condition }]
    }
    return {
      events: [{ event: { type: 'conditionsChanged', heroId: member.heroId, conditions: next }, author: MASTER }],
      result: { message: `${member.character.name}: ${CONDITION_DEFINITIONS[condition].name}.`, effect: CONDITION_DEFINITIONS[condition].summary },
    }
  },

  remove_condition(state, args) {
    const member = heroOf(state, args)
    const condition = choice<ConditionId>(args, 'condition', CONDITIONS, true)!
    const current = member.character.conditions
    if (!current.some((c) => c.id === condition)) reject(`На ${member.character.name} нет состояния «${CONDITION_DEFINITIONS[condition].name}».`)
    return {
      events: [
        { event: { type: 'conditionsChanged', heroId: member.heroId, conditions: current.filter((c) => c.id !== condition) }, author: MASTER },
      ],
      result: { message: `С ${member.character.name} снято: ${CONDITION_DEFINITIONS[condition].name}.` },
    }
  },

  note_fact(state, args, ctx) {
    const factText = text(args, 'text', true)!
    if (state.world.facts.some((f) => norm(f.text) === norm(factText))) reject('Этот факт уже записан.')
    return {
      events: [{ event: { type: 'factRecorded', fact: { id: `fact-${ctx.newId()}`, text: factText, at: ctx.now() } }, author: MASTER }],
      result: { message: 'Факт записан в журнал.' },
    }
  },

  add_object(state, args, ctx) {
    const location = currentLocationOf(state)
    const name = text(args, 'name', true)!
    const type = choice<MapObjectType>(args, 'type', OBJECT_TYPES, true)!
    const x = integer(args, 'x', true)!
    const y = integer(args, 'y', true)!
    const w = integer(args, 'w') ?? 1
    const h = integer(args, 'h') ?? 1
    const description = text(args, 'description')
    const problem = placementProblem(location, heroesOnMap(state), { x, y, w, h })
    if (problem) reject(problem)
    const object: MapObject = {
      id: slugId('obj', location.objects, ctx.newId),
      type,
      name,
      x,
      y,
      ...(w > 1 ? { w } : {}),
      ...(h > 1 ? { h } : {}),
      ...(description ? { description } : {}),
    }
    return {
      events: [{ event: { type: 'objectAdded', locationId: location.id, object }, author: MASTER }],
      result: { id: object.id, message: `На карте: ${name} (${x}, ${y}).` },
    }
  },

  remove_object(state, args) {
    const location = currentLocationOf(state)
    const obj = findByName(location.objects, text(args, 'object', true)!, 'Объекта')
    return {
      events: [{ event: { type: 'objectRemoved', locationId: location.id, objectId: obj.id }, author: MASTER }],
      result: { message: `${obj.name} убран(а) с карты.` },
    }
  },

  update_object(state, args) {
    const location = currentLocationOf(state)
    const obj = findByName(location.objects, text(args, 'object', true)!, 'Объекта')
    const changes: Partial<Omit<MapObject, 'id'>> = {}
    const name = text(args, 'name')
    const description = text(args, 'description')
    const type = choice<MapObjectType>(args, 'type', OBJECT_TYPES)
    if (name) changes.name = name
    if (description) changes.description = description
    if (type) changes.type = type
    for (const key of ['x', 'y', 'w', 'h'] as const) {
      const v = integer(args, key)
      if (v !== undefined) changes[key] = v
    }
    if (Object.keys(changes).length === 0) reject('Не указано, что изменить.')
    const next = { ...obj, ...changes }
    const problem = placementProblem(location, heroesOnMap(state), next, { objectId: obj.id })
    if (problem) reject(problem)
    return {
      events: [{ event: { type: 'objectUpdated', locationId: location.id, objectId: obj.id, changes }, author: MASTER }],
      result: { message: `Объект изменён: ${next.name}${next.description ? ` — ${next.description}` : ''}.` },
    }
  },

  set_door(state, args) {
    const location = currentLocationOf(state)
    const door = findByName(location.doors, text(args, 'door', true)!, 'Двери')
    const doorState = choice<DoorState>(args, 'state', DOOR_STATES, true)!
    return {
      events: [{ event: { type: 'doorChanged', locationId: location.id, doorId: door.id, state: doorState }, author: MASTER }],
      result: { message: `${door.name}: ${doorState === 'open' ? 'открыта' : doorState === 'closed' ? 'закрыта' : 'заперта'}.` },
    }
  },
}

/**
 * Исполнить вызов инструмента: проверить аргументы и состояние, получить действия и прогнать их через checkAction
 * на копии истории. Отказ — `ok: false` и причина для модели; история при этом не меняется.
 */
export function executeTool(state: StoryState, call: AiToolCall, ctx: ToolContext): ToolOutcome {
  const fail = (error: string): ToolOutcome => ({ ok: false, result: { ok: false, error }, events: [] })
  const handler = HANDLERS[call.name]
  if (!handler) return fail(`Инструмента «${call.name}» нет. Есть: ${Object.keys(HANDLERS).join(', ')}.`)
  if (call.argumentsError || !call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments))
    return fail('Аргументы — некорректный JSON-объект.')
  if (state.status === 'completed') return fail('История завершена — в ней больше ничего не происходит.')
  try {
    const { events, result } = handler(state, call.arguments as Args, ctx)
    // Последняя линия обороны — те же правила, что для любых действий истории.
    let probe = state
    for (const [i, { event, author }] of events.entries()) {
      const action = makeAction(state.id, i, event, author, ctx.now(), `probe-${i}`)
      const reason = checkAction(probe, action, { catalog: ctx.catalog })
      if (reason) return fail(reason)
      probe = applyAction(probe, action)
    }
    return { ok: true, result: { ok: true, ...result }, events }
  } catch (error) {
    if (error instanceof ToolRejected) return fail(error.message)
    throw error
  }
}
