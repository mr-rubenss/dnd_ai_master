import { describe, expect, it } from 'vitest'
import type { AiToolCall } from '../ai/types'
import { itemCatalog, priceList, rulesData } from '../data'
import adventureJson from '../data/adventures/drunken-griffin.json'
import fighterJson from '../data/characters/fighter-ratibor.json'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import type { StoryEvent, StoryState } from '../types/story'
import { parseAdventure } from './adventure'
import { parseCharacterSheet } from './character'
import { parseLocation } from './location'
import { executeTool, MASTER_TOOLS, type ToolContext } from './masterTools'
import { applyAction, checkAction, makeAction, MASTER, newStorySeed, storyTime } from './storyActions'
import { gameStateText } from './masterState'
import { gameTime } from '../engine/time'

const location = parseLocation(drunkenGriffinJson)
const locations = { [location.id]: location }
const adventure = parseAdventure(adventureJson, locations)
const ratibor = parseCharacterSheet(fighterJson, itemCatalog)
const LOC = location.id

/** Бросок d20: значение → число для генератора. */
const face = (value: number, sides = 20) => (value - 0.5) / sides

function context(rolls: number[] = []): ToolContext {
  let n = 0
  return { catalog: itemCatalog, rules: rulesData, prices: priceList, rng: () => rolls.shift() ?? 0.5, now: () => 1000, newId: () => `id${++n}` }
}

const fresh = (): StoryState => newStorySeed({ id: 's1', title: 'Тест', tone: 'detective', adventure, locations, party: [ratibor], now: 1 })
/** Урон ровно n (кубик d2 при генераторе 0,5 даёт 2): урон задаётся только кубиками. */
const hit = (n: number, extra: Record<string, unknown> = {}) => ({ kind: 'damage', dice: `1d2+${n - 2}`, ...extra })
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
      'use_item',
      'cast_spell',
      'rest',
      'advance_time',
      'interrupt_rest',
      'use_feature',
      'change_hp',
      'move_npc',
      'add_npc',
      'update_npc',
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
    expect(rejected(s, 'give_item', { item: 'Экскалибур', source: 'npc', from: 'gunnar' })).toBe('Предмета «Экскалибур» нет в справочнике.')
    expect(rejected(s, 'give_item', { item: 'меч', source: 'npc', from: 'gunnar' })).toMatch(/Похожие: .*Двуручный меч/)
    expect(rejected(s, 'give_item', { item: 'dagger', quantity: 0, source: 'npc', from: 'gunnar' })).toBe('«quantity» — не меньше 1.')
  })

  it('деньги: нехватка — отказ с причиной (сделки нет); сумма — ненулевое целое число монет; цена — из прейскуранта', () => {
    expect(rejected(s, 'change_gold', { amount: -100, reason: 'меч' })).toBe('Денег не хватает: у Ратибор 18 зм, а нужно 100 зм. Сделки нет — обыграй это в рассказе.')
    expect(rejected(s, 'change_gold', { amount: 0, currency: 'cp', reason: 'x' })).toBe('«amount» — ненулевое число.')
    expect(rejected(s, 'change_gold', { amount: 'десять', reason: 'x' })).toBe('«amount» — число.')
    expect(rejected(s, 'change_gold', { amount: -0.5, currency: 'cp', reason: 'x' })).toBe('-0.5 мм — не целое число медных монет. 1 зм = 10 см = 100 мм.')
    expect(rejected(s, 'change_gold', { reason: 'эль' })).toBe('Нужен «amount» (с currency) или «price» из прейскуранта.')
    expect(rejected(s, 'change_gold', { price: 'dragon-ride', reason: 'полёт' })).toMatch(/^В прейскуранте нет «dragon-ride»\. Есть: ale-mug,/)
    expect(rejected(s, 'change_gold', { price: 'inn-aristocratic', quantity: 5, reason: 'покои' })).toBe('Денег не хватает: у Ратибор 18 зм, а нужно 20 зм. Сделки нет — обыграй это в рассказе.')
  })

  it('use_item: нет предмета, не хватает, предмет не расходуется', () => {
    expect(rejected(s, 'use_item', { item: 'potion-of-healing' })).toBe('У героя нет предмета «Зелье лечения».')
    expect(rejected(s, 'use_item', { item: 'arrow', quantity: 25 })).toBe('У героя только 20 шт. «Стрела», а забрать нужно 25.')
    expect(rejected(s, 'use_item', { item: 'greatsword' })).toMatch(/^«Двуручный меч» не расходуется при применении/)
    expect(rejected(s, 'use_item', { item: 'healers-kit', quantity: 11 })).toBe('У «Набор целителя» осталось применений: 10, а нужно 11.')
  })

  it('урон и лечение: целое ≥ 1, вид и тип из списка, герой из отряда', () => {
    expect(rejected(s, 'change_hp', { kind: 'healing', amount: 0 })).toBe('«amount» — не меньше 1.')
    expect(rejected(s, 'change_hp', { kind: 'healing', amount: 2.5 })).toBe('«amount» — целое число.')
    expect(rejected(s, 'change_hp', { kind: 'wound', amount: 3 })).toContain('«kind»: «wound» — не из списка')
    expect(rejected(s, 'change_hp', { kind: 'damage', dice: '1d6', damage_type: 'holy' })).toContain('«damage_type»')
    expect(rejected(s, 'change_hp', { kind: 'damage', dice: 'много' })).toMatch(/^«dice»: /)
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
    const dead = run(s, 'change_hp', hit(99)).state
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
    let s = run(fresh(), 'give_item', { item: 'Кинжал', quantity: 2, source: 'npc', from: 'Гуннар' }).state
    expect(s.party[0].inventory.items.find((e) => e.itemId === 'dagger')?.quantity).toBe(2)
    s = run(s, 'remove_item', { item: 'greatsword' }).state
    expect(s.party[0].inventory.items.some((e) => e.itemId === 'greatsword')).toBe(false)
    expect(s.party[0].inventory.equipped.mainHand).toBeNull()
    const paid = run(s, 'change_gold', { amount: -2.5, reason: 'еда' })
    expect(paid.outcome.result.purse).toBe('15 зм 5 см')
    expect(paid.state.party[0].inventory.coins).toEqual({ gp: 15, sp: 5, cp: 0 })
  })

  it('change_gold: эль за 4 мм со сдачей с золотого; цена из прейскуранта; сумма строкой тоже принимается', () => {
    const ale = run(fresh(), 'change_gold', { amount: -4, currency: 'cp', reason: 'эль' })
    expect(ale.state.party[0].inventory.coins).toEqual({ gp: 17, sp: 9, cp: 6 })
    expect(ale.outcome.result.message).toBe('Ратибор: заплатил 4 мм (со сдачей). В кошельке: 17 зм 9 см 6 мм.')
    const room = run(ale.state, 'change_gold', { price: 'inn-modest', reason: 'комната' })
    expect(room.state.party[0].inventory.coins).toEqual({ gp: 17, sp: 4, cp: 6 })
    const twoAles = run(fresh(), 'change_gold', { price: 'ale-mug', quantity: 2, reason: 'эль' })
    expect(twoAles.state.party[0].inventory.coins).toEqual({ gp: 17, sp: 9, cp: 2 })
    const stringy = run(fresh(), 'change_gold', { amount: '−4', currency: 'cp', reason: 'эль' })
    expect(stringy.state.party[0].inventory.coins).toEqual({ gp: 17, sp: 9, cp: 6 })
    const reward = run(fresh(), 'change_gold', { amount: 3, currency: 'sp', reason: 'награда', source: 'npc', from: 'gunnar' })
    expect(reward.state.party[0].inventory.coins).toEqual({ gp: 18, sp: 3, cp: 0 })
  })

  it('use_item: стрела списывается, набор целителя — заряд, зелье — бросок лечения движком', () => {
    const shot = run(fresh(), 'use_item', { item: 'Стрела', reason: 'выстрел' })
    expect(shot.state.party[0].inventory.items.find((e) => e.itemId === 'arrow')?.quantity).toBe(19)
    expect(shot.outcome.result.left).toBe(19)
    const kit = run(fresh(), 'use_item', { item: 'healers-kit', quantity: 3 })
    expect(kit.state.party[0].inventory.items.find((e) => e.itemId === 'healers-kit')).toEqual({ itemId: 'healers-kit', quantity: 1, charges: 7 })
    expect(kit.outcome.result.left).toBe(7)
    const empty = run(kit.state, 'use_item', { item: 'healers-kit', quantity: 7 })
    expect(empty.state.party[0].inventory.items.some((e) => e.itemId === 'healers-kit')).toBe(false)

    // Раненый герой с зельем: 2к4+2, на кубиках 3 и 4 → 9 хитов.
    let wounded = run(fresh(), 'change_hp', hit(10)).state
    wounded = run(wounded, 'give_item', { item: 'potion-of-healing', source: 'npc', from: 'Лиара' }).state
    const drink = run(wounded, 'use_item', { item: 'Зелье лечения' }, context([(3 - 0.5) / 4, (4 - 0.5) / 4]))
    expect(drink.outcome.result.healing).toEqual({ rolls: ['2d4+2 = 9'], total: 9, hp: 11, max_hp: 12 })
    expect(drink.outcome.events.map((e) => e.event.type)).toEqual(['itemsRemoved', 'diceRolled', 'hpChanged'])
    expect(drink.state.party[0].character.hp).toBe(11)
    expect(drink.state.party[0].inventory.items.some((e) => e.itemId === 'potion-of-healing')).toBe(false)
  })

  it('урон до 0 — без сознания; массивный урон — гибель (движок); лечение — в сознании', () => {
    const down = run(fresh(), 'change_hp', hit(15, { damage_type: 'bludgeoning' }))
    expect(down.outcome.result).toMatchObject({ hp: 0, unconscious: true, died: false })
    expect(down.state.party[0].character.conditions).toEqual([{ id: 'unconscious' }])
    const up = run(down.state, 'change_hp', { kind: 'healing', amount: 30 })
    expect(up.state.party[0].character).toMatchObject({ hp: 12, conditions: [] })
    const dead = run(fresh(), 'change_hp', hit(24))
    expect(dead.outcome.result).toMatchObject({ died: true })
    expect(dead.outcome.events.map((e) => [e.event.type, e.author.kind])).toEqual([
      ['diceRolled', 'engine'],
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

describe('cast_spell: заклинания героя', () => {
  /** Ратибор — волшебник с выбранными заклинаниями (Инт 16: Сл 13, атака +5). */
  const mage = (): StoryState => {
    const s = fresh()
    const m = s.party[0]
    m.character = {
      ...m.character,
      classId: 'wizard',
      className: 'Волшебник',
      abilities: { ...m.character.abilities, int: 16 },
      hp: 5,
      maxHp: 8,
      magic: {
        cantrips: ['fire-bolt', 'light', 'mage-hand'],
        spellbook: ['magic-missile', 'shield', 'sleep', 'detect-magic', 'mage-armor', 'identify'],
        prepared: ['magic-missile', 'shield', 'sleep', 'mage-armor'],
        slotsUsed: {},
      },
    }
    return s
  }

  it('заговор — без ячейки, движок бросает атаку и урон', () => {
    const { outcome, state } = run(mage(), 'cast_spell', { spell: 'Огненный снаряд', target: 'Гуннар' }, context([face(15), face(7, 10)]))
    expect(outcome.ok).toBe(true)
    expect(outcome.result).toMatchObject({ spent: 'заговор (без ячейки)', attack: { total: 20, natural: 15 }, damage: { total: 7, type: 'fire' }, slots_left: '1-й круг: 2/2' })
    expect(state.party[0].character.magic?.slotsUsed).toEqual({})
  })

  it('заклинание 1-го круга тратит ячейку; без ячеек — отказ', () => {
    let s = mage()
    for (let i = 0; i < 2; i++) {
      const r = run(s, 'cast_spell', { spell: 'magic-missile' })
      expect(r.outcome.ok).toBe(true)
      s = r.state
    }
    expect(s.party[0].character.magic?.slotsUsed).toEqual({ 1: 2 })
    expect(rejected(s, 'cast_spell', { spell: 'sleep' })).toMatch(/нет свободных ячеек/)
    // Ритуал — без ячейки, прямо из книги.
    expect(run(s, 'cast_spell', { spell: 'identify', ritual: true }).outcome.result).toMatchObject({ spent: 'ритуал (без ячейки, +10 минут)' })
  })

  it('отказ на неизвестное заклинание и у героя без магии', () => {
    expect(rejected(mage(), 'cast_spell', { spell: 'Лечение ран' })).toMatch(/не знает заклинания «Лечение ран»/)
    expect(rejected(mage(), 'cast_spell', { spell: 'Огненный шар' })).toMatch(/нет в справочнике/)
    expect(rejected(fresh(), 'cast_spell', { spell: 'fire-bolt' })).toMatch(/не знает/)
    expect(rejected(mage(), 'cast_spell', { spell: 'magic-missile', slot_level: 2 })).toMatch(/нет ячеек 2-го круга/)
  })

  it('лечение на себя: бросок движка + модификатор, хиты растут', () => {
    const s = mage()
    s.party[0].character = { ...s.party[0].character, classId: 'cleric', className: 'Жрец', abilities: { ...s.party[0].character.abilities, wis: 16 }, magic: { cantrips: ['guidance', 'light', 'thaumaturgy'], prepared: ['cure-wounds', 'bless', 'command', 'sanctuary'], slotsUsed: {} } }
    const { outcome, state } = run(s, 'cast_spell', { spell: 'cure-wounds' }, context([face(1, 8), face(1, 8)]))
    expect(outcome.result).toMatchObject({ healing: 5, hp: '8/8' })
    expect(state.party[0].character.hp).toBe(8)
  })
})

describe('advance_time — игровое время', () => {
  it('история начинается со времени приключения (таверна — День 1, 19:00)', () => {
    expect(storyTime(fresh())).toBe(gameTime(1, 19))
  })

  it('сдвиг на минуты и «до утра»; время не идёт назад', () => {
    const { outcome, state } = run(fresh(), 'advance_time', { minutes: 60, reason: 'час разговора с трактирщиком' })
    expect(outcome.result.message).toBe('Прошло 1 ч: сейчас День 1, 20:00 (вечер). Учитывай время суток в рассказе.')
    expect(storyTime(state)).toBe(gameTime(1, 20))
    const night = run(state, 'advance_time', { until: 'morning', reason: 'проспали до утра' }).state
    expect(storyTime(night)).toBe(gameTime(2, 6))
    expect(storyTime(run(night, 'advance_time', { until_hour: 9, reason: 'ждали открытия лавки' }).state)).toBe(gameTime(2, 9))
    expect(rejected(fresh(), 'advance_time', { minutes: 0, reason: 'x' })).toMatch(/не идёт назад/)
    expect(rejected(fresh(), 'advance_time', { minutes: -30, reason: 'x' })).toMatch(/не идёт назад/)
    expect(rejected(fresh(), 'advance_time', { minutes: 10, until: 'night', reason: 'x' })).toBe('Укажи ровно одно: minutes, until или until_hour.')
    expect(rejected(fresh(), 'advance_time', { reason: 'x' })).toBe('Укажи ровно одно: minutes, until или until_hour.')
    expect(rejected(fresh(), 'advance_time', { minutes: 10 })).toMatch(/reason/)
  })

  it('событие timeAdvanced: только ведущий или движок, только вперёд, с причиной', () => {
    const s = fresh()
    const check = (event: StoryEvent, author = MASTER) => checkAction(s, makeAction(s.id, 1, event, author, 1, 'x'), { catalog: itemCatalog })
    expect(check({ type: 'timeAdvanced', minutes: 30, reason: 'ждём' })).toBeNull()
    expect(check({ type: 'timeAdvanced', minutes: -30, reason: 'назад' })).toMatch(/не идёт назад/)
    expect(check({ type: 'timeAdvanced', minutes: 30, reason: ' ' })).toBe('Нужна причина, почему прошло время.')
    expect(check({ type: 'timeAdvanced', minutes: 30, reason: 'ждём' }, { kind: 'player', heroId: 'ratibor' })).toBe('Время двигает ведущий или движок.')
  })

  it('отдых двигает время: короткий — на час, долгий — на 8 часов и запоминает конец долгого', () => {
    const s = fresh()
    const short = run(s, 'rest', { kind: 'short' }).state
    expect(storyTime(short)).toBe(gameTime(1, 20))
    const long = run(short, 'rest', { kind: 'long' }).state
    expect(storyTime(long)).toBe(gameTime(2, 4))
    expect(long.lastLongRestAt).toBe(gameTime(2, 4))
  })

  it('ведущий видит время и подсказку по времени суток', () => {
    const text = gameStateText(fresh(), { catalog: itemCatalog, rules: rulesData })
    expect(text).toContain('## Время\nСейчас День 1, 19:00 (вечер). Под открытым небом — сумерки (тусклый свет).')
    expect(text).toContain('лавки закрываются, таверны полны')
    const night = run(fresh(), 'advance_time', { until: 'night', reason: 'засиделись' }).state
    expect(gameStateText(night, { catalog: itemCatalog, rules: rulesData })).toContain('лавки закрыты, улицы пусты')
  })
})

describe('скрытые и пассивные проверки', () => {
  it('hidden: движок бросает, но карточки в ленте и броска в журнале бросков нет; ведущий знает результат', () => {
    const s = fresh()
    // к20 → 15: Внимательность Ратибора +3 → 18 против Сл 14.
    const { outcome, state } = run(s, 'request_check', { skill: 'perception', dc: 14, reason: 'вор крадётся следом', hidden: true }, context([face(15)]))
    expect(outcome.ok).toBe(true)
    expect(outcome.result).toMatchObject({ hidden: true, total: 18, success: true })
    expect(outcome.result.message).toBe('Скрытая проверка (игрок не видит): Мудрость (Внимательность), Сл 14: 18 — успех. Опиши, что герой заметил или понял.')
    expect(state.messages).toEqual(s.messages)
    expect(state.rolls).toEqual(s.rolls)
    // Событие в журнале действий всё равно есть — с пометкой hidden.
    expect(outcome.events[0].event).toMatchObject({ type: 'checkRolled', check: { hidden: true } })
  })

  it('hidden: провал — ведущий получает просьбу не озвучивать его', () => {
    const { outcome } = run(fresh(), 'request_check', { skill: 'insight', dc: 20, reason: 'трактирщик лжёт', hidden: true }, context([face(2)]))
    expect(outcome.result.success).toBe(false)
    expect(outcome.result.message).toMatch(/Не озвучивай провал/)
  })

  it('обычная проверка по-прежнему видна игроку', () => {
    const s = fresh()
    const { state } = run(s, 'request_check', { skill: 'perception', dc: 14, reason: 'осмотреться' }, context([face(15)]))
    expect(state.messages.length).toBe(s.messages.length + 1)
    expect(state.messages.at(-1)?.check?.hidden).toBeUndefined()
    expect(state.rolls.length).toBe(s.rolls.length + 1)
  })

  it('passive: без броска — пассивное значение против Сл; спасбросок пассивным не бывает', () => {
    const s = fresh()
    // Пассивная Внимательность Ратибора — 13.
    const hit = run(s, 'request_check', { skill: 'perception', dc: 12, reason: 'засада в проулке', passive: true })
    expect(hit.outcome.events).toEqual([])
    expect(hit.outcome.result).toMatchObject({ passive: 13, success: true, hidden: true })
    expect(hit.state).toEqual(s)
    const miss = run(s, 'request_check', { skill: 'perception', dc: 15, reason: 'засада в проулке', passive: true })
    expect(miss.outcome.result).toMatchObject({ passive: 13, success: false })
    expect(miss.outcome.result.message).toMatch(/не говори об этом игроку/)
    expect(rejected(s, 'request_check', { ability: 'dex', saving_throw: true, dc: 12, reason: 'x', passive: true })).toMatch(/Спасбросок пассивным не бывает/)
    expect(rejected(s, 'request_check', { skill: 'perception', dc: 40, reason: 'x', passive: true })).toMatch(/Сл/)
  })
})

describe('живые НПС: личность', () => {
  const tavern = (state: StoryState) => state.world.locations[state.world.currentLocationId]

  it('add_npc с личностью: поля сохраняются и попадают в выжимку ведущему', () => {
    const { outcome, state } = run(fresh(), 'add_npc', {
      name: 'Ведьма Марта',
      x: 10,
      y: 10,
      attitude: 'neutral',
      description: 'Сгорбленная старуха с корзиной трав.',
      backstory: 'Лечила деревню, пока её не выгнали за неудачные роды. Теперь торгует травами по трактирам.',
      goal: 'Продать корень мандрагоры подороже.',
      fear: 'Охотники на ведьм.',
      speech: 'Скрипучий голос, зовёт всех «милок», отвечает поговорками.',
      activity: 'Раскладывает пучки трав на столе.',
    })
    expect(outcome.ok).toBe(true)
    const npc = tavern(state).npcs.find((n) => n.name === 'Ведьма Марта')!
    expect(npc).toMatchObject({ goal: 'Продать корень мандрагоры подороже.', speech: 'Скрипучий голос, зовёт всех «милок», отвечает поговорками.' })
    const text = gameStateText(state, { catalog: itemCatalog, rules: rulesData })
    expect(text).toContain('- Ведьма Марта (10, 10), отношение: нейтральное: Сгорбленная старуха с корзиной трав.\n  сейчас: Раскладывает пучки трав на столе. | цель: Продать корень мандрагоры подороже. | страх/слабость: Охотники на ведьм. | речь: Скрипучий голос')
    expect(text).toContain('не выдавай сразу, раскрывай по крупицам')
  })

  it('слишком длинная личность отклоняется с просьбой сократить', () => {
    expect(rejected(fresh(), 'add_npc', { name: 'Болтун', x: 10, y: 10, backstory: 'а'.repeat(401) })).toBe('«backstory» слишком длинное (401 симв., можно до 400) — сократи до сути.')
  })

  it('update_npc: занятие и отношение меняются, пустая строка убирает поле; нечего менять — отказ', () => {
    let state = fresh()
    state = run(state, 'update_npc', { npc: 'Гуннар', activity: 'Ушёл в погреб за бочонком.', attitude: 'neutral' }).state
    const gunnar = tavern(state).npcs.find((n) => n.id === 'gunnar')!
    expect(gunnar).toMatchObject({ activity: 'Ушёл в погреб за бочонком.', attitude: 'neutral' })
    state = run(state, 'update_npc', { npc: 'gunnar', fear: '' }).state
    expect(tavern(state).npcs.find((n) => n.id === 'gunnar')!.fear).toBeUndefined()
    expect(rejected(state, 'update_npc', { npc: 'Гуннар' })).toBe('Нечего менять: укажи хотя бы одно поле.')
    expect(rejected(state, 'update_npc', { npc: 'Никто', goal: 'x' })).toMatch(/НПС/)
  })

  it('старый НПС без личности — выжимка как раньше; в запрос идут только НПС текущей локации', () => {
    const state = fresh()
    const loc = tavern(state)
    const plain = { ...loc.npcs[0], backstory: undefined, goal: undefined, fear: undefined, speech: undefined, activity: undefined }
    const old: StoryState = { ...state, world: { ...state.world, locations: { ...state.world.locations, [loc.id]: { ...loc, npcs: [plain] } } } }
    const text = gameStateText(old, { catalog: itemCatalog, rules: rulesData })
    expect(text).toContain(`- ${plain.name} (${plain.x}, ${plain.y}), отношение: дружелюбное: ${plain.description}`)
    expect(text).not.toContain('цель:')
    // Другая локация мира с НПС — в запрос не попадает.
    const elsewhere = { ...loc, id: 'far-away', name: 'Далёкая башня', npcs: [{ ...loc.npcs[1], id: 'hermit', name: 'Отшельник', goal: 'Секретная цель отшельника' }] }
    const two: StoryState = { ...state, world: { ...state.world, locations: { ...state.world.locations, [elsewhere.id]: elsewhere } } }
    expect(gameStateText(two, { catalog: itemCatalog, rules: rulesData })).not.toContain('Секретная цель отшельника')
  })

  it('событие npcUpdated проверяется: неизвестный НПС и неверное отношение — отказ', () => {
    const s = fresh()
    const loc = tavern(s)
    const check = (event: StoryEvent) => checkAction(s, makeAction(s.id, 1, event, MASTER, 1, 'x'), { catalog: itemCatalog })
    expect(check({ type: 'npcUpdated', locationId: loc.id, npcId: 'gunnar', changes: { goal: 'Новая цель' } })).toBeNull()
    expect(check({ type: 'npcUpdated', locationId: loc.id, npcId: 'nobody', changes: { goal: 'x' } })).toBe('В этой локации нет такого НПС.')
    expect(check({ type: 'npcUpdated', locationId: loc.id, npcId: 'gunnar', changes: { attitude: 'angry' as never } })).toMatch(/attitude/)
  })
})

describe('награды не из ниоткуда: источник, справочник, пределы по уровню отряда; урон и гибель — только броски движка', () => {
  const s = fresh()

  it('give_item без источника или с выдуманным источником — отказ с причиной для рассказа', () => {
    expect(rejected(s, 'give_item', { item: 'plate-armor' })).toMatch(/^Укажи «source» — откуда это у героя/)
    expect(rejected(s, 'give_item', { item: 'dagger', source: 'gift' })).toContain('«source»: «gift» — не из списка')
    expect(rejected(s, 'give_item', { item: 'dagger', source: 'npc', from: 'Король' })).toMatch(/^НПС «Король» здесь нет — получить от него нельзя\. НПС рядом: Гуннар/)
    expect(rejected(s, 'give_item', { item: 'dagger', source: 'npc' })).toBe('Укажи «from»: id или имя НПС, от которого это.')
    expect(rejected(s, 'give_item', { item: 'dagger', source: 'location', from: 'Сокровищница' })).toMatch(/^Объекта «Сокровищница» в локации нет\./)
    expect(rejected(s, 'give_item', { item: 'dagger', source: 'quest', from: 'Драконье логово' })).toMatch(/^Задания «Драконье логово» нет в журнале заданий/)
    expect(rejected(s, 'give_item', { item: 'dagger', source: 'loot', from: 'Дракон' })).toMatch(/^«Дракон» в локации нет — добыче неоткуда взяться/)
  })

  it('«нахожу непробиваемый доспех»: латы на 1-м уровне из бочки — слишком ценно; кинжал из бочки — можно', () => {
    expect(rejected(s, 'give_item', { item: 'plate-armor', source: 'location', from: 'storage-barrel-4' })).toBe(
      '«Латы» стоит 1500 зм — для отряда 1-го уровня награда за раз не больше 100 зм. Найти такое просто так нельзя: его можно купить, заработать заданием или найти поскромнее — обыграй это в рассказе.',
    )
    const found = run(s, 'give_item', { item: 'dagger', source: 'location', from: 'storage-barrel-4' })
    expect(found.outcome.ok).toBe(true)
    expect(found.outcome.result.message).toBe('Ратибор получает: Кинжал (из «Бочка»).')
  })

  it('редкость — по таблице: необычное и выше на 1-м уровне недоступно, на 5-м — редкое можно', () => {
    const catalog = { ...itemCatalog, 'cloak-of-x': { id: 'cloak-of-x', name: 'Плащ теней', category: 'gear' as const, icon: '🧥', weight: 1, description: 'x', rarity: 'rare' as const } }
    const ctx = { ...context(), catalog }
    expect(rejected(s, 'give_item', { item: 'cloak-of-x', source: 'npc', from: 'gunnar' }, ctx)).toBe(
      '«Плащ теней» — редкий предмет, а отряду 1-го уровня доступно не выше «необычный». Такого здесь нет — обыграй это в рассказе.',
    )
    const veteran = structuredClone(s)
    veteran.party[0].character.level = 5
    // На 5-м уровне редкое по редкости можно, но цена редкого (4000 зм) больше предела за раз (1000 зм).
    expect(rejected(veteran, 'give_item', { item: 'cloak-of-x', source: 'npc', from: 'gunnar' }, ctx)).toMatch(/стоит 4000 зм — для отряда 5-го уровня награда за раз не больше 1000 зм/)
  })

  it('покупка: движок сам списывает цену из справочника; денег мало — покупки нет; без цены — не продаётся', () => {
    const bought = run(s, 'give_item', { item: 'dagger', source: 'purchase', from: 'Гуннар' })
    expect(bought.outcome.events.map((e) => e.event.type)).toEqual(['moneyChanged', 'itemsGranted'])
    expect(bought.state.party[0].inventory.coins).toEqual({ gp: 16, sp: 0, cp: 0 })
    expect(bought.outcome.result.message).toBe('Ратибор получает: Кинжал (куплено у Гуннар). Заплачено 2 зм, в кошельке: 16 зм.')
    // Латы дороже кошелька (покупка не ограничена таблицей, но платит герой).
    expect(rejected(s, 'give_item', { item: 'plate-armor', source: 'purchase' })).toBe('Денег не хватает: у Ратибор 18 зм, а «Латы» стоит 1500 зм. Покупки нет — обыграй это в рассказе.')
  })

  it('награда за задание — только за задание из журнала, не проваленное', () => {
    const withQuest = (status: 'active' | 'failed') => {
      const q = structuredClone(s)
      q.world.quests = [{ id: 'rats', title: 'Крысы в подвале', status, notes: '' }]
      return q
    }
    expect(run(withQuest('active'), 'change_gold', { amount: 10, reason: 'за крыс', source: 'quest', from: 'Крысы в подвале' }).outcome.result.message).toBe(
      'Ратибор: получил 10 зм (награда за «Крысы в подвале»). В кошельке: 28 зм.',
    )
    expect(rejected(withQuest('failed'), 'change_gold', { amount: 10, reason: 'x', source: 'quest', from: 'rats' })).toBe('Задание «Крысы в подвале» провалено — награды за него нет.')
  })

  it('«трактирщик отдаёт мне всё золото»: доход без источника — отказ; сумма сверх таблицы — отказ; плата — без источника', () => {
    expect(rejected(s, 'change_gold', { amount: 500, reason: 'всё золото трактирщика' })).toMatch(/^Укажи «source» — откуда это у героя.*Для денег — npc, location, quest или loot\.$/)
    expect(rejected(s, 'change_gold', { amount: 500, reason: 'всё золото', source: 'npc', from: 'gunnar' })).toBe(
      '500 зм за раз — слишком много для отряда 1-го уровня (не больше 100 зм). Столько денег здесь нет — обыграй это в рассказе.',
    )
    expect(rejected(s, 'change_gold', { amount: 5, reason: 'x', source: 'purchase' })).toContain('«source»: «purchase» — не из списка')
    expect(run(s, 'change_gold', { amount: -4, currency: 'cp', reason: 'эль' }).outcome.ok).toBe(true)
  })

  it('урон — только кубиками движка (бросок в журнале); числом урон не задаётся; лечение — числом или кубиками', () => {
    expect(rejected(s, 'change_hp', { kind: 'damage', amount: 100, source: 'одним ударом' })).toBe(
      'Урон бросает движок: укажи «dice» (например «1d6» за удар дубинкой). Числом урон не задаётся — ни игроком, ни ведущим.',
    )
    expect(rejected(s, 'change_hp', { kind: 'damage', dice: '7' })).toBe('«dice»: В записи броска нет ни одного кубика')
    const club = run(s, 'change_hp', { kind: 'damage', dice: '1d6', damage_type: 'bludgeoning', source: 'дубинка' }, context([face(4, 6)]))
    expect(club.outcome.events.map((e) => [e.event.type, e.author.kind])).toEqual([
      ['diceRolled', 'engine'],
      ['hpChanged', 'master'],
    ])
    expect(club.outcome.result).toMatchObject({ amount: 4, hp: 8 })
    expect(club.outcome.result.message).toBe('Ратибор: урон 4 (дробящий) (бросок 1d6: 4), хиты 8/12.')
    expect(club.state.rolls.at(-1)?.label).toBe('Ратибор: урон (дробящий) — дубинка')
    expect(run(club.state, 'change_hp', { kind: 'healing', amount: 2 }).state.party[0].character.hp).toBe(10)
  })

  it('«одним ударом убиваю…»: гибель существа словами не бывает — remove_npc died отклонён; ушёл и сбежал — можно', () => {
    expect(rejected(s, 'remove_npc', { npc: 'Брам', reason: 'died' })).toMatch(/^Гибель существ — только по броскам движка в бою.*Брам жив/)
    expect(run(s, 'remove_npc', { npc: 'Брам', reason: 'fled' }).outcome.result.message).toBe('Брам сбегает с карты.')
  })
})

describe('обстановка богатой карты', () => {
  it('ковёр и свеча ложатся поверх стола; сундук на занятую клетку — нельзя; набор объектов — по виду карты', () => {
    const s = fresh()
    expect(run(s, 'add_object', { name: 'Свеча', type: 'candle', x: 9, y: 7 }).outcome.ok).toBe(true)
    expect(run(s, 'add_object', { name: 'Ковёр', type: 'rug', x: 9, y: 7, w: 2, h: 2 }).outcome.ok).toBe(true)
    expect(rejected(s, 'add_object', { name: 'Сундук', type: 'chest', x: 9, y: 7 })).toContain('занята')
    const region = structuredClone(s)
    region.world.locations[LOC].scale = { kind: 'region', cell: 6, unit: 'mi' }
    expect(rejected(region, 'add_object', { name: 'Стул', type: 'chair', x: 6, y: 9 })).toMatch(/^На этой карте объекты «chair» не ставятся/)
  })
})
