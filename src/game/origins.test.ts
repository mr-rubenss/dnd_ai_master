// Пропуски 1-го уровня по SRD 5.2.1: приёмы оружия, таинственные воззвания, языки, единый учёт применений
// (класс, вид, воззвания, бесплатные сотворения), «Одарённый» с инструментами, повторные черты.
import { describe, expect, it } from 'vitest'
import { defaultAdventure, itemCatalog, locations, rulesData as rules, startingSheet } from '../data'
import type { AiToolCall } from '../ai/types'
import type { Character } from '../types/character'
import type { StoryEvent, StoryState } from '../types/story'
import { buildCharacterSheet, chooseClass, chooseSpecies, emptyDraft, featChoiceCount, featToolOptions, stepProblems, type CreationDraft } from './creation'
import { featureNames, featureResources, limitedUses } from './features'
import { availableInvocations, invocationCount, invocationProblems, needsInvocationChoice } from './invocations'
import { knownLanguages, languageChoiceProblems, languageProblems, needsLanguageChoice, splitLanguages } from './languages'
import { allInitiateProblems, emptySpellChoice, innateSpells, planCast, spendCast } from './magic'
import { executeTool } from './masterTools'
import { applySheetCompletion, needsSheetCompletion, sheetNeeds } from './sheetCompletion'
import { applyAction, checkAction, ENGINE, makeAction, MASTER, newStorySeed, player } from './storyActions'
import { restEvents } from './rest'
import { changeList, ledgerOf, turnDelta } from './turnChanges'
import { masteryChangeProblem, masteryCount, masteryOptions, masteryProblems, needsMasteryChoice } from './weaponMastery'

const base = (patch: Partial<Character>): Character => ({ ...structuredClone(startingSheet.character), feats: [], ...patch })
const seed = (character: Character) =>
  newStorySeed({ id: 's', title: 'Т', tone: 'detective', adventure: defaultAdventure, locations, party: [{ character, inventory: startingSheet.inventory }], now: 1 })
const ctx = { catalog: itemCatalog, rules }
const act = (s: StoryState, e: StoryEvent, author = player(s.party[0].heroId)) => {
  const a = makeAction(s.id, 1, e, author, 1, 'x')
  const reason = checkAction(s, a, ctx)
  return { reason, state: reason ? s : applyAction(s, a) }
}
const ids = (list: { id: string }[]) => list.map((x) => x.id)

describe('приёмы оружия (Weapon Mastery)', () => {
  it('число видов по таблице класса: воин 3 → 4 на 4-м уровне, варвар 2, плут 2', () => {
    expect(masteryCount({ classId: 'fighter', level: 1 }, rules)).toBe(3)
    expect(masteryCount({ classId: 'fighter', level: 4 }, rules)).toBe(4)
    expect(masteryCount({ classId: 'fighter', level: 16 }, rules)).toBe(6)
    expect(masteryCount({ classId: 'barbarian', level: 1 }, rules)).toBe(2)
    expect(masteryCount({ classId: 'barbarian', level: 10 }, rules)).toBe(4)
    expect(masteryCount({ classId: 'rogue', level: 1 }, rules)).toBe(2)
    expect(masteryCount({ classId: 'wizard', level: 1 }, rules)).toBe(0)
  })

  it('варвар — только рукопашное оружие; плут — простое и воинское фехтовальное или лёгкое; воин — любое', () => {
    const barbarian = ids(masteryOptions({ classId: 'barbarian' }, rules))
    expect(barbarian).toContain('greataxe')
    expect(barbarian).not.toContain('longbow')
    expect(barbarian).not.toContain('dart')
    const rogue = ids(masteryOptions({ classId: 'rogue' }, rules))
    expect(rogue).toEqual(expect.arrayContaining(['rapier', 'shortsword', 'shortbow', 'dagger', 'hand-crossbow']))
    expect(rogue).not.toContain('greatsword')
    expect(rogue).not.toContain('longbow')
    // Все 38 видов оружия SRD — в справочнике, у каждого приём.
    expect(masteryOptions({ classId: 'fighter' }, rules)).toHaveLength(38)
  })

  it('проверка выбора и смена после долгого отдыха: воин — один вид, плут — весь выбор', () => {
    const fighter = { classId: 'fighter', level: 1 }
    expect(masteryProblems(fighter, ['greatsword', 'flail'], rules)).toEqual(['Приёмы оружия: выберите 3 (выбрано 2)'])
    expect(masteryProblems({ classId: 'barbarian', level: 1 }, ['greataxe', 'longbow'], rules)).toEqual([
      'Приёмы оружия: «Длинный лук» — не простое или воинское рукопашное оружие',
    ])
    const done = { ...fighter, weaponMasteries: ['greatsword', 'flail', 'javelin'] }
    expect(needsMasteryChoice(done, rules)).toBe(false)
    expect(masteryChangeProblem(done, ['greatsword', 'flail', 'spear'], rules)).toBe('Приёмы оружия меняются после долгого отдыха.')
    const rested = { ...done, masterySwapReady: true }
    expect(masteryChangeProblem(rested, ['greatsword', 'flail', 'spear'], rules)).toBeNull()
    expect(masteryChangeProblem(rested, ['greatsword', 'maul', 'spear'], rules)).toBe('После долгого отдыха можно сменить только один вид оружия.')
    const rogue = { classId: 'rogue', level: 1, weaponMasteries: ['dagger', 'shortbow'], masterySwapReady: true }
    expect(masteryChangeProblem(rogue, ['rapier', 'scimitar'], rules)).toBeNull()
  })

  it('долгий отдых разрешает смену, событие её записывает и снимает разрешение; короткий — нет', () => {
    let s = seed(base({}))
    const heroId = s.party[0].heroId
    expect(act(s, { type: 'weaponMasteriesChosen', heroId, weapons: ['greatsword', 'flail', 'spear'] }).reason).toBe('Приёмы оружия меняются после долгого отдыха.')
    const short = restEvents(s, 'short', {}, { rules, now: () => 1, newId: () => 'r' })
    expect(short.at(-1)).toMatchObject({ type: 'restCompleted', heroes: [{ heroId }] })
    expect((short.at(-1) as { heroes: { masterySwap?: boolean }[] }).heroes[0].masterySwap).toBeUndefined()
    for (const e of restEvents(s, 'long', {}, { rules, now: () => 1, newId: () => 'r' })) s = act(s, e, ENGINE).state
    expect(s.party[0].character.masterySwapReady).toBe(true)
    s = act(s, { type: 'weaponMasteriesChosen', heroId, weapons: ['greatsword', 'flail', 'spear'] }).state
    expect(s.party[0].character.weaponMasteries).toEqual(['greatsword', 'flail', 'spear'])
    expect(s.party[0].character.masterySwapReady).toBeUndefined()
    expect(act(s, { type: 'weaponMasteriesChosen', heroId, weapons: ['greatsword', 'flail', 'javelin'] }).reason).toBe('Приёмы оружия меняются после долгого отдыха.')
  })
})

describe('языки', () => {
  it('Общий + два обычных; Плут — ещё один из любых к «Воровскому жаргону»; Друид знает «Друидический»', () => {
    expect(languageChoiceProblems('fighter', ['elvish', 'orc'], [], rules)).toEqual([])
    expect(languageChoiceProblems('fighter', ['elvish', 'abyssal'], [], rules)).toContain('Языки: два — из таблицы обычных (Общий и так известен)')
    expect(languageChoiceProblems('rogue', ['elvish', 'orc'], [], rules)).toEqual(['Язык от класса: выберите 1 (выбрано 0)'])
    expect(languageChoiceProblems('rogue', ['elvish', 'orc'], ['infernal'], rules)).toEqual([])
    expect(knownLanguages('rogue', ['elvish', 'orc', 'infernal'], rules)).toEqual(['common', 'thieves-cant', 'elvish', 'orc', 'infernal'])
    expect(knownLanguages('druid', ['elvish', 'orc'], rules)).toEqual(['common', 'druidic', 'elvish', 'orc'])
  })

  it('полный список героя: проверка и разбор обратно на выбор', () => {
    expect(languageProblems('druid', ['common', 'druidic', 'elvish', 'orc'], rules)).toEqual([])
    expect(languageProblems('druid', ['common', 'elvish', 'orc'], rules)).toEqual(['Нет языка от класса: Друидический'])
    expect(languageProblems('fighter', ['common', 'elvish', 'orc', 'giant'], rules)).toEqual(['Языков больше, чем положено'])
    expect(languageProblems('fighter', ['elvish', 'orc'], rules)).toEqual(['Общий язык знают все'])
    expect(splitLanguages('rogue', ['common', 'thieves-cant', 'elvish', 'orc', 'goblin'], rules)).toEqual({ standard: ['elvish', 'orc'], extra: ['goblin'] })
    expect(needsLanguageChoice(base({ languages: undefined }), rules)).toBe(true)
    expect(needsLanguageChoice(startingSheet.character, rules)).toBe(false)
  })

  it('старый герой: событие languagesChosen — только пока языки не выбраны', () => {
    const old = base({ languages: undefined })
    let s = seed(old)
    expect(act(s, { type: 'languagesChosen', heroId: old.id, languages: ['common', 'elvish'] }).reason).toBe('Языки: выберите 2 из обычных (выбрано 1)')
    s = act(s, { type: 'languagesChosen', heroId: old.id, languages: ['common', 'elvish', 'dwarvish'] }).state
    expect(s.party[0].character.languages).toEqual(['common', 'elvish', 'dwarvish'])
    expect(act(s, { type: 'languagesChosen', heroId: old.id, languages: ['common', 'elvish', 'orc'] }).reason).toBe('Языки этого героя уже выбраны.')
  })
})

describe('таинственные воззвания', () => {
  const warlock = (patch: Partial<Character> = {}) =>
    base({ classId: 'warlock', className: 'Колдун', magic: { cantrips: ['eldritch-blast', 'chill-touch'], prepared: ['hex', 'charm-person'], slotsUsed: {} }, ...patch })

  it('число по уровням (1, 3, … 10) и требования: на 1-м уровне — без уровня и без зависимостей', () => {
    expect(invocationCount({ classId: 'warlock', level: 1 }, rules)).toBe(1)
    expect(invocationCount({ classId: 'warlock', level: 2 }, rules)).toBe(3)
    expect(invocationCount({ classId: 'warlock', level: 18 }, rules)).toBe(10)
    expect(invocationCount({ classId: 'fighter', level: 1 }, rules)).toBe(0)
    expect(ids(availableInvocations(warlock(), [], rules)).sort()).toEqual(['armor-of-shadows', 'eldritch-mind', 'pact-of-the-blade', 'pact-of-the-chain', 'pact-of-the-tome'])
    // 5-й уровень: «Жаждущий клинок» требует «Договора клинка».
    expect(ids(availableInvocations(warlock({ level: 5 }), [], rules))).not.toContain('thirsting-blade')
    expect(ids(availableInvocations(warlock({ level: 5 }), [{ id: 'pact-of-the-blade' }], rules))).toContain('thirsting-blade')
    // «Мучительный взрыв» — заговор с уроном («Мистический заряд» есть).
    expect(ids(availableInvocations(warlock({ level: 2 }), [], rules))).toContain('agonizing-blast')
    expect(ids(availableInvocations(warlock({ level: 2, magic: { cantrips: ['mage-hand', 'prestidigitation'], prepared: [], slotsUsed: {} } }), [], rules))).not.toContain('agonizing-blast')
  })

  it('проверка выбора: число, требования, «Договор гримуара» — 3 заговора и 2 ритуала, ещё не подготовленные', () => {
    const c = warlock()
    expect(invocationProblems(c, [], rules)).toEqual(['Таинственные воззвания: выберите 1 (выбрано 0)'])
    expect(invocationProblems(c, [{ id: 'devils-sight' }], rules)).toEqual(['«Дьявольское зрение» — с 2-го уровня колдуна'])
    expect(invocationProblems(c, [{ id: 'pact-of-the-tome' }], rules)).toContain('«Договор гримуара»: выберите 3 заговора (выбрано 0)')
    expect(invocationProblems(c, [{ id: 'pact-of-the-tome', cantrips: ['eldritch-blast', 'light', 'guidance'], rituals: ['detect-magic', 'find-familiar'] }], rules)).toEqual([
      '«Договор гримуара»: заговоры — разные и ещё не подготовленные',
    ])
    expect(invocationProblems(c, [{ id: 'pact-of-the-tome', cantrips: ['guidance', 'light', 'druidcraft'], rituals: ['detect-magic', 'magic-missile'] }], rules)).toEqual([
      '«Договор гримуара»: ритуалы — разные заклинания 1-го круга с пометкой «ритуал», ещё не подготовленные',
    ])
    expect(invocationProblems(c, [{ id: 'pact-of-the-tome', cantrips: ['guidance', 'light', 'druidcraft'], rituals: ['detect-magic', 'find-familiar'] }], rules)).toEqual([])
    expect(needsInvocationChoice(c, rules)).toBe(true)
    expect(needsSheetCompletion(c, rules)).toBe(true)
  })

  it('«Доспех теней» — «Доспехи мага» без ячейки сколько угодно; книга гримуара — заклинания колдуна', () => {
    const shadows = warlock({ invocations: [{ id: 'armor-of-shadows' }] })
    const armor = innateSpells(shadows, rules).find((s) => s.spellId === 'mage-armor')!
    expect(armor).toMatchObject({ source: 'invocation', ability: 'cha', atWill: true, freeMax: null })
    const plan = planCast({ ...shadows }, { spellId: 'mage-armor' }, rules)
    expect(plan).toMatchObject({ slotLevel: null, freeKey: 'atwill:armor-of-shadows:mage-armor' })
    // Сотворение «сколько угодно» не считается.
    const magic = spendCast(shadows.magic, plan as { slotLevel: null; freeKey: string })
    expect(magic.freeUsed).toBeUndefined()
    const tome = warlock({ invocations: [{ id: 'pact-of-the-tome', cantrips: ['guidance', 'light', 'druidcraft'], rituals: ['detect-magic', 'find-familiar'] }] })
    expect(planCast(tome, { spellId: 'find-familiar', ritual: true }, rules)).toMatchObject({ ritual: true, slotLevel: null })
    expect(planCast(tome, { spellId: 'find-familiar' }, rules)).toMatchObject({ slotLevel: 1 })
    expect(planCast(tome, { spellId: 'guidance' }, rules)).toMatchObject({ slotLevel: null, freeKey: null })
  })

  it('старый колдун: «Дополните лист» — событие invocationsChosen', () => {
    const old = warlock()
    let s = seed(old)
    expect(act(s, { type: 'invocationsChosen', heroId: old.id, invocations: [{ id: 'witch-sight' }] }).reason).toBe('«Ведьмин взгляд» — с 15-го уровня колдуна')
    s = act(s, { type: 'invocationsChosen', heroId: old.id, invocations: [{ id: 'pact-of-the-chain' }] }).state
    expect(s.party[0].character.invocations).toEqual([{ id: 'pact-of-the-chain' }])
    expect(innateSpells(s.party[0].character, rules).some((x) => x.spellId === 'find-familiar' && x.atWill)).toBe(true)
  })
})

describe('единый учёт применений', () => {
  it('виды: оружие дыхания и «Знание камня» — по бонусу мастерства; «Драконий полёт» — с 5-го уровня', () => {
    const dragonborn = base({ speciesId: 'dragonborn', species: 'Драконорождённый', speciesOption: 'red' })
    const states = featureResources(dragonborn, rules)
    expect(states.map((r) => [r.resource.id, r.max, r.sourceName])).toEqual([
      ['second-wind', 2, 'Воин'],
      ['breath-weapon', 2, 'Драконорождённый (Красный)'],
    ])
    const at5 = featureResources({ ...dragonborn, level: 5 }, rules)
    expect(at5.find((r) => r.resource.id === 'breath-weapon')?.max).toBe(3)
    expect(at5.some((r) => r.resource.id === 'draconic-flight')).toBe(true)
    expect(featureResources(base({ speciesId: 'dwarf' }), rules).find((r) => r.resource.id === 'stonecunning')?.max).toBe(2)
  })

  it('орк: «Прилив адреналина» возвращается целиком коротким отдыхом, «Неутомимая стойкость» — только долгим', () => {
    const orc = base({ speciesId: 'orc', featureUses: { 'adrenaline-rush': 2, 'relentless-endurance': 1 } })
    const s = seed(orc)
    const short = restEvents(s, 'short', {}, { rules, now: () => 1, newId: () => 'r' }).at(-1) as { heroes: { resources: Record<string, number> }[] }
    expect(short.heroes[0].resources).toEqual({ 'adrenaline-rush': 2 })
    const long = restEvents(s, 'long', {}, { rules, now: () => 1, newId: () => 'r' }).at(-1) as { heroes: { resources: Record<string, number> }[] }
    expect(long.heroes[0].resources).toEqual({ 'adrenaline-rush': 2, 'relentless-endurance': 1 })
  })

  it('раздел «Умения»: умения класса и вида, бесплатные сотворения черт; восстановление подписано', () => {
    const c = base({
      speciesId: 'orc',
      feats: ['magic-initiate'],
      magic: { cantrips: [], prepared: [], slotsUsed: {}, freeUsed: { 'initiate:bless': 1 }, initiates: [{ list: 'cleric', ability: 'wis', cantrips: ['guidance', 'light'], spell: 'bless' }] },
    })
    const uses = limitedUses(c, rules)
    expect(uses.map((u) => [u.key, `${u.left}/${u.max}`, u.recovery])).toEqual([
      ['second-wind', '2/2', 'короткий отдых: +1, долгий — все'],
      ['adrenaline-rush', '2/2', 'короткий или долгий отдых'],
      ['relentless-endurance', '1/1', 'долгий отдых'],
      ['initiate:bless', '0/1', 'долгий отдых'],
    ])
    expect(featureNames(rules)['breath-weapon']).toBe('Оружие дыхания')
  })

  it('use_feature: оружие дыхания — урон броском движка и Сл спасброска; трата — в строке изменений', () => {
    const c = base({ speciesId: 'dragonborn', speciesOption: 'red', abilities: { ...startingSheet.character.abilities, con: 14 } })
    const s = seed(c)
    const call = (args: unknown): AiToolCall => ({ id: 'u', name: 'use_feature', arguments: args, rawArguments: JSON.stringify(args) })
    const rolls = [0.95]
    const tctx = { catalog: itemCatalog, rules, now: () => 1, newId: () => 'n', rng: () => rolls.shift() ?? 0.5 }
    const out = executeTool(s, call({ feature: 'Оружие дыхания' }), tctx)
    // 1к10 → 10; Сл 8 + 2 (ТЕЛ 14) + 2 (БМ) = 12.
    expect(out.result.message).toBe(
      'Ратибор применяет «Оружие дыхания» (осталось 1/2). Урон 10 (огнём) при провале, 5 при успехе. Цели делают спасбросок Ловкости Сл 12 — бросай их сам по правилам НПС.',
    )
    let after = s
    for (const e of out.events) after = applyAction(after, makeAction(s.id, 1, e.event, e.author, 1, 'x'))
    const delta = turnDelta(ledgerOf(s, itemCatalog), ledgerOf(after, itemCatalog))
    expect(changeList(delta, after, itemCatalog, new Map(), undefined, featureNames(rules)).map((x) => x.text)).toContain('−1 применение («Оружие дыхания»)')
    // Потрачено всё — отказ.
    const spent = seed(base({ speciesId: 'dragonborn', speciesOption: 'red', featureUses: { 'breath-weapon': 2 } }))
    expect(executeTool(spent, call({ feature: 'breath-weapon' }), tctx).result.error).toBe('«Оружие дыхания» у Ратибор потрачено (0/2) — восстанавливается: долгий отдых.')
  })

  it('«Неутомимая стойкость» — только на 0 хитов: герой остаётся с 1 хитом', () => {
    const call = (args: unknown): AiToolCall => ({ id: 'u', name: 'use_feature', arguments: args, rawArguments: JSON.stringify(args) })
    const tctx = { catalog: itemCatalog, rules, now: () => 1, newId: () => 'n' }
    expect(executeTool(seed(base({ speciesId: 'orc' })), call({ feature: 'relentless-endurance' }), tctx).result.error).toMatch(/срабатывает, когда хиты опускаются до 0/)
    const down = seed(base({ speciesId: 'orc', hp: 0, conditions: [{ id: 'unconscious' }] }))
    const out = executeTool(down, call({ feature: 'relentless-endurance' }), tctx)
    let after = down
    for (const e of out.events) after = applyAction(after, makeAction(down.id, 1, e.event, e.author, 1, 'x'))
    expect(after.party[0].character.hp).toBe(1)
    expect(after.party[0].character.conditions).toEqual([])
    expect(after.party[0].character.featureUses).toEqual({ 'relentless-endurance': 1 })
  })
})

describe('«Одарённый» и повторные черты', () => {
  /** Человек-воин; предыстория — своя, с чертой «Одарённый», чтобы взять её ещё и «Разносторонностью». */
  function humanFighter(patch: Partial<CreationDraft> = {}): CreationDraft {
    let d: CreationDraft = { ...chooseClass(emptyDraft(), 'fighter'), fightingStyle: 'defense', weaponMasteries: ['greatsword', 'flail', 'javelin'] }
    d = { ...d, backgroundId: 'soldier', bonusMode: 'one-one-one', backgroundTool: 'dice-set' }
    d = { ...chooseSpecies(d, 'human'), originFeat: 'skilled', languages: ['elvish', 'orc'] }
    d = { ...d, assignment: { str: 0, dex: 1, con: 2, int: 3, wis: 4, cha: 5 }, classSkills: ['perception', 'survival'], speciesSkills: ['insight'] }
    return { ...d, classEquipment: 'A', backgroundEquipment: 'A', name: 'Ёрш', ...patch }
  }

  it('три выбора в любом сочетании навыков и инструментов; инструмент — которым ещё не владеет', () => {
    const d = humanFighter({ featSkills: ['arcana'], featTools: ['lute', 'smiths-tools'] })
    expect(featChoiceCount(d, rules)).toBe(3)
    expect(stepProblems('skills', d, rules)).toEqual([])
    expect(featToolOptions(d, rules)).not.toContain('dice-set')
    expect(stepProblems('skills', { ...d, featTools: ['dice-set', 'lute'] }, rules)).toContain(
      'Черта «Одарённый»: инструмент — из справочника, без повторов и которым вы ещё не владеете',
    )
    expect(stepProblems('skills', { ...d, featSkills: ['arcana', 'history'] }, rules)).toContain('Черта «Одарённый»: выберите 1 (выбрано 2)')
    const sheet = buildCharacterSheet(d, rules, itemCatalog, 'h')
    expect(sheet.character.proficiencies.tools).toEqual(expect.arrayContaining(['dice-set', 'lute', 'smiths-tools']))
    expect(sheet.character.proficiencies.skills.arcana).toBe('proficient')
  })

  it('неповторяемая черта второй раз — нельзя; «Одарённый» дважды — шесть выборов', () => {
    const twice = humanFighter({ originFeat: 'savage-attacker' })
    expect(stepProblems('species', twice, rules)).toContain('Эту черту уже даёт предыстория — выберите другую')
    const custom = { ...humanFighter(), backgroundId: 'custom', customBackground: { ...humanFighter().customBackground, feat: 'skilled' } }
    expect(featChoiceCount(custom, rules)).toBe(6)
  })

  it('«Посвящённый в магию» дважды (Мудрец + Разносторонность): разные списки, у каждого свои заклинания', () => {
    let d: CreationDraft = { ...chooseClass(emptyDraft(), 'fighter'), fightingStyle: 'defense', weaponMasteries: ['greatsword', 'flail', 'javelin'] }
    d = { ...d, backgroundId: 'sage', bonusMode: 'one-one-one' }
    d = { ...chooseSpecies(d, 'human'), originFeat: 'magic-initiate', languages: ['elvish', 'orc'] }
    d = { ...d, assignment: { str: 0, dex: 1, con: 2, int: 3, wis: 4, cha: 5 }, classSkills: ['perception', 'survival'], speciesSkills: ['insight'] }
    d = { ...d, classEquipment: 'A', backgroundEquipment: 'A', name: 'Велимир' }
    expect(stepProblems('species', d, rules)).toEqual([])
    const wizard = { list: 'wizard' as const, ability: null, cantrips: ['fire-bolt', 'light'], spell: 'sleep' }
    const same = { ...emptySpellChoice(), initiates: [wizard, { ...wizard, cantrips: ['mage-hand', 'ray-of-frost'], spell: 'shield' }] }
    expect(stepProblems('spells', { ...d, spells: same }, rules)).toContain('«Посвящённый в магию» взят дважды — каждый раз с другим списком заклинаний')
    const spells = { ...emptySpellChoice(), initiates: [wizard, { list: 'cleric' as const, ability: 'wis' as const, cantrips: ['guidance', 'sacred-flame'], spell: 'bless' }] }
    expect(stepProblems('spells', { ...d, spells }, rules)).toEqual([])
    const { character } = buildCharacterSheet({ ...d, spells }, rules, itemCatalog, 'v')
    expect(character.feats).toEqual(['magic-initiate', 'magic-initiate', 'defense'])
    expect(character.magic?.initiates).toHaveLength(2)
    const keys = innateSpells(character, rules).filter((s) => s.freeMax === 1).map((s) => s.key)
    expect(keys).toEqual(['initiate:sleep', 'initiate2:bless'])
    expect(allInitiateProblems(character, character.magic, rules)).toEqual([])
    // Второй экземпляр — без выбора: нужно дополнить.
    const one = { ...character, magic: { ...character.magic!, initiates: [character.magic!.initiates![0]] } }
    expect(allInitiateProblems(one, one.magic, rules)).toEqual(['«Посвящённый в магию»: выберите заклинания для каждой из 2 черт'])
  })
})

describe('«Дополните лист» — всё сразу', () => {
  it('старый воин без приёмов и языков: что нужно и как применяется', () => {
    const old = base({ weaponMasteries: undefined, languages: undefined })
    expect(sheetNeeds(old, rules)).toEqual({ order: false, spells: false, masteries: true, languages: true, invocations: false })
    expect(applySheetCompletion(old, { weaponMasteries: ['greatsword', 'flail', 'javelin'] }, rules)).toEqual({ reason: 'Лист ещё не дополнен.' })
    const result = applySheetCompletion(old, { weaponMasteries: ['greatsword', 'flail', 'javelin'], languages: ['common', 'elvish', 'orc'] }, rules)
    expect('character' in result && result.character.languages).toEqual(['common', 'elvish', 'orc'])
    expect(applySheetCompletion(startingSheet.character, { languages: ['common', 'elvish', 'orc'] }, rules)).toEqual({ reason: 'Языки уже выбраны.' })
  })

  it('MASTER не выбирает за игрока', () => {
    const old = base({ languages: undefined })
    expect(act(seed(old), { type: 'languagesChosen', heroId: old.id, languages: ['common', 'elvish', 'orc'] }, MASTER).reason).toBe('Языки выбирает игрок.')
  })
})
