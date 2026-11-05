import { describe, expect, it } from 'vitest'
import type { AiToolCall } from '../ai/types'
import { itemCatalog } from '../data'
import adventureJson from '../data/adventures/drunken-griffin.json'
import fighterJson from '../data/characters/fighter-ratibor.json'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import type { StoryState } from '../types/story'
import { parseAdventure } from './adventure'
import { parseCharacterSheet } from './character'
import { parseLocation } from './location'
import { executeTool, MASTER_TOOLS, type ToolContext } from './masterTools'
import { applyAction, makeAction, newStorySeed } from './storyActions'

const location = parseLocation(drunkenGriffinJson)
const locations = { [location.id]: location }
const adventure = parseAdventure(adventureJson, locations)
const ratibor = parseCharacterSheet(fighterJson, itemCatalog)
const LOC = location.id

/** Бросок d20: значение → число для генератора. */
const face = (value: number, sides = 20) => (value - 0.5) / sides

function context(rolls: number[] = []): ToolContext {
  let n = 0
  return { catalog: itemCatalog, rng: () => rolls.shift() ?? 0.5, now: () => 1000, newId: () => `id${++n}` }
}

const fresh = (): StoryState => newStorySeed({ id: 's1', title: 'Тест', tone: 'detective', adventure, locations, party: [ratibor], now: 1 })
const call = (name: string, args: unknown): AiToolCall => ({ id: `c-${name}`, name, arguments: args, rawArguments: JSON.stringify(args) })

/** Выполнить вызов и применить его действия (как это делает ход ведущего). */
function run(state: StoryState, name: string, args: unknown, ctx = context()) {
  const outcome = executeTool(state, call(name, args), ctx)
  let next = state
  outcome.events.forEach(({ event, author }, i) => (next = applyAction(next, makeAction(state.id, i + 1, event, author, 1, `a${i}`))))
  return { outcome, state: next }
}

/** Вызов должен быть отклонён с причиной; состояние не меняется. */
function rejected(state: StoryState, name: string, args: unknown, ctx = context()): string {
  const outcome = executeTool(state, call(name, args), ctx)
  expect(outcome.ok).toBe(false)
  expect(outcome.events).toEqual([])
  return outcome.result.error as string
}

describe('описания инструментов', () => {
  it('все инструменты из задания, у каждого — JSON Schema объекта', () => {
    expect(MASTER_TOOLS.map((t) => t.name)).toEqual([
      'request_check',
      'give_item',
      'remove_item',
      'change_gold',
      'change_hp',
      'move_npc',
      'add_npc',
      'remove_npc',
      'add_condition',
      'remove_condition',
      'note_fact',
      'add_object',
      'remove_object',
      'update_object',
      'set_door',
    ])
    for (const t of MASTER_TOOLS) expect(t.parameters).toMatchObject({ type: 'object', additionalProperties: false })
  })
})

describe('недопустимые вызовы отклоняются, ничего не меняя', () => {
  const s = fresh()

  it('нельзя отнять предмет, которого нет, или больше, чем есть', () => {
    expect(rejected(s, 'remove_item', { item: 'dagger' })).toBe('У героя нет предмета «Кинжал».')
    expect(rejected(s, 'remove_item', { item: 'Метательное копьё', quantity: 9 })).toBe(
      'У героя только 8 шт. «Метательное копьё», а забрать нужно 9.',
    )
    expect(rejected(s, 'remove_item', { item: 'Меч-кладенец' })).toContain('нет в справочнике')
  })

  it('нельзя дать несуществующий предмет или ноль штук; похожие подсказываются', () => {
    expect(rejected(s, 'give_item', { item: 'Экскалибур' })).toBe('Предмета «Экскалибур» нет в справочнике.')
    expect(rejected(s, 'give_item', { item: 'меч' })).toMatch(/Похожие: .*Двуручный меч/)
    expect(rejected(s, 'give_item', { item: 'dagger', quantity: 0 })).toBe('Нельзя выдать «dagger» × 0.')
  })

  it('золото не уходит в минус; изменение — ненулевое число', () => {
    expect(rejected(s, 'change_gold', { amount: -100 })).toBe('У героя только 18 зм — нельзя забрать 100.')
    expect(rejected(s, 'change_gold', { amount: 0 })).toBe('«amount» — ненулевое число.')
    expect(rejected(s, 'change_gold', { amount: 'десять' })).toBe('«amount» — ненулевое число.')
  })

  it('урон и лечение: целое ≥ 1, вид и тип из списка, герой из отряда', () => {
    expect(rejected(s, 'change_hp', { kind: 'damage', amount: 0 })).toBe('«amount» — не меньше 1.')
    expect(rejected(s, 'change_hp', { kind: 'damage', amount: 2.5 })).toBe('«amount» — целое число.')
    expect(rejected(s, 'change_hp', { kind: 'wound', amount: 3 })).toContain('«kind»: «wound» — не из списка')
    expect(rejected(s, 'change_hp', { kind: 'damage', amount: 3, damage_type: 'holy' })).toContain('«damage_type»')
    expect(rejected(s, 'change_hp', { hero: 'Гэндальф', kind: 'healing', amount: 3 })).toBe('Героя «Гэндальф» нет в отряде. В отряде: Ратибор.')
  })

  it('НПС: неизвестный, за картой, в занятую клетку (объект, НПС, герой), не на пол', () => {
    expect(rejected(s, 'move_npc', { npc: 'Саурон', x: 5, y: 5 })).toMatch(/^НПС «Саурон» здесь нет\. Есть: Гуннар \(gunnar\)/)
    expect(rejected(s, 'move_npc', { npc: 'Гуннар', x: 25, y: 3 })).toBe('Клетка (25, 3) за пределами карты 20×14.')
    expect(rejected(s, 'move_npc', { npc: 'Гуннар', x: 3, y: 2 })).toBe('Клетка (3, 2) занята: объект «Барная стойка».')
    expect(rejected(s, 'move_npc', { npc: 'Гуннар', x: 2, y: 8 })).toBe('Клетка (2, 8) занята: НПС «Брам».')
    expect(rejected(s, 'move_npc', { npc: 'Гуннар', x: 10, y: 13 })).toBe('Клетка (10, 13) занята: герой Ратибор.')
    const holey = structuredClone(s)
    holey.world.locations[LOC].floorPlan[6] = '.......... .........'
    expect(rejected(holey, 'move_npc', { npc: 'Гуннар', x: 10, y: 6 })).toBe('Клетка (10, 6) — не пол.')
    expect(rejected(s, 'add_npc', { name: 'Стражник', x: 1, y: 7 })).toBe('Клетка (1, 7) занята: НПС «Лиара».')
    expect(rejected(s, 'add_npc', { name: 'Стражник', x: 5, y: 5, attitude: 'angry' })).toContain('«attitude»')
    expect(rejected(s, 'remove_npc', { npc: 'Саурон' })).toContain('НПС «Саурон» здесь нет')
  })

  it('состояния: неизвестное, уже наложено, уровень не у Истощения, снять то, чего нет', () => {
    expect(rejected(s, 'add_condition', { condition: 'cursed' })).toContain('«condition»: «cursed» — не из списка')
    expect(rejected(s, 'add_condition', { condition: 'poisoned', level: 2 })).toBe('Уровень бывает только у Истощения.')
    expect(rejected(s, 'remove_condition', { condition: 'poisoned' })).toBe('На Ратибор нет состояния «Отравлен».')
    const poisoned = run(s, 'add_condition', { condition: 'poisoned' }).state
    expect(rejected(poisoned, 'add_condition', { condition: 'poisoned' })).toBe('Ратибор уже: Отравлен.')
  })

  it('объекты: за картой, поверх объекта, поперёк стены, неизвестный вид, неизвестный объект, двусмысленное имя', () => {
    expect(rejected(s, 'add_object', { name: 'Люстра', type: 'item', x: 19, y: 13, w: 2 })).toBe(
      'Клетка (19, 13) с размером 2×1 за пределами карты 20×14.',
    )
    expect(rejected(s, 'add_object', { name: 'Люстра', type: 'item', x: 9, y: 7 })).toBe('Клетка (9, 7) занята: объект «Центральный стол».')
    expect(rejected(s, 'add_object', { name: 'Шкаф', type: 'item', x: 14, y: 3, w: 2 })).toBe(
      'Область пересекает стену между клетками (14, 3) и (15, 3).',
    )
    expect(rejected(s, 'add_object', { name: 'Лава', type: 'lava', x: 6, y: 6 })).toContain('«type»: «lava» — не из списка')
    expect(rejected(s, 'remove_object', { object: 'Трон' })).toContain('Объекта «Трон» здесь нет')
    expect(rejected(s, 'update_object', { object: 'Бочка эля', name: 'Пустая бочка' })).toBe(
      'Объекта с именем «Бочка эля» несколько — укажи id: barrel-1, barrel-2.',
    )
    expect(rejected(s, 'update_object', { object: 'table-2' })).toBe('Не указано, что изменить.')
    expect(rejected(s, 'update_object', { object: 'table-2', x: 2, y: 8 })).toBe('Клетка (2, 8) занята: НПС «Брам».')
    expect(rejected(s, 'update_object', { object: 'table-2', x: 8, y: 7 })).toBe('Клетка (8, 7) занята: объект «Стул».')
    expect(rejected(s, 'set_door', { door: 'Ворота', state: 'open' })).toContain('Двери «Ворота» здесь нет')
    expect(rejected(s, 'set_door', { door: 'entrance', state: 'broken' })).toContain('«state»')
  })

  it('проверки: ровно одно из skill/ability, Сл 1–30, спасбросок — с характеристикой, причина обязательна', () => {
    expect(rejected(s, 'request_check', { dc: 15, reason: 'x' })).toBe('Укажи ровно одно: skill или ability.')
    expect(rejected(s, 'request_check', { skill: 'stealth', ability: 'dex', dc: 15, reason: 'x' })).toBe('Укажи ровно одно: skill или ability.')
    expect(rejected(s, 'request_check', { skill: 'stealth', dc: 31, reason: 'x' })).toBe('Сл должна быть целым числом от 1 до 30, а не 31')
    expect(rejected(s, 'request_check', { skill: 'stealth', dc: 15 })).toBe('Нужен параметр «reason».')
    expect(rejected(s, 'request_check', { skill: 'stealth', saving_throw: true, dc: 15, reason: 'x' })).toBe('Спасбросок — с ability, а не со skill.')
    expect(rejected(s, 'request_check', { skill: 'hacking', dc: 15, reason: 'x' })).toContain('«skill»: «hacking» — не из списка')
  })

  it('факты: пустой и повторный', () => {
    expect(rejected(s, 'note_fact', { text: '  ' })).toBe('«text» — непустая строка.')
    expect(rejected(s, 'note_fact', {})).toBe('Нужен параметр «text».')
    const noted = run(s, 'note_fact', { text: 'Тобиас — вор.' }).state
    const again = run(noted, 'note_fact', { text: 'тобиас — вор.' })
    expect(again.outcome).toMatchObject({ ok: true, result: { ok: true, message: 'Этот факт уже записан.' }, events: [] })
  })

  it('факты: слишком длинный — просьба сократить; повтор — обновление старой записи, а не новая', () => {
    const long = Array.from({ length: 35 }, (_, i) => `слово${i}`).join(' ')
    expect(rejected(s, 'note_fact', { text: long })).toMatch(/^Факт слишком длинный \(35 слов\)\. Сократи до ~20 слов в стиле заметки мастера/)
    expect(rejected(s, 'note_fact', { text: 'Тобиас — вор\nБрам — охранник' })).toBe('Факт — одна строка. Запиши каждый факт отдельным вызовом.')

    const ctx = context()
    const first = run(s, 'note_fact', { text: 'Тобиас — должен гильдии 30 зм' }, ctx).state
    const other = run(first, 'note_fact', { text: 'Лиара — ищет брата в Северной башне' }, ctx).state
    expect(other.world.facts).toHaveLength(2)
    const updated = run(other, 'note_fact', { text: 'Тобиас — должен гильдии 10 зм' }, ctx)
    expect(updated.outcome.events.map((e) => e.event.type)).toEqual(['factUpdated'])
    expect(updated.outcome.result.message).toBe('Факт обновлён (было: «Тобиас — должен гильдии 30 зм»).')
    expect(updated.state.world.facts.map((f) => f.text)).toEqual(['Тобиас — должен гильдии 10 зм', 'Лиара — ищет брата в Северной башне'])
  })

  it('неизвестный инструмент, битые аргументы, завершённая история, погибший герой', () => {
    expect(rejected(s, 'summon_dragon', {})).toMatch(/^Инструмента «summon_dragon» нет\. Есть: request_check/)
    const broken = executeTool(s, { id: 'x', name: 'give_item', arguments: null, rawArguments: '{item:', argumentsError: 'bad' }, context())
    expect(broken).toEqual({ ok: false, result: { ok: false, error: 'Аргументы — некорректный JSON-объект.' }, events: [] })
    expect(rejected({ ...s, status: 'completed' }, 'note_fact', { text: 'x' })).toBe('История завершена — в ней больше ничего не происходит.')
    const dead = run(s, 'change_hp', { kind: 'damage', amount: 99 }).state
    expect(rejected(dead, 'change_hp', { hero: 'Ратибор', kind: 'healing', amount: 5 })).toBe('Ратибор погиб.')
  })
})

describe('допустимые вызовы меняют игру через действия', () => {
  it('request_check: бросает движок, карточка в ленте, состояния героя учитываются', () => {
    const { outcome, state } = run(fresh(), 'request_check', { skill: 'athletics', dc: 15, reason: 'выбить дверь' }, context([face(12)]))
    expect(outcome.ok).toBe(true)
    expect(outcome.result).toMatchObject({ check: 'Сила (Атлетика)', natural: 12, modifier: 5, total: 17, success: true, dc: 15 })
    expect(outcome.events[0].author).toEqual({ kind: 'engine' })
    const card = state.messages.at(-1)!
    expect(card).toMatchObject({ author: 'system', check: { heroName: 'Ратибор', reason: 'выбить дверь' } })
    expect(card.text).toContain('Сила (Атлетика), Сл 15')
    expect(state.rolls.at(-1)).toMatchObject({ label: 'Сила (Атлетика)' })

    const poisoned = run(fresh(), 'add_condition', { condition: 'poisoned' }).state
    const check = run(poisoned, 'request_check', { ability: 'dex', dc: 10, reason: 'увернуться' }, context([face(18), face(3)]))
    expect(check.outcome.result).toMatchObject({ mode: 'disadvantage', natural: 3, success: false })
    const save = run(fresh(), 'request_check', { ability: 'con', saving_throw: true, dc: 12, reason: 'яд' }, context([face(8)]))
    expect(save.outcome.result).toMatchObject({ check: 'Спасбросок Телосложения', total: 12, success: true })
  })

  it('предметы и золото: последний экипированный предмет снимается с руки', () => {
    let s = run(fresh(), 'give_item', { item: 'Кинжал', quantity: 2 }).state
    expect(s.party[0].inventory.items.find((e) => e.itemId === 'dagger')?.quantity).toBe(2)
    s = run(s, 'remove_item', { item: 'greatsword' }).state
    expect(s.party[0].inventory.items.some((e) => e.itemId === 'greatsword')).toBe(false)
    expect(s.party[0].inventory.equipped.mainHand).toBeNull()
    const paid = run(s, 'change_gold', { amount: -2.5 })
    expect(paid.outcome.result.gold).toBe(15.5)
    expect(paid.state.party[0].inventory.gold).toBe(15.5)
  })

  it('урон до 0 — без сознания; массивный урон — гибель (движок); лечение — в сознании', () => {
    const down = run(fresh(), 'change_hp', { kind: 'damage', amount: 15, damage_type: 'bludgeoning' })
    expect(down.outcome.result).toMatchObject({ hp: 0, unconscious: true, died: false })
    expect(down.state.party[0].character.conditions).toEqual([{ id: 'unconscious' }])
    const up = run(down.state, 'change_hp', { kind: 'healing', amount: 30 })
    expect(up.state.party[0].character).toMatchObject({ hp: 12, conditions: [] })
    const dead = run(fresh(), 'change_hp', { kind: 'damage', amount: 24 })
    expect(dead.outcome.result).toMatchObject({ died: true })
    expect(dead.outcome.events.map((e) => [e.event.type, e.author.kind])).toEqual([
      ['hpChanged', 'master'],
      ['heroDied', 'engine'],
    ])
    expect(dead.state.party[0].fallen).toBe(true)
  })

  it('карта: НПС и объекты добавляются, двигаются, меняются и убираются; дверь выломана', () => {
    let s = run(fresh(), 'add_npc', { name: 'Стражник', x: 6, y: 6, attitude: 'neutral' }).state
    const guard = s.world.locations[LOC].npcs.find((n) => n.name === 'Стражник')!
    expect(guard).toMatchObject({ x: 6, y: 6, attitude: 'neutral' })
    s = run(s, 'move_npc', { npc: 'Стражник', x: 7, y: 6 }).state
    // На стул можно сесть.
    expect(run(s, 'move_npc', { npc: 'Гуннар', x: 8, y: 7 }).outcome.ok).toBe(true)
    s = run(s, 'remove_npc', { npc: 'Тобиас' }).state
    expect(s.world.locations[LOC].npcs.map((n) => n.name)).toEqual(['Гуннар', 'Брам', 'Лиара', 'Стражник'])
    s = run(s, 'add_object', { name: 'Упавшая люстра', type: 'debris', x: 6, y: 9, w: 2, description: 'Кованая люстра, свечи раскатились.' }).state
    expect(s.world.locations[LOC].objects.at(-1)).toMatchObject({ name: 'Упавшая люстра', type: 'debris', x: 6, y: 9, w: 2 })
    s = run(s, 'update_object', { object: 'table-2', name: 'Опрокинутый стол', description: 'Лежит на боку — укрытие.' }).state
    expect(s.world.locations[LOC].objects.find((o) => o.id === 'table-2')).toMatchObject({ name: 'Опрокинутый стол', x: 9, y: 7 })
    s = run(s, 'add_object', { name: 'Огонь', type: 'fire', x: 4, y: 5 }).state
    s = run(s, 'remove_object', { object: 'Огонь' }).state
    expect(s.world.locations[LOC].objects.some((o) => o.name === 'Огонь')).toBe(false)
    s = run(s, 'set_door', { door: 'Входная дверь', state: 'open' }).state
    expect(s.world.doors[LOC].entrance).toBe('open')
    s = run(s, 'note_fact', { text: 'Люстра рухнула посреди зала.' }).state
    expect(s.world.facts.at(-1)?.text).toBe('Люстра рухнула посреди зала.')
  })
})
