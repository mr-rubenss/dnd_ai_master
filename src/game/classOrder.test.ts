// «Божественный порядок» жреца и «Изначальный порядок» друида, заклинания от умений («Друидический язык», «Избранный
// враг»), миграция старых героев, запас «Наложения рук» — по SRD 5.2.1.
import { describe, expect, it } from 'vitest'
import { defaultAdventure, itemCatalog, locations, rulesData as rules, startingSheet } from '../data'
import type { AiToolCall } from '../ai/types'
import { abilityCheck } from '../engine/checks'
import type { Character } from '../types/character'
import type { StoryEvent, StoryState } from '../types/story'
import { checkSubjectOf, needsOrderChoice, weaponTraining } from './classOrder'
import { needsSheetCompletion } from './sheetCompletion'
import { buildCharacterSheet, creationSteps, emptyDraft, stepProblems, type CreationDraft } from './creation'
import { emptySpellChoice, knownSpells, needsSpellChoice, planCast, spellLimits } from './magic'
import { executeTool } from './masterTools'
import { restEvents } from './rest'
import { applyAction, checkAction, ENGINE, makeAction, MASTER, newStorySeed, player } from './storyActions'

const base = (patch: Partial<Character>): Character => ({ ...structuredClone(startingSheet.character), feats: [], ...patch })

describe('порядки жреца и друида', () => {
  it('Чудотворец и Маг знают на один заговор больше', () => {
    expect(spellLimits('cleric', 1, rules).cantrips).toBe(3)
    expect(spellLimits('cleric', 1, rules, 'thaumaturge').cantrips).toBe(4)
    expect(spellLimits('cleric', 1, rules, 'protector').cantrips).toBe(3)
    expect(spellLimits('druid', 1, rules, 'magician').cantrips).toBe(3)
  })

  it('Чудотворец: +Мдр (минимум +1) к Интеллекту (Магия, Религия)', () => {
    const c = base({ classId: 'cleric', classOrder: 'thaumaturge', abilities: { ...startingSheet.character.abilities, int: 10, wis: 16 } })
    const check = abilityCheck(checkSubjectOf(c, rules), { skill: 'religion' }, { dc: 10, rng: () => 0.5 })
    expect(check.modifiers).toContainEqual({ label: 'Чудотворец', value: 3 })
    const lowWis = base({ classId: 'druid', classOrder: 'magician', abilities: { ...startingSheet.character.abilities, wis: 8 } })
    expect(checkSubjectOf(lowWis, rules).skillBonuses).toEqual([{ skills: ['arcana', 'nature'], label: 'Маг', value: 1 }])
    expect(checkSubjectOf(base({ classId: 'cleric', classOrder: 'protector' }), rules).skillBonuses).toBeUndefined()
  })

  it('Защитник и Страж владеют воинским оружием', () => {
    expect(weaponTraining(base({ classId: 'cleric' }), rules)).toBe('none')
    expect(weaponTraining(base({ classId: 'cleric', classOrder: 'protector' }), rules)).toBe('all')
    expect(weaponTraining(base({ classId: 'druid', classOrder: 'warden' }), rules)).toBe('all')
  })

  it('создание жреца: порядок обязателен, Защитник даёт тяжёлые доспехи, Чудотворцу — 4 заговора', () => {
    const d = clericDraft()
    expect(stepProblems('class', { ...d, classOrder: null }, rules)).toContain('Выберите: божественный порядок')
    const protector = buildCharacterSheet({ ...d, classOrder: 'protector' }, rules, itemCatalog, 'p').character
    expect(protector.classOrder).toBe('protector')
    expect(protector.proficiencies.armor).toEqual(['light', 'medium', 'shield', 'heavy'])
    const thaum = { ...d, classOrder: 'thaumaturge' }
    expect(stepProblems('spells', thaum, rules)).toContain('Заговоры: выберите 4 (выбрано 3)')
    const ok = { ...thaum, spells: { ...thaum.spells, cantrips: ['guidance', 'light', 'thaumaturgy', 'sacred-flame'] } }
    expect(creationSteps(ok, rules).map((s) => s.id)).toContain('spells')
    expect(buildCharacterSheet(ok, rules, itemCatalog, 't').character.magic?.cantrips).toHaveLength(4)
  })
})

/** Готовый черновик жреца (без порядка), заклинания выбраны на 3 заговора. */
function clericDraft(): CreationDraft {
  return {
    ...emptyDraft(),
    languages: ['elvish', 'orc'],
    classId: 'cleric',
    classSkills: ['insight', 'medicine'],
    backgroundId: 'soldier',
    backgroundTool: 'dice-set',
    bonusPlus2: 'str',
    bonusPlus1: 'con',
    speciesId: 'dwarf',
    assignment: { str: 0, dex: 1, con: 2, int: 3, wis: 4, cha: 5 },
    classEquipment: 'A',
    backgroundEquipment: 'A',
    name: 'Брат Ольгерд',
    spells: { ...emptySpellChoice(), cantrips: ['guidance', 'light', 'thaumaturgy'], prepared: ['bless', 'cure-wounds', 'command', 'sanctuary'] },
  }
}

describe('заклинания от умений класса', () => {
  it('Друидический язык: «Разговор с животными» всегда подготовлен и не входит в лимит', () => {
    const druid = base({ classId: 'druid', classOrder: 'warden', magic: { cantrips: ['druidcraft', 'guidance'], prepared: ['cure-wounds', 'entangle', 'faerie-fire', 'goodberry'], slotsUsed: {} } })
    const swa = knownSpells(druid, rules).find((k) => k.spell.id === 'speak-with-animals')
    expect(swa).toMatchObject({ source: 'feature', sourceName: 'Друидический язык' })
    expect(swa?.innate?.freeMax).toBeNull()
    expect(planCast(druid, { spellId: 'speak-with-animals', ritual: true }, rules)).toMatchObject({ ritual: true, slotLevel: null })
    expect(needsSpellChoice({ ...druid, magic: { ...druid.magic!, prepared: ['speak-with-animals', 'entangle', 'faerie-fire', 'goodberry'] } }, rules)).toBe(true)
  })

  it('Избранный враг: «Метка охотника» дважды без ячейки, долгий отдых возвращает', () => {
    const ranger = base({ classId: 'ranger', magic: { cantrips: [], prepared: ['cure-wounds', 'ensnaring-strike'], slotsUsed: {} } })
    let s = newStorySeed({ id: 's', title: 'Т', tone: 'detective', adventure: defaultAdventure, locations, party: [{ character: ranger, inventory: startingSheet.inventory }], now: 1 })
    const heroId = ranger.id
    for (let i = 0; i < 2; i++) {
      const plan = planCast(s.party[0].character, { spellId: 'hunters-mark' }, rules)
      if (typeof plan === 'string') throw new Error(plan)
      expect(plan).toMatchObject({ slotLevel: null, freeKey: 'feature:hunters-mark' })
      s = applyAction(s, makeAction('s', 1, { type: 'spellCast', heroId, spellId: 'hunters-mark', slotLevel: null, freeKey: plan.freeKey, ritual: false }, MASTER, 1, `c${i}`))
    }
    // Бесплатные кончились — дальше ячейкой.
    expect(planCast(s.party[0].character, { spellId: 'hunters-mark' }, rules)).toMatchObject({ slotLevel: 1, freeKey: null })
    for (const e of restEvents(s, 'long', {}, { rules, now: () => 1, newId: () => 'r' })) s = applyAction(s, makeAction('s', 9, e, ENGINE, 1, 'r'))
    expect(planCast(s.party[0].character, { spellId: 'hunters-mark' }, rules)).toMatchObject({ freeKey: 'feature:hunters-mark' })
  })
})

describe('миграция старых героев', () => {
  const seed = (character: Character) =>
    newStorySeed({ id: 's', title: 'Т', tone: 'detective', adventure: defaultAdventure, locations, party: [{ character, inventory: startingSheet.inventory }], now: 1 })
  const ctx = { catalog: itemCatalog, rules }
  const act = (s: StoryState, e: StoryEvent) => {
    const a = makeAction(s.id, 1, e, player(s.party[0].heroId), 1, 'x')
    const reason = checkAction(s, a, ctx)
    return { reason, state: reason ? s : applyAction(s, a) }
  }

  it('старый жрец: сначала порядок (Чудотворец), потом ещё один заговор', () => {
    const old = base({ classId: 'cleric', className: 'Жрец', magic: { cantrips: ['guidance', 'light', 'thaumaturgy'], prepared: ['bless', 'cure-wounds', 'command', 'sanctuary'], slotsUsed: {} } })
    expect(needsOrderChoice(old, rules)).toBe(true)
    expect(needsSpellChoice(old, rules)).toBe(false)
    let s = seed(old)
    expect(act(s, { type: 'classOrderChosen', heroId: old.id, order: 'thaumaturge', armor: ['heavy'] }).reason).toBe('Владение доспехами не совпадает с выбранным порядком.')
    s = act(s, { type: 'classOrderChosen', heroId: old.id, order: 'thaumaturge', armor: [] }).state
    const c = s.party[0].character
    expect(c.classOrder).toBe('thaumaturge')
    expect(needsSpellChoice(c, rules)).toBe(true)
    const magic = { ...c.magic!, cantrips: [...c.magic!.cantrips, 'sacred-flame'] }
    s = act(s, { type: 'spellsChosen', heroId: old.id, magic }).state
    expect(needsSheetCompletion(s.party[0].character, rules)).toBe(false)
  })

  it('Страж получает средние доспехи', () => {
    const old = base({ classId: 'druid', proficiencies: { ...startingSheet.character.proficiencies, armor: ['light', 'shield'] } })
    const s = act(seed(old), { type: 'classOrderChosen', heroId: old.id, order: 'warden', armor: ['medium'] }).state
    expect(s.party[0].character.proficiencies.armor).toEqual(['light', 'shield', 'medium'])
    expect(act(s, { type: 'classOrderChosen', heroId: old.id, order: 'magician', armor: [] }).reason).toBe('Порядок уже выбран.')
  })

  it('заклинание, которого нет в справочнике, — повод выбрать заново', () => {
    const old = base({ classId: 'wizard', magic: { cantrips: ['fire-bolt', 'light', 'old-removed-cantrip'], spellbook: ['magic-missile', 'shield', 'sleep', 'detect-magic', 'mage-armor', 'identify'], prepared: ['magic-missile', 'shield', 'sleep', 'mage-armor'], slotsUsed: {} } })
    expect(needsSpellChoice(old, rules)).toBe(true)
  })
})

describe('Наложение рук — запас', () => {
  const call = (args: unknown): AiToolCall => ({ id: 'u', name: 'use_feature', arguments: args, rawArguments: JSON.stringify(args) })
  it('тратит из запаса столько, сколько лечит; больше запаса — нельзя', () => {
    const paladin = base({ classId: 'paladin', hp: 4 })
    const s = newStorySeed({ id: 's', title: 'Т', tone: 'detective', adventure: defaultAdventure, locations, party: [{ character: paladin, inventory: startingSheet.inventory }], now: 1 })
    const ctx = { catalog: itemCatalog, rules, now: () => 1, newId: () => 'n' }
    const out = executeTool(s, call({ feature: 'Наложение рук', amount: 3 }), ctx)
    expect(out.result.message).toBe('Ратибор: «Наложение рук» — Ратибор восстанавливает 3 хитов (7/12); в запасе 2/5.')
    expect(executeTool(s, call({ feature: 'lay-on-hands', amount: 6 }), ctx).result.error).toBe('В запасе «Наложение рук» осталось 5, а нужно 6.')
    expect(executeTool(s, call({ feature: 'lay-on-hands' }), ctx).result.error).toMatch(/укажи amount/)
  })
})
