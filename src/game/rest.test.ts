// Отдых: кости хитов, восстановление ячеек и умений, Истощение, прерывание; инструменты rest / interrupt_rest / use_feature.
import { describe, expect, it } from 'vitest'
import { defaultAdventure, itemCatalog, locations, rulesData, startingSheet } from '../data'
import type { AiToolCall } from '../ai/types'
import type { StoryEvent, StoryState } from '../types/story'
import { executeTool, type ToolContext } from './masterTools'
import { featureResources, hitDiceOf, restEvents } from './rest'
import { applyAction, checkAction, ENGINE, makeAction, MASTER, newStorySeed, player } from './storyActions'
import { changeList, ledgerOf, turnDelta } from './turnChanges'

const HERO = startingSheet.character.id
const ctxA = { catalog: itemCatalog, rules: rulesData }
const face = (v: number, sides: number) => (v - 0.5) / sides

/** Ратибор (воин, ТЕЛ 14 → +2, к10) после трудного дня: ранен, потратил «Второе дыхание» и кость хитов. */
function tired(patch: Partial<StoryState['party'][number]['character']> = {}): StoryState {
  const sheet = structuredClone(startingSheet)
  sheet.character = { ...sheet.character, hp: 3, featureUses: { 'second-wind': 2 }, ...patch }
  return newStorySeed({ id: 's', title: 'Т', tone: 'detective', adventure: defaultAdventure, locations, party: [sheet], now: 1 })
}

let seq = 1
function act(state: StoryState, event: StoryEvent, author = player(HERO)) {
  const action = makeAction(state.id, seq++, event, author, 10, `a${seq}`)
  const reason = checkAction(state, action, ctxA)
  return { reason, state: reason ? state : applyAction(state, action) }
}
function applyAll(state: StoryState, events: StoryEvent[]) {
  return events.reduce((s, e) => {
    const r = act(s, e, ENGINE)
    expect(r.reason).toBeNull()
    return r.state
  }, state)
}
const restCtx = (rolls: number[]) => ({ rules: rulesData, rng: () => rolls.shift() ?? 0.5, now: () => 1, newId: (() => { let n = 0; return () => `id${++n}` })() })

describe('отдых', () => {
  it('кости хитов: столько, каков уровень; кость класса', () => {
    expect(hitDiceOf(startingSheet.character, rulesData)).toEqual({ die: 10, total: 1, left: 1 })
    expect(hitDiceOf({ ...startingSheet.character, hitDiceUsed: 1 }, rulesData).left).toBe(0)
  })

  it('короткий: кость хитов (бросок + ТЕЛ), одно применение «Второго дыхания»; строка изменений', () => {
    const before = act(tired(), { type: 'restRequested', kind: 'short', hitDice: { [HERO]: 1 } }).state
    expect(before.pendingRest).toMatchObject({ kind: 'short' })
    const after = applyAll(before, restEvents(before, 'short', { [HERO]: 1 }, restCtx([face(6, 10)])))
    const c = after.party[0].character
    expect(c.hp).toBe(11) // 3 + 6 + 2
    expect(c.hitDiceUsed).toBe(1)
    expect(featureResources(c, rulesData)[0]).toMatchObject({ used: 1, left: 1 })
    expect(after.pendingRest).toBeUndefined()
    expect(after.messages.at(-1)?.text).toBe('Короткий отдых (1 час) окончен.')
    const names = { 'second-wind': 'Второе дыхание' }
    expect(changeList(turnDelta(ledgerOf(before, itemCatalog), ledgerOf(after, itemCatalog)), after, itemCatalog, new Map(), {}, names).map((x) => x.text)).toEqual([
      '+8 хитов',
      '−1 кость хитов',
      '+1 применение («Второе дыхание»)',
    ])
    // Костей больше нет — потратить ещё нельзя.
    expect(act(after, { type: 'restRequested', kind: 'short', hitDice: { [HERO]: 1 } }).reason).toBe('У Ратибор осталось костей хитов: 0.')
  })

  it('долгий: все хиты, кости хитов, ячейки, бесплатные сотворения, умения, −1 Истощение', () => {
    const mage = tired({
      hitDiceUsed: 1,
      conditions: [{ id: 'exhaustion', level: 2 }],
      classId: 'warlock',
      className: 'Колдун',
      magic: { cantrips: ['eldritch-blast', 'minor-illusion'], prepared: ['hex', 'charm-person'], slotsUsed: { 1: 1 } },
    })
    const s = act(mage, { type: 'restRequested', kind: 'long', hitDice: {} }).state
    const after = applyAll(s, restEvents(s, 'long', {}, restCtx([])))
    const c = after.party[0].character
    expect(c.hp).toBe(c.maxHp)
    expect(c.hitDiceUsed).toBeUndefined()
    expect(c.magic?.slotsUsed).toEqual({})
    expect(c.conditions).toEqual([{ id: 'exhaustion', level: 1 }])
    const lines = changeList(turnDelta(ledgerOf(s, itemCatalog), ledgerOf(after, itemCatalog)), after, itemCatalog).map((x) => x.text)
    expect(lines).toEqual(expect.arrayContaining(['+9 хитов', '+1 кость хитов', '+1 ячейка 1-го круга', 'Истощение −1 ур.']))
  })

  it('ячейки волшебника короткий отдых не возвращает, колдуна — возвращает', () => {
    const magic = { cantrips: ['fire-bolt', 'light', 'mage-hand'], spellbook: ['magic-missile', 'shield', 'sleep', 'detect-magic', 'mage-armor', 'identify'], prepared: ['magic-missile', 'shield', 'sleep', 'mage-armor'], slotsUsed: { 1: 2 } }
    const wizard = tired({ classId: 'wizard', className: 'Волшебник', magic })
    const after = applyAll(wizard, restEvents(wizard, 'short', {}, restCtx([])))
    expect(after.party[0].character.magic?.slotsUsed).toEqual({ 1: 2 })
    // Подделанный итог (ячейки на коротком у волшебника) движок не примет.
    const forged = restEvents(wizard, 'short', {}, restCtx([])).at(-1) as Extract<StoryEvent, { type: 'restCompleted' }>
    forged.heroes[0].restoreSlots = true
    expect(act(wizard, forged, ENGINE).reason).toBe('На коротком отдыхе восстанавливаются только ячейки магии договора.')
  })

  it('без сознания не отдыхают; отдых просит только игрок; прервать может ведущий', () => {
    expect(act(tired({ hp: 0 }), { type: 'restRequested', kind: 'long', hitDice: {} }).reason).toMatch(/без сознания/)
    expect(act(tired(), { type: 'restRequested', kind: 'long', hitDice: {} }, MASTER).reason).toBe('Отдых просит игрок.')
    expect(act(tired(), { type: 'restInterrupted', messageId: 'm', reason: 'шум' }, MASTER).reason).toBe('Сейчас никто не отдыхает.')
    const s = act(tired(), { type: 'restRequested', kind: 'long', hitDice: {} }).state
    expect(act(s, { type: 'restRequested', kind: 'short', hitDice: {} }).reason).toBe('Отдых уже начат — дождитесь ответа ведущего.')
    const broken = act(s, { type: 'restInterrupted', messageId: 'm', reason: 'в дверь ломятся стражники' }, MASTER).state
    expect(broken.pendingRest).toBeUndefined()
    expect(broken.party[0].character.hp).toBe(3)
    expect(broken.messages.at(-1)?.text).toBe('Отдых прерван: в дверь ломятся стражники')
  })
})

describe('инструменты отдыха', () => {
  const tools = (rolls: number[] = []): ToolContext => {
    let n = 0
    return { catalog: itemCatalog, rules: rulesData, rng: () => rolls.shift() ?? 0.5, now: () => 1, newId: () => `t${++n}` }
  }
  const call = (name: string, args: unknown): AiToolCall => ({ id: name, name, arguments: args, rawArguments: JSON.stringify(args) })

  it('rest без кнопки («ложимся спать»): долгий отдых сразу', () => {
    const out = executeTool(tired(), call('rest', { kind: 'long' }), tools())
    expect(out.ok).toBe(true)
    expect(out.result.message).toMatch(/^Долгий отдых \(8 часов\) окончен\. Ратибор: \+9 хитов, умения восстановлены/)
  })

  it('rest разрешает отдых, о котором попросил игрок; другой вид — отказ', () => {
    const s = act(tired(), { type: 'restRequested', kind: 'short', hitDice: { [HERO]: 1 } }).state
    expect(executeTool(s, call('rest', { kind: 'long' }), tools()).result.error).toMatch(/Игрок попросил короткий отдых/)
    expect(executeTool(s, call('rest', {}), tools([face(4, 10)])).result.message).toMatch(/\+6 хитов \(кости хитов: 6; осталось 0\/1\)/)
  })

  it('interrupt_rest — только когда отдых начат', () => {
    expect(executeTool(tired(), call('interrupt_rest', { reason: 'волки' }), tools()).result.error).toMatch(/прерывать нечего/)
    const s = act(tired(), { type: 'restRequested', kind: 'long', hitDice: {} }).state
    expect(executeTool(s, call('interrupt_rest', { reason: 'волки' }), tools()).ok).toBe(true)
  })

  it('use_feature: «Второе дыхание» лечит броском движка; потрачено — отказ', () => {
    const fresh = tired({ featureUses: {} })
    const out = executeTool(fresh, call('use_feature', { feature: 'Второе дыхание' }), tools([face(5, 10)]))
    expect(out.result.message).toBe('Ратибор применяет «Второе дыхание» (осталось 1/2). Лечение 6, хиты 9/12.')
    expect(executeTool(tired(), call('use_feature', { feature: 'second-wind' }), tools()).result.error).toMatch(/потрачено \(0\/2\)/)
    expect(executeTool(tired(), call('use_feature', { feature: 'Ярость' }), tools()).result.error).toMatch(/нет умения «Ярость»/)
  })
})
