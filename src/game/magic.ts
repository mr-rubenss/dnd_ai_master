// Магия героя по SRD 5.2: характеристика заклинаний, Сл спасброска и бонус атаки, ячейки по кругам (у Колдуна —
// магия договора), заговоры и подготовленные заклинания по таблицам классов 2024, книга Волшебника, врождённые
// заклинания вида и черты «Посвящённый в магию». Что выбрал игрок и что потрачено — Character.magic; всё остальное
// считается здесь из данных правил. Чистые функции.
import { abilityModifier, proficiencyBonus, type Ability, type AbilityScores } from '../engine/abilities'
import type { Character } from '../types/character'
import type { RulesData } from '../types/rules'
import {
  INITIATE_LISTS,
  INNATE_ABILITIES,
  type CharacterMagic,
  type ClassSpellcasting,
  type InitiateList,
  type InitiateMagic,
  type SpellDefinition,
} from '../types/spells'

/** Что нужно правилам магии из данных игры. */
/** Правила героя целиком: классы, виды, черты, заклинания, языки, воззвания и справочник предметов (оружие для приёмов). */
export type MagicRules = Pick<RulesData, 'classes' | 'species' | 'backgrounds' | 'feats' | 'spells' | 'spellSlots' | 'invocations' | 'languages' | 'catalog'>

/** Черта «Посвящённый в магию». */
export const MAGIC_INITIATE = 'magic-initiate'
/** Черта даёт: 2 заговора и 1 заклинание 1-го круга, раз в долгий отдых — без ячейки. */
export const INITIATE_CANTRIPS = 2

/** Что о герое нужно правилам магии. */
export type MagicSubject = Pick<Character, 'classId' | 'level' | 'abilities' | 'feats' | 'speciesId' | 'speciesOption' | 'backgroundId' | 'magic' | 'classOrder'> &
  Partial<Pick<Character, 'invocations'>>

const levelIndex = (level: number) => Math.min(20, Math.max(1, level)) - 1

export const classSpellcasting = (classId: string, rules: MagicRules): ClassSpellcasting | undefined => rules.classes[classId]?.spellcasting

// ---------- Числа: характеристика, Сл, бонус атаки ----------

export interface SpellcastingStats {
  ability: Ability
  modifier: number
  /** Сл спасброска: 8 + модификатор + бонус мастерства. */
  saveDc: number
  /** Бонус атаки заклинанием: модификатор + бонус мастерства. */
  attackBonus: number
}

export function spellcastingStats(subject: { abilities: AbilityScores; level: number }, ability: Ability): SpellcastingStats {
  const modifier = abilityModifier(subject.abilities[ability])
  const pb = proficiencyBonus(subject.level)
  return { ability, modifier, saveDc: 8 + modifier + pb, attackBonus: modifier + pb }
}

/** Лучшая из Инт/Мдр/Хар — по умолчанию для врождённых заклинаний. */
export function bestInnateAbility(abilities: AbilityScores): Ability {
  return [...INNATE_ABILITIES].sort((a, b) => abilities[b] - abilities[a])[0]
}

// ---------- Ячейки ----------

/** Ячеек каждого круга всего (круг → число). Колдун — ячейки магии договора одного круга. */
export function slotTotals(classId: string, level: number, rules: MagicRules): Record<number, number> {
  const sc = classSpellcasting(classId, rules)
  if (!sc) return {}
  const i = levelIndex(level)
  if (sc.progression === 'pact') return { [rules.spellSlots.pact.level[i]]: rules.spellSlots.pact.slots[i] }
  const row = rules.spellSlots[sc.progression][i] ?? []
  return Object.fromEntries(row.map((n, k) => [k + 1, n] as const).filter(([, n]) => n > 0))
}

export interface SlotState {
  level: number
  total: number
  used: number
  left: number
  /** Ячейки магии договора (восстанавливаются на коротком отдыхе). */
  pact: boolean
}

/** Ячейки героя по кругам: всего, потрачено, осталось. */
export function spellSlots(subject: MagicSubject, rules: MagicRules): SlotState[] {
  const pact = classSpellcasting(subject.classId, rules)?.progression === 'pact'
  return Object.entries(slotTotals(subject.classId, subject.level, rules)).map(([k, total]) => {
    const level = Number(k)
    const used = Math.min(total, subject.magic?.slotsUsed[k] ?? 0)
    return { level, total, used, left: total - used, pact }
  })
}

// ---------- Лимиты класса ----------

export interface SpellLimits {
  cantrips: number
  prepared: number
  /** Сколько заклинаний в книге (Волшебник), иначе 0. */
  spellbook: number
  /** Самый высокий круг, на котором у героя есть ячейки. */
  maxLevel: number
}

/** Лимиты по таблице класса; order — выбранный порядок (Чудотворец и Маг знают на один заговор больше). */
export function spellLimits(classId: string, level: number, rules: MagicRules, order?: string | null): SpellLimits {
  const sc = classSpellcasting(classId, rules)
  if (!sc) return { cantrips: 0, prepared: 0, spellbook: 0, maxLevel: 0 }
  const i = levelIndex(level)
  const levels = Object.keys(slotTotals(classId, level, rules)).map(Number)
  const book = sc.spellbook ? sc.spellbook.start + sc.spellbook.perLevel * i : 0
  const extra = rules.classes[classId]?.order?.options.find((o) => o.id === order)?.extraCantrip ? 1 : 0
  return { cantrips: sc.cantrips[i] + extra, prepared: sc.prepared[i], spellbook: book, maxLevel: Math.max(0, ...levels) }
}

/** Заклинания, всегда подготовленные умениями класса («Друидический язык», «Избранный враг»). */
export const featureSpellIds = (classId: string, rules: MagicRules) => (rules.classes[classId]?.featureSpells ?? []).map((f) => f.spellId)

/** Заклинания списка класса заданного круга (по названию). */
export function classSpellList(listId: string, spellLevel: number, rules: MagicRules): SpellDefinition[] {
  return Object.values(rules.spells)
    .filter((s) => s.level === spellLevel && s.classes.includes(listId))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}

// ---------- Врождённые заклинания: вид и «Посвящённый в магию» ----------

export type InnateSource = 'species' | 'initiate' | 'feature' | 'invocation'

export interface InnateSpell {
  spellId: string
  source: InnateSource
  /** Откуда — для игрока: «Тифлинг», «Посвящённый в магию (жрец)». */
  sourceName: string
  ability: Ability
  /** Бесплатных сотворений на долгий отдых; null — без ограничений (заговор). */
  freeMax: number | null
  freeUsed: number
  /** Ключ в magic.freeUsed. */
  key: string
  /** Без ячейки сколько угодно раз («Доспех теней», «Договор цепи»). */
  atWill?: boolean
}

export const INITIATE_LIST_NAMES: Record<InitiateList, string> = { cleric: 'жрец', druid: 'друид', wizard: 'волшебник' }

export const freeKey = (source: InnateSource, spellId: string) => `${source}:${spellId}`
/** Ключ бесплатного сотворения экземпляра «Посвящённого в магию»: первый — initiate:…, второй — initiate2:… */
export const initiateKey = (index: number, spellId: string) => (index === 0 ? freeKey('initiate', spellId) : `initiate${index + 1}:${spellId}`)
/** Ключи сотворений «сколько угодно» не считаются. */
export const AT_WILL_PREFIX = 'atwill:'

/** Врождённые заклинания вида (с учётом ветви). */
export function speciesSpellGrants(speciesId: string, option: string | null, rules: MagicRules) {
  const species = rules.species[speciesId]
  if (!species) return []
  const branch = species.choice?.options.find((o) => o.id === option)
  return [...(species.innateSpells ?? []), ...(branch?.innateSpells ?? [])]
}

/** Есть ли у героя черта «Посвящённый в магию». */
export const hasInitiate = (subject: Pick<Character, 'feats'>) => subject.feats.includes(MAGIC_INITIATE)
/** Сколько раз взята черта «Посвящённый в магию» (повторяемая: предыстория + «Разносторонность» человека). */
export const initiateCount = (subject: Pick<Character, 'feats'>) => subject.feats.filter((f) => f === MAGIC_INITIATE).length

/** Экземпляры «Посвящённого в магию» в магии героя (старые листы — одно поле initiate). */
export const initiatesOf = (magic: CharacterMagic | undefined): InitiateMagic[] => magic?.initiates ?? (magic?.initiate ? [magic.initiate] : [])

/** Список «Посвящённого в магию», заданный предысторией (Послушник — жрец, Мудрец — волшебник); null — на выбор. */
export function fixedInitiateList(backgroundId: string, rules: MagicRules): InitiateList | null {
  const bg = rules.backgrounds[backgroundId]
  return bg?.feat === MAGIC_INITIATE ? (bg.featSpellList ?? null) : null
}

/** Список, заданный для экземпляра черты: первый экземпляр — от предыстории (если она его задаёт). */
export const fixedListFor = (index: number, backgroundId: string, rules: MagicRules) => (index === 0 ? fixedInitiateList(backgroundId, rules) : null)

export function innateSpells(subject: MagicSubject, rules: MagicRules): InnateSpell[] {
  const result: InnateSpell[] = []
  const used = subject.magic?.freeUsed ?? {}
  const pb = proficiencyBonus(subject.level)
  const species = rules.species[subject.speciesId]
  const speciesAbility = subject.magic?.speciesAbility ?? bestInnateAbility(subject.abilities)
  for (const grant of speciesSpellGrants(subject.speciesId, subject.speciesOption, rules)) {
    const key = freeKey('species', grant.spellId)
    result.push({
      spellId: grant.spellId,
      source: 'species',
      sourceName: species?.name ?? subject.speciesId,
      ability: speciesAbility,
      freeMax: grant.uses === 'proficiency' ? pb : null,
      freeUsed: used[key] ?? 0,
      key,
    })
  }
  // Умения класса: заклинание всегда подготовлено; у «Избранного врага» — ещё и бесплатные сотворения.
  const sc = classSpellcasting(subject.classId, rules)
  for (const fs of rules.classes[subject.classId]?.featureSpells ?? []) {
    if (!sc) break
    const key = freeKey('feature', fs.spellId)
    const freeMax = fs.freeUses ? fs.freeUses[levelIndex(subject.level)] : null
    result.push({ spellId: fs.spellId, source: 'feature', sourceName: fs.feature, ability: sc.ability, freeMax, freeUsed: used[key] ?? 0, key })
  }
  initiatesOf(subject.magic)
    .slice(0, initiateCount(subject))
    .forEach((initiate, index) => {
      const sourceName = `Посвящённый в магию (${INITIATE_LIST_NAMES[initiate.list]})`
      for (const spellId of initiate.cantrips)
        result.push({ spellId, source: 'initiate', sourceName, ability: initiate.ability, freeMax: null, freeUsed: 0, key: initiateKey(index, spellId) })
      const key = initiateKey(index, initiate.spell)
      result.push({ spellId: initiate.spell, source: 'initiate', sourceName, ability: initiate.ability, freeMax: 1, freeUsed: used[key] ?? 0, key })
    })
  // Воззвания колдуна: заклинания без ячейки и книга «Договора гримуара» (заклинания колдуна — его характеристика).
  const warlockAbility = sc?.ability ?? 'cha'
  for (const choice of subject.invocations ?? []) {
    const inv = rules.invocations?.[choice.id]
    if (!inv) continue
    const sourceName = `Воззвание «${inv.name}»`
    if (inv.spell?.id && rules.spells[inv.spell.id]) {
      const spellId = inv.spell.id
      if (inv.spell.free === 'at-will')
        result.push({ spellId, source: 'invocation', sourceName, ability: warlockAbility, freeMax: null, freeUsed: 0, key: `${AT_WILL_PREFIX}${choice.id}:${spellId}`, atWill: true })
      else {
        const key = freeKey('invocation', spellId)
        result.push({ spellId, source: 'invocation', sourceName, ability: warlockAbility, freeMax: 1, freeUsed: used[key] ?? 0, key })
      }
    }
    if (inv.tome)
      for (const spellId of [...(choice.cantrips ?? []), ...(choice.rituals ?? [])])
        result.push({ spellId, source: 'invocation', sourceName, ability: warlockAbility, freeMax: null, freeUsed: 0, key: `tome:${spellId}` })
  }
  return result
}

// ---------- Кто владеет магией и что нужно выбрать ----------

/** Владеет ли герой магией: класс-заклинатель, черта или врождённые заклинания вида. */
export function hasMagic(subject: MagicSubject, rules: MagicRules): boolean {
  return Boolean(classSpellcasting(subject.classId, rules)) || hasInitiate(subject) || speciesSpellGrants(subject.speciesId, subject.speciesOption, rules).length > 0
}

/**
 * Нужно ли игроку выбрать заклинания: заклинатель без выбора (старое сохранение), выбор больше не сходится с правилами
 * (заклинание убрано из справочника, «Чудотворцу» положен ещё заговор) или «Посвящённый в магию» без выбора.
 */
export function needsSpellChoice(subject: MagicSubject, rules: MagicRules): boolean {
  const magic = subject.magic
  if (classSpellcasting(subject.classId, rules) && (!magic || classChoiceProblems(subject.classId, subject.level, magic, rules, subject.classOrder).length > 0)) return true
  if (hasInitiate(subject) && allInitiateProblems(subject, magic, rules).length > 0) return true
  return false
}

/** Пустая магия: ничего не выбрано и не потрачено. */
export const emptyMagic = (): CharacterMagic => ({ cantrips: [], prepared: [], slotsUsed: {} })

const dupes = (list: string[]) => new Set(list).size !== list.length

/** Проверка выбора заклинаний класса: число по таблице, заклинания из списка класса, книга Волшебника. */
export function classChoiceProblems(
  classId: string,
  level: number,
  magic: Pick<CharacterMagic, 'cantrips' | 'prepared' | 'spellbook'>,
  rules: MagicRules,
  order?: string | null,
): string[] {
  const sc = classSpellcasting(classId, rules)
  const problems: string[] = []
  if (!sc) {
    if (magic.cantrips.length || magic.prepared.length || magic.spellbook?.length) problems.push('У этого класса нет своих заклинаний.')
    return problems
  }
  const limits = spellLimits(classId, level, rules, order)
  const inList = (id: string, spellLevel: 'cantrip' | 'leveled') => {
    const s = rules.spells[id]
    return Boolean(s && s.classes.includes(classId) && (spellLevel === 'cantrip' ? s.level === 0 : s.level >= 1 && s.level <= limits.maxLevel))
  }
  if (magic.cantrips.length !== limits.cantrips) problems.push(`Заговоры: выберите ${limits.cantrips} (выбрано ${magic.cantrips.length})`)
  if (magic.cantrips.some((id) => !inList(id, 'cantrip'))) problems.push('Заговор не из списка класса')
  if (dupes(magic.cantrips)) problems.push('Заговор выбран дважды')
  if (sc.spellbook) {
    const book = magic.spellbook ?? []
    if (book.length !== limits.spellbook) problems.push(`Книга заклинаний: выберите ${limits.spellbook} (выбрано ${book.length})`)
    if (book.some((id) => !inList(id, 'leveled'))) problems.push('В книге заклинание не из списка волшебника')
    if (dupes(book)) problems.push('Заклинание в книге дважды')
    if (magic.prepared.some((id) => !book.includes(id))) problems.push('Подготовить можно только заклинания из книги')
  } else if (magic.spellbook?.length) problems.push('Книга заклинаний есть только у волшебника')
  problems.push(...preparedProblems(classId, level, magic.prepared, rules, magic.spellbook))
  return [...new Set(problems)]
}

/** Проверка подготовленных заклинаний: не больше лимита класса, из списка класса (у Волшебника — из книги). */
export function preparedProblems(classId: string, level: number, prepared: string[], rules: MagicRules, spellbook?: string[]): string[] {
  const sc = classSpellcasting(classId, rules)
  if (!sc) return prepared.length ? ['У этого класса нет своих заклинаний.'] : []
  const limits = spellLimits(classId, level, rules)
  const problems: string[] = []
  const always = featureSpellIds(classId, rules)
  for (const id of prepared) if (always.includes(id)) problems.push(`«${rules.spells[id]?.name ?? id}» и так всегда подготовлено — выберите другое`)
  if (prepared.length !== limits.prepared) problems.push(`Подготовленные заклинания: выберите ${limits.prepared} (выбрано ${prepared.length})`)
  for (const id of prepared) {
    const s = rules.spells[id]
    if (!s || s.level < 1 || !s.classes.includes(classId)) problems.push(`«${s?.name ?? id}» — не заклинание списка класса`)
    else if (s.level > limits.maxLevel) problems.push(`«${s.name}»: нет ячеек ${s.level}-го круга`)
    else if (sc.spellbook && !(spellbook ?? []).includes(id)) problems.push(`«${s.name}» нет в книге заклинаний`)
  }
  if (dupes(prepared)) problems.push('Заклинание подготовлено дважды')
  return problems
}

/** Проверка выбора «Посвящённого в магию»: список, характеристика, 2 заговора и 1 заклинание 1-го круга из списка. */
export function initiateProblems(initiate: InitiateMagic | undefined, fixedList: InitiateList | null, rules: MagicRules): string[] {
  if (!initiate) return ['«Посвящённый в магию»: выберите заклинания']
  const problems: string[] = []
  if (!(INITIATE_LISTS as readonly string[]).includes(initiate.list)) problems.push('«Посвящённый в магию»: выберите список заклинаний')
  else if (fixedList && initiate.list !== fixedList) problems.push(`«Посвящённый в магию»: предыстория даёт список «${INITIATE_LIST_NAMES[fixedList]}»`)
  if (!(INNATE_ABILITIES as readonly string[]).includes(initiate.ability)) problems.push('«Посвящённый в магию»: характеристика — Интеллект, Мудрость или Харизма')
  const of = (id: string, level: number) => rules.spells[id]?.level === level && rules.spells[id].classes.includes(initiate.list)
  if (initiate.cantrips.length !== INITIATE_CANTRIPS) problems.push(`«Посвящённый в магию»: выберите ${INITIATE_CANTRIPS} заговора (выбрано ${initiate.cantrips.length})`)
  else if (!initiate.cantrips.every((id) => of(id, 0)) || dupes(initiate.cantrips)) problems.push('«Посвящённый в магию»: заговоры — разные, из выбранного списка')
  if (!initiate.spell) problems.push('«Посвящённый в магию»: выберите заклинание 1-го круга')
  else if (!of(initiate.spell, 1)) problems.push('«Посвящённый в магию»: заклинание 1-го круга — из выбранного списка')
  return problems
}

/** Все экземпляры «Посвящённого в магию»: каждый проверен, списки разные (SRD: «a different spell list each time»). */
export function allInitiateProblems(subject: Pick<MagicSubject, 'feats' | 'backgroundId'>, magic: CharacterMagic | undefined, rules: MagicRules): string[] {
  const count = initiateCount(subject)
  const list = initiatesOf(magic)
  if (count === 0) return list.length ? ['Без черты «Посвящённый в магию» её заклинаний нет'] : []
  const problems: string[] = []
  if (list.length < count) problems.push(count > 1 ? `«Посвящённый в магию»: выберите заклинания для каждой из ${count} черт` : '«Посвящённый в магию»: выберите заклинания')
  if (list.length > count) problems.push('«Посвящённых в магию» больше, чем черт')
  list.slice(0, count).forEach((initiate, i) => {
    const prefix = count > 1 ? `${i + 1}-я черта: ` : ''
    problems.push(...initiateProblems(initiate, fixedListFor(i, subject.backgroundId, rules), rules).map((p) => prefix + p))
  })
  const lists = list.map((x) => x.list)
  if (new Set(lists).size !== lists.length) problems.push('«Посвящённый в магию» взят дважды — каждый раз с другим списком заклинаний')
  return problems
}

/** Полная проверка магии героя (выбор заклинаний при создании и для старых сохранений). */
export function magicProblems(subject: Omit<MagicSubject, 'magic'>, magic: CharacterMagic, rules: MagicRules): string[] {
  const problems = classChoiceProblems(subject.classId, subject.level, magic, rules, subject.classOrder)
  problems.push(...allInitiateProblems(subject, magic, rules))
  if (magic.speciesAbility !== undefined && !(INNATE_ABILITIES as readonly string[]).includes(magic.speciesAbility))
    problems.push('Характеристика заклинаний вида — Интеллект, Мудрость или Харизма')
  return problems
}

// ---------- Известные заклинания ----------

export interface KnownSpell {
  spell: SpellDefinition
  /** Класс, черта или вид. */
  source: 'class' | InnateSource
  sourceName: string
  ability: Ability
  /** У Волшебника — заклинание только в книге (не подготовлено). */
  inBookOnly?: boolean
  innate?: InnateSpell
}

/** Все заклинания героя: заговоры и подготовленные класса, книга, врождённые. */
export function knownSpells(subject: MagicSubject, rules: MagicRules): KnownSpell[] {
  const known: KnownSpell[] = []
  const sc = classSpellcasting(subject.classId, rules)
  const className = rules.classes[subject.classId]?.name ?? subject.classId
  const magic = subject.magic
  if (sc && magic) {
    const add = (id: string, inBookOnly = false) => {
      const spell = rules.spells[id]
      if (spell) known.push({ spell, source: 'class', sourceName: className, ability: sc.ability, ...(inBookOnly ? { inBookOnly } : {}) })
    }
    magic.cantrips.forEach((id) => add(id))
    magic.prepared.forEach((id) => add(id))
    for (const id of magic.spellbook ?? []) if (!magic.prepared.includes(id)) add(id, true)
  }
  for (const innate of innateSpells(subject, rules)) {
    const spell = rules.spells[innate.spellId]
    if (spell) known.push({ spell, source: innate.source, sourceName: innate.sourceName, ability: innate.ability, innate })
  }
  return known
}

// ---------- Сотворение ----------

export interface CastRequest {
  spellId: string
  /** Круг ячейки; нет — заговор, ритуал или бесплатное сотворение (если есть), иначе младшая свободная ячейка. */
  slotLevel?: number | null
  /** Сотворить как ритуал (на 10 минут дольше, без ячейки). */
  ritual?: boolean
}

export interface CastPlan {
  spell: SpellDefinition
  known: KnownSpell
  /** Потраченная ячейка или null. */
  slotLevel: number | null
  /** Бесплатное сотворение: ключ в magic.freeUsed. */
  freeKey: string | null
  ritual: boolean
  stats: SpellcastingStats
}

/**
 * Может ли герой сотворить заклинание и что на это уйдёт. Заговоры и ритуалы — без ячейки; врождённые — бесплатно,
 * пока есть сотворения; иначе — ячейка круга не ниже круга заклинания. Возвращает план или причину отказа.
 */
export function planCast(subject: MagicSubject & { name?: string }, request: CastRequest, rules: MagicRules): CastPlan | string {
  const spell = rules.spells[request.spellId]
  if (!spell) return `Заклинания «${request.spellId}» нет в справочнике.`
  const who = subject.name ?? 'Герой'
  const options = knownSpells(subject, rules).filter((k) => k.spell.id === spell.id)
  if (options.length === 0) return `${who} не знает заклинания «${spell.name}» (нет среди заговоров, подготовленных и врождённых).`
  const plan = (known: KnownSpell, slotLevel: number | null, key: string | null, ritual: boolean): CastPlan => ({
    spell,
    known,
    slotLevel,
    freeKey: key,
    ritual,
    stats: spellcastingStats(subject, known.ability),
  })
  if (spell.level === 0) {
    if (request.slotLevel) return `«${spell.name}» — заговор, ячейка не нужна.`
    return plan(options[0], null, null, false)
  }
  const castable = options.filter((k) => !k.inBookOnly)
  if (request.ritual) {
    if (!spell.ritual) return `«${spell.name}» нельзя сотворить ритуалом.`
    if (request.slotLevel) return 'Ритуал творится без ячейки — не указывай slot_level.'
    // Волшебник (Ритуальный адепт) творит ритуалы прямо из книги; остальные — подготовленные.
    return plan(castable[0] ?? options[0], null, null, true)
  }
  if (castable.length === 0) return `«${spell.name}» есть в книге заклинаний, но не подготовлено — подготовить можно после долгого отдыха (или сотворить ритуалом, если это ритуал).`
  const slots = spellSlots(subject, rules)
  if (request.slotLevel === undefined || request.slotLevel === null) {
    const free = castable.find((k) => k.innate && (k.innate.atWill || (k.innate.freeMax !== null && k.innate.freeUsed < k.innate.freeMax)))
    if (free) return plan(free, null, free.innate!.key, false)
    const slot = slots.find((s) => s.level >= spell.level && s.left > 0)
    if (!slot) {
      const left = slots.map((s) => `${s.level}-й круг: ${s.left}/${s.total}`).join(', ')
      return `У ${who} нет свободных ячеек для «${spell.name}»${left ? ` (${left})` : ''}${spell.ritual ? ' — но его можно сотворить ритуалом (ritual: true)' : ''}. Ячейки восстанавливаются после отдыха.`
    }
    return plan(castable.find((k) => k.source === 'class') ?? castable[0], slot.level, null, false)
  }
  const level = request.slotLevel
  if (!Number.isInteger(level) || level < spell.level) return `«${spell.name}» — заклинание ${spell.level}-го круга: ячейка не ниже ${spell.level}-го.`
  const slot = slots.find((s) => s.level === level)
  if (!slot) return `У ${who} нет ячеек ${level}-го круга${slots.length ? ` (есть: ${slots.map((s) => `${s.level}-й`).join(', ')})` : ''}.`
  if (slot.left === 0) return `Ячейки ${level}-го круга у ${who} потрачены (0/${slot.total}). Восстанавливаются после ${slot.pact ? 'короткого или долгого' : 'долгого'} отдыха.`
  return plan(castable.find((k) => k.source === 'class') ?? castable[0], level, null, false)
}

/** Магия после сотворения: потрачена ячейка или бесплатное сотворение. */
export function spendCast(magic: CharacterMagic | undefined, cast: { slotLevel: number | null; freeKey: string | null }): CharacterMagic {
  const base = magic ?? emptyMagic()
  if (cast.slotLevel) {
    const k = String(cast.slotLevel)
    return { ...base, slotsUsed: { ...base.slotsUsed, [k]: (base.slotsUsed[k] ?? 0) + 1 } }
  }
  if (cast.freeKey && !cast.freeKey.startsWith(AT_WILL_PREFIX)) return { ...base, freeUsed: { ...base.freeUsed, [cast.freeKey]: (base.freeUsed?.[cast.freeKey] ?? 0) + 1 } }
  return base
}

/**
 * Восстановление после отдыха. Долгий: все ячейки и бесплатные сотворения. Короткий: ячейки магии договора (Колдун).
 */
export function restoreMagic(magic: CharacterMagic, classId: string, rest: 'short' | 'long', rules: MagicRules): CharacterMagic {
  if (rest === 'long') return { ...magic, slotsUsed: {}, freeUsed: {} }
  return classSpellcasting(classId, rules)?.progression === 'pact' ? { ...magic, slotsUsed: {} } : magic
}

/** Правило класса о смене подготовленных заклинаний — подпись для игрока. */
export function swapRuleText(classId: string, rules: MagicRules): string {
  const sc = classSpellcasting(classId, rules)
  if (!sc) return ''
  if (sc.swap === 'long-rest-any')
    return sc.spellbook ? 'После долгого отдыха можно заново подготовить заклинания из книги.' : 'После долгого отдыха можно заново выбрать подготовленные заклинания из списка класса.'
  if (sc.swap === 'long-rest-one') return 'После долгого отдыха можно заменить одно подготовленное заклинание.'
  return 'При получении уровня можно заменить одно заклинание.'
}

// ---------- Выбор заклинаний игроком (создание персонажа и старые сохранения) ----------

/** Черновик выбора: шаг «Заклинания» и окно выбора для старых заклинателей. */
export interface SpellChoice {
  cantrips: string[]
  prepared: string[]
  /** Книга заклинаний (Волшебник). */
  spellbook: string[]
  /** «Посвящённый в магию» — по экземпляру черты. */
  initiates: InitiateChoice[]
  speciesAbility: Ability | null
}

/** Выбор одного экземпляра «Посвящённого в магию». */
export interface InitiateChoice {
  list: InitiateList | null
  ability: Ability | null
  cantrips: string[]
  spell: string | null
}

export const emptyInitiateChoice = (): InitiateChoice => ({ list: null, ability: null, cantrips: [], spell: null })

export const emptySpellChoice = (): SpellChoice => ({
  cantrips: [],
  prepared: [],
  spellbook: [],
  initiates: [],
  speciesAbility: null,
})

/** Что выбирает игрок: заклинания класса, черты, характеристику вида. */
export function spellChoiceNeeds(subject: Omit<MagicSubject, 'magic'>, rules: MagicRules) {
  return {
    classSpells: Boolean(classSpellcasting(subject.classId, rules)),
    initiate: hasInitiate(subject),
    initiateCount: initiateCount(subject),
    species: speciesSpellGrants(subject.speciesId, subject.speciesOption, rules).length > 0,
  }
}

/** Список экземпляра «Посвящённого в магию»: заданный предысторией или выбранный игроком. */
export const initiateListOf = (subject: Pick<MagicSubject, 'backgroundId'>, choice: SpellChoice, index: number, rules: MagicRules): InitiateList | null =>
  fixedListFor(index, subject.backgroundId, rules) ?? choice.initiates[index]?.list ?? null

/** Магия героя из выбора игрока (ничего не потрачено). */
export function magicFromChoice(subject: Omit<MagicSubject, 'magic'>, choice: SpellChoice, rules: MagicRules): CharacterMagic {
  const needs = spellChoiceNeeds(subject, rules)
  const magic: CharacterMagic = { cantrips: needs.classSpells ? [...choice.cantrips] : [], prepared: needs.classSpells ? [...choice.prepared] : [], slotsUsed: {} }
  if (needs.classSpells && classSpellcasting(subject.classId, rules)?.spellbook) magic.spellbook = [...choice.spellbook]
  if (needs.initiate)
    magic.initiates = Array.from({ length: needs.initiateCount }, (_, i) => {
      const c = choice.initiates[i] ?? emptyInitiateChoice()
      return {
        list: (initiateListOf(subject, choice, i, rules) ?? '') as InitiateList,
        ability: c.ability ?? bestInnateAbility(subject.abilities),
        cantrips: [...c.cantrips],
        spell: c.spell ?? '',
      }
    })
  if (needs.species) magic.speciesAbility = choice.speciesAbility ?? bestInnateAbility(subject.abilities)
  return magic
}

/** Выбор для окна «Выберите заклинания» из уже сохранённой магии (если что-то было). */
export function choiceFromMagic(magic: CharacterMagic | undefined): SpellChoice {
  if (!magic) return emptySpellChoice()
  return {
    cantrips: [...magic.cantrips],
    prepared: [...magic.prepared],
    spellbook: [...(magic.spellbook ?? [])],
    initiates: initiatesOf(magic).map((x) => ({ list: x.list ?? null, ability: x.ability ?? null, cantrips: [...x.cantrips], spell: x.spell || null })),
    speciesAbility: magic.speciesAbility ?? null,
  }
}

/** Записанное сотворение (событие spellCast): что потрачено. */
export interface CastRecord {
  spellId: string
  slotLevel: number | null
  freeKey: string | null
  ritual: boolean
}

/** Проверка записанного сотворения по правилам и листу героя. null — можно. */
export function castProblem(subject: MagicSubject & { name?: string }, cast: CastRecord, rules: MagicRules): string | null {
  const spell = rules.spells[cast.spellId]
  if (!spell) return `Заклинания «${cast.spellId}» нет в справочнике.`
  const known = knownSpells(subject, rules).filter((k) => k.spell.id === spell.id)
  if (known.length === 0) return `${subject.name ?? 'Герой'} не знает заклинания «${spell.name}».`
  const spent = [cast.slotLevel !== null, cast.freeKey !== null, cast.ritual].filter(Boolean).length
  if (spell.level === 0) return spent === 0 ? null : `«${spell.name}» — заговор: ячейка не тратится.`
  if (spent !== 1) return `«${spell.name}»: нужно одно — ячейка, бесплатное сотворение или ритуал.`
  if (cast.ritual) return spell.ritual ? null : `«${spell.name}» нельзя сотворить ритуалом.`
  if (!known.some((k) => !k.inBookOnly)) return `«${spell.name}» не подготовлено.`
  if (cast.freeKey !== null) {
    const innate = known.find((k) => k.innate?.key === cast.freeKey)?.innate
    if (innate?.atWill) return null
    if (!innate || innate.freeMax === null) return `У «${spell.name}» нет бесплатных сотворений.`
    return innate.freeUsed < innate.freeMax ? null : `Бесплатные сотворения «${spell.name}» потрачены — восстанавливаются после долгого отдыха.`
  }
  const slot = spellSlots(subject, rules).find((s) => s.level === cast.slotLevel)
  if (!slot || cast.slotLevel! < spell.level) return `Нет подходящей ячейки ${cast.slotLevel}-го круга для «${spell.name}».`
  return slot.left > 0 ? null : `Ячейки ${slot.level}-го круга потрачены.`
}

// ---------- Список заклинаний героя для ведущего ----------

/**
 * Запись заклинания для ведущего: название, id, круг и чем творится — «Малая иллюзия [minor-illusion; заговор]»,
 * «Волшебная стрела [magic-missile; 1-й круг; ячеек 1+ круга: 2]», «Разговор с животными [speak-with-animals;
 * 1-й круг; без ячейки 2/2]». По id ведущий зовёт cast_spell.
 */
export function spellEntryText(k: KnownSpell, slots: SlotState[]): string {
  const s = k.spell
  const parts = [s.id, s.level === 0 ? 'заговор' : `${s.level}-й круг`]
  if (s.level > 0) {
    if (k.innate && k.innate.freeMax !== null) parts.push(`без ячейки ${k.innate.freeMax - k.innate.freeUsed}/${k.innate.freeMax}`)
    else if (k.inBookOnly) parts.push(s.ritual ? 'не подготовлено — только ритуалом' : 'не подготовлено')
    else parts.push(`ячеек ${s.level}+ круга: ${slots.filter((sl) => sl.level >= s.level).reduce((n, sl) => n + sl.left, 0)}`)
    if (s.ritual && !k.inBookOnly) parts.push('ритуал')
  }
  if (s.concentration) parts.push('концентрация')
  return `${s.name} [${parts.join('; ')}]`
}

/** Все заклинания героя одной строкой (без повторов) — для ведущего и для отказа движка. */
export function castableSpellsText(subject: MagicSubject, rules: MagicRules): string {
  const slots = spellSlots(subject, rules)
  const seen = new Set<string>()
  const list = knownSpells(subject, rules).filter((k) => !seen.has(k.spell.id) && seen.add(k.spell.id))
  return list.length ? list.map((k) => spellEntryText(k, slots)).join(', ') : 'нет заклинаний'
}
