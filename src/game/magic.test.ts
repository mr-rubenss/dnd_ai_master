import { describe, expect, it } from 'vitest'
import { rulesData as rules } from '../data'
import spellsJson from '../data/spells.json'
import type { CharacterMagic } from '../types/spells'
import {
  classChoiceProblems,
  hasMagic,
  innateSpells,
  knownSpells,
  magicProblems,
  needsSpellChoice,
  planCast,
  preparedProblems,
  restoreMagic,
  slotTotals,
  spellcastingStats,
  spellLimits,
  spellSlots,
  spendCast,
  type MagicSubject,
} from './magic'
import { parseSpellCatalog } from './spells'

const abilities = { str: 8, dex: 14, con: 13, int: 16, wis: 12, cha: 10 }
const hero = (patch: Partial<MagicSubject> = {}): MagicSubject => ({
  classId: 'wizard',
  level: 1,
  abilities,
  feats: [],
  speciesId: 'human',
  speciesOption: null,
  backgroundId: 'soldier',
  ...patch,
})
const wizardMagic = (): CharacterMagic => ({
  cantrips: ['fire-bolt', 'light', 'mage-hand'],
  spellbook: ['magic-missile', 'shield', 'sleep', 'detect-magic', 'mage-armor', 'identify'],
  prepared: ['magic-missile', 'shield', 'sleep', 'mage-armor'],
  slotsUsed: {},
})

describe('справочник заклинаний', () => {
  it('загружается и проверяется', () => {
    expect(Object.keys(rules.spells).length).toBeGreaterThan(70)
    expect(rules.spells['fire-bolt']).toMatchObject({ level: 0, effect: { attack: 'ranged', damage: { dice: '1d10', type: 'fire' } } })
    expect(rules.spells['cure-wounds'].effect).toEqual({ healing: '2d8', addModifier: true })
  })

  it('отклоняет некорректные записи с понятной причиной', () => {
    const broken = structuredClone(spellsJson) as Record<string, unknown>[]
    broken[0].level = 9
    broken[1].school = 'pyromancy'
    broken[2].classes = ['fighter']
    broken[3].effect = { attack: 'ranged' }
    expect(() => parseSpellCatalog(broken)).toThrow(/"level" — от 0[\s\S]*"school"[\s\S]*"classes"[\s\S]*нужен урон/)
  })
})

describe('числа заклинателя', () => {
  it('Сл спасброска и бонус атаки: 8 + мод + БМ и мод + БМ', () => {
    expect(spellcastingStats({ abilities, level: 1 }, 'int')).toEqual({ ability: 'int', modifier: 3, saveDc: 13, attackBonus: 5 })
    expect(spellcastingStats({ abilities, level: 5 }, 'cha')).toMatchObject({ saveDc: 11, attackBonus: 3 })
  })

  it('ячейки по таблицам: полный, половинный заклинатель и магия договора', () => {
    expect(slotTotals('wizard', 1, rules)).toEqual({ 1: 2 })
    expect(slotTotals('cleric', 3, rules)).toEqual({ 1: 4, 2: 2 })
    expect(slotTotals('paladin', 1, rules)).toEqual({ 1: 2 })
    expect(slotTotals('ranger', 5, rules)).toEqual({ 1: 4, 2: 2 })
    expect(slotTotals('warlock', 1, rules)).toEqual({ 1: 1 })
    expect(slotTotals('warlock', 3, rules)).toEqual({ 2: 2 })
    expect(slotTotals('fighter', 1, rules)).toEqual({})
  })

  it('заговоры и подготовленные на 1-м уровне по таблицам классов 2024', () => {
    const table = Object.fromEntries(['bard', 'cleric', 'druid', 'paladin', 'ranger', 'sorcerer', 'warlock', 'wizard'].map((c) => [c, spellLimits(c, 1, rules)]))
    expect(table).toMatchObject({
      bard: { cantrips: 2, prepared: 4, spellbook: 0 },
      cleric: { cantrips: 3, prepared: 4 },
      druid: { cantrips: 2, prepared: 4 },
      paladin: { cantrips: 0, prepared: 2 },
      ranger: { cantrips: 0, prepared: 2 },
      sorcerer: { cantrips: 4, prepared: 2 },
      warlock: { cantrips: 2, prepared: 2 },
      wizard: { cantrips: 3, prepared: 4, spellbook: 6 },
    })
    expect(spellLimits('wizard', 2, rules)).toMatchObject({ prepared: 5, spellbook: 8 })
    expect(spellLimits('fighter', 1, rules)).toEqual({ cantrips: 0, prepared: 0, spellbook: 0, maxLevel: 0 })
  })
})

describe('кто владеет магией', () => {
  it('воин без черт — нет; тифлинг-воин и воин с «Посвящённым в магию» — да', () => {
    expect(hasMagic(hero({ classId: 'fighter' }), rules)).toBe(false)
    expect(hasMagic(hero({ classId: 'fighter', speciesId: 'tiefling', speciesOption: 'infernal' }), rules)).toBe(true)
    expect(hasMagic(hero({ classId: 'fighter', feats: ['magic-initiate'] }), rules)).toBe(true)
  })

  it('старому заклинателю без выбора нужно выбрать заклинания', () => {
    expect(needsSpellChoice(hero(), rules)).toBe(true)
    expect(needsSpellChoice(hero({ magic: wizardMagic() }), rules)).toBe(false)
    expect(needsSpellChoice(hero({ classId: 'fighter', speciesId: 'tiefling', speciesOption: 'infernal' }), rules)).toBe(false)
    expect(needsSpellChoice(hero({ classId: 'fighter', feats: ['magic-initiate'], magic: { cantrips: [], prepared: [], slotsUsed: {} } }), rules)).toBe(true)
  })

  it('врождённые заклинания вида: источник, характеристика, бесплатные сотворения', () => {
    const tiefling = innateSpells(hero({ classId: 'fighter', speciesId: 'tiefling', speciesOption: 'infernal' }), rules)
    expect(tiefling.map((s) => [s.spellId, s.sourceName, s.ability, s.freeMax])).toEqual([
      ['thaumaturgy', 'Тифлинг', 'int', null],
      ['fire-bolt', 'Тифлинг', 'int', null],
    ])
    const gnome = innateSpells(hero({ speciesId: 'gnome', speciesOption: 'forest-gnome', magic: { ...wizardMagic(), speciesAbility: 'wis' } }), rules)
    expect(gnome.find((s) => s.spellId === 'speak-with-animals')).toMatchObject({ freeMax: 2, ability: 'wis' })
  })
})

describe('выбор заклинаний', () => {
  it('верный выбор волшебника проходит', () => {
    expect(magicProblems(hero(), wizardMagic(), rules)).toEqual([])
  })

  it('число, список класса, книга', () => {
    const m = wizardMagic()
    expect(classChoiceProblems('wizard', 1, { ...m, cantrips: ['fire-bolt'] }, rules)).toContain('Заговоры: выберите 3 (выбрано 1)')
    expect(classChoiceProblems('wizard', 1, { ...m, cantrips: ['fire-bolt', 'light', 'sacred-flame'] }, rules)).toContain('Заговор не из списка класса')
    expect(classChoiceProblems('wizard', 1, { ...m, prepared: ['magic-missile', 'shield', 'sleep', 'grease'] }, rules)).toContain('Подготовить можно только заклинания из книги')
    expect(preparedProblems('cleric', 1, ['bless', 'cure-wounds', 'magic-missile', 'sanctuary'], rules)).toContain('«Волшебная стрела» — не заклинание списка класса')
    expect(preparedProblems('cleric', 1, ['bless', 'cure-wounds', 'command', 'sanctuary', 'bane'], rules)).toContain('Подготовленные заклинания: выберите 4 (выбрано 5)')
  })

  it('«Посвящённый в магию»: 2 заговора и 1 заклинание из списка, список предыстории', () => {
    const subject = hero({ classId: 'fighter', feats: ['magic-initiate'], backgroundId: 'acolyte' })
    const ok: CharacterMagic = { cantrips: [], prepared: [], slotsUsed: {}, initiate: { list: 'cleric', ability: 'wis', cantrips: ['guidance', 'light'], spell: 'bless' } }
    expect(magicProblems(subject, ok, rules)).toEqual([])
    expect(magicProblems(subject, { ...ok, initiate: { ...ok.initiate!, list: 'wizard', cantrips: ['fire-bolt', 'light'], spell: 'sleep' } }, rules)).toContain(
      '«Посвящённый в магию»: предыстория даёт список «жрец»',
    )
    expect(magicProblems(subject, { ...ok, initiate: { ...ok.initiate!, cantrips: ['guidance'] } }, rules)).toContain('«Посвящённый в магию»: выберите 2 заговора (выбрано 1)')
    expect(magicProblems(subject, { ...ok, initiate: { ...ok.initiate!, spell: 'magic-missile' } }, rules)).toContain(
      '«Посвящённый в магию»: заклинание 1-го круга — из выбранного списка',
    )
  })
})

describe('сотворение и ячейки', () => {
  const wizard = hero({ magic: wizardMagic() })

  it('заговор — без ячейки', () => {
    const plan = planCast(wizard, { spellId: 'fire-bolt' }, rules)
    expect(plan).toMatchObject({ slotLevel: null, freeKey: null, stats: { attackBonus: 5, saveDc: 13 } })
  })

  it('заклинание тратит ячейку; когда ячеек нет — отказ; долгий отдых восстанавливает', () => {
    let magic = wizard.magic!
    for (let i = 0; i < 2; i++) {
      const plan = planCast({ ...wizard, magic }, { spellId: 'magic-missile' }, rules)
      if (typeof plan === 'string') throw new Error(plan)
      expect(plan.slotLevel).toBe(1)
      magic = spendCast(magic, plan)
    }
    expect(spellSlots({ ...wizard, magic }, rules)).toEqual([{ level: 1, total: 2, used: 2, left: 0, pact: false }])
    expect(planCast({ ...wizard, magic }, { spellId: 'sleep' }, rules)).toMatch(/нет свободных ячеек/)
    expect(planCast({ ...wizard, magic }, { spellId: 'sleep', slotLevel: 1 }, rules)).toMatch(/потрачены \(0\/2\)/)
    expect(restoreMagic(magic, 'wizard', 'short', rules).slotsUsed).toEqual({ 1: 2 })
    expect(restoreMagic(magic, 'wizard', 'long', rules).slotsUsed).toEqual({})
  })

  it('ячейки магии договора восстанавливаются на коротком отдыхе', () => {
    const magic: CharacterMagic = { cantrips: ['eldritch-blast', 'minor-illusion'], prepared: ['hex', 'charm-person'], slotsUsed: { 1: 1 } }
    expect(spellSlots(hero({ classId: 'warlock', magic }), rules)[0]).toMatchObject({ left: 0, pact: true })
    expect(restoreMagic(magic, 'warlock', 'short', rules).slotsUsed).toEqual({})
  })

  it('отказ на неизвестное и неподготовленное заклинание', () => {
    expect(planCast(wizard, { spellId: 'cure-wounds' }, rules)).toMatch(/не знает заклинания «Лечение ран»/)
    expect(planCast(wizard, { spellId: 'no-such-spell' }, rules)).toMatch(/нет в справочнике/)
    expect(planCast(wizard, { spellId: 'identify' }, rules)).toMatch(/не подготовлено/)
    expect(planCast(wizard, { spellId: 'magic-missile', slotLevel: 2 }, rules)).toMatch(/нет ячеек 2-го круга/)
    expect(planCast(wizard, { spellId: 'fire-bolt', slotLevel: 1 }, rules)).toMatch(/заговор/)
  })

  it('ритуал — без ячейки (Волшебник — прямо из книги)', () => {
    expect(planCast(wizard, { spellId: 'identify', ritual: true }, rules)).toMatchObject({ slotLevel: null, ritual: true })
    expect(planCast(wizard, { spellId: 'magic-missile', ritual: true }, rules)).toMatch(/нельзя сотворить ритуалом/)
  })

  it('«Посвящённый в магию»: раз бесплатно, потом — ячейкой', () => {
    const subject = hero({
      classId: 'fighter',
      feats: ['magic-initiate'],
      magic: { cantrips: [], prepared: [], slotsUsed: {}, initiate: { list: 'wizard', ability: 'int', cantrips: ['fire-bolt', 'light'], spell: 'sleep' } },
    })
    const first = planCast(subject, { spellId: 'sleep' }, rules)
    if (typeof first === 'string') throw new Error(first)
    expect(first).toMatchObject({ slotLevel: null, freeKey: 'initiate:sleep' })
    const after = { ...subject, magic: spendCast(subject.magic, first) }
    expect(planCast(after, { spellId: 'sleep' }, rules)).toMatch(/нет свободных ячеек/)
    expect(knownSpells(after, rules).map((k) => k.spell.id)).toEqual(['fire-bolt', 'light', 'sleep'])
  })
})
