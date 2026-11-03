// Создание персонажа по правилам D&D 2024 (SRD 5.2). Чистые функции: черновик выборов игрока →
// проверка каждого шага → готовый лист персонажа. UI только показывает варианты и вызывает эти функции.
import { ABILITIES, abilityModifier, type Ability, type AbilityScores } from '../engine/abilities'
import type { Proficiencies } from '../engine/checks'
import { roll, type Rng, type RollResult } from '../engine/dice'
import { SKILLS, type SkillId } from '../engine/skills'
import type { CharacterSheet, Equipment, InventoryEntry } from '../types/character'
import type { ItemCatalog } from '../types/items'
import type { ClassDefinition, EquipmentOption, RulesData, SkillChoice } from '../types/rules'

export const CREATION_STEPS = [
  { id: 'class', title: 'Класс' },
  { id: 'background', title: 'Предыстория' },
  { id: 'species', title: 'Вид' },
  { id: 'abilities', title: 'Характеристики' },
  { id: 'skills', title: 'Навыки' },
  { id: 'equipment', title: 'Снаряжение' },
  { id: 'details', title: 'Имя и внешность' },
  { id: 'summary', title: 'Итог' },
] as const
export type CreationStep = (typeof CREATION_STEPS)[number]['id']

/** Стандартный набор значений характеристик. */
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const
export const MAX_SCORE = 20
export const MAX_NAME_LENGTH = 40

export type AbilityMethod = 'standard' | 'roll'
export type BonusMode = 'two-one' | 'one-one-one'

export interface CreationDraft {
  classId: string | null
  backgroundId: string | null
  /** Прибавки предыстории: +2 и +1 к двум характеристикам или +1 ко всем трём. */
  bonusMode: BonusMode
  bonusPlus2: Ability | null
  bonusPlus1: Ability | null
  speciesId: string | null
  /** Ветвь, предок или наследие вида. */
  speciesOption: string | null
  /** Черта происхождения на выбор (Человек — Разносторонность). */
  originFeat: string | null
  abilityMethod: AbilityMethod
  /** Шесть бросков 4к6 (оставить 3 лучших) — для метода «бросок». */
  rolls: RollResult[] | null
  /** Какое значение из набора (индекс) назначено характеристике. */
  assignment: Partial<Record<Ability, number>>
  classSkills: SkillId[]
  speciesSkills: SkillId[]
  featSkills: SkillId[]
  expertise: SkillId[]
  classEquipment: string | null
  backgroundEquipment: string | null
  name: string
  appearance: string
}

export function emptyDraft(): CreationDraft {
  return {
    classId: null,
    backgroundId: null,
    bonusMode: 'two-one',
    bonusPlus2: null,
    bonusPlus1: null,
    speciesId: null,
    speciesOption: null,
    originFeat: null,
    abilityMethod: 'standard',
    rolls: null,
    assignment: {},
    classSkills: [],
    speciesSkills: [],
    featSkills: [],
    expertise: [],
    classEquipment: null,
    backgroundEquipment: null,
    name: '',
    appearance: '',
  }
}

// ---------- Обновление черновика: смена выбора сбрасывает зависящие от него решения ----------

export function chooseClass(draft: CreationDraft, classId: string): CreationDraft {
  if (draft.classId === classId) return draft
  return { ...draft, classId, classSkills: [], expertise: [], classEquipment: null }
}

export function chooseBackground(draft: CreationDraft, backgroundId: string, data: RulesData): CreationDraft {
  if (draft.backgroundId === backgroundId) return draft
  // Навыки предыстории даются автоматически — убираем их из выбранных в других местах.
  const granted = new Set(data.backgrounds[backgroundId]?.skills ?? [])
  const keep = (skills: SkillId[]) => skills.filter((s) => !granted.has(s))
  return {
    ...draft,
    backgroundId,
    bonusPlus2: null,
    bonusPlus1: null,
    backgroundEquipment: null,
    classSkills: keep(draft.classSkills),
    speciesSkills: keep(draft.speciesSkills),
    featSkills: keep(draft.featSkills),
    expertise: [],
  }
}

export function chooseSpecies(draft: CreationDraft, speciesId: string): CreationDraft {
  if (draft.speciesId === speciesId) return draft
  return { ...draft, speciesId, speciesOption: null, originFeat: null, speciesSkills: [], featSkills: [], expertise: [] }
}

export function chooseAbilityMethod(draft: CreationDraft, method: AbilityMethod, rng?: Rng): CreationDraft {
  return { ...draft, abilityMethod: method, rolls: method === 'roll' ? rollAbilityScores(rng) : null, assignment: {} }
}

/** Назначает характеристике значение из набора; если оно было у другой характеристики — меняет их местами. */
export function assignScore(draft: CreationDraft, ability: Ability, index: number | null): CreationDraft {
  const assignment = { ...draft.assignment }
  const previous = assignment[ability]
  if (index === null) {
    delete assignment[ability]
  } else {
    const holder = ABILITIES.find((a) => a !== ability && assignment[a] === index)
    if (holder) {
      if (previous === undefined) delete assignment[holder]
      else assignment[holder] = previous
    }
    assignment[ability] = index
  }
  return { ...draft, assignment }
}

// ---------- Характеристики ----------

/** Шесть бросков 4к6 с отбрасыванием худшего кубика. */
export function rollAbilityScores(rng?: Rng): RollResult[] {
  return Array.from({ length: 6 }, () => roll('4d6kh3', { rng }))
}

/** Значения, которые распределяет игрок: стандартный набор или итоги бросков. */
export function abilityPool(draft: CreationDraft): number[] {
  if (draft.abilityMethod === 'roll') return (draft.rolls ?? []).map((r) => r.total)
  return [...STANDARD_ARRAY]
}

/** Прибавки от предыстории. */
export function backgroundBonuses(draft: CreationDraft, data: RulesData): Partial<Record<Ability, number>> {
  const background = draft.backgroundId ? data.backgrounds[draft.backgroundId] : undefined
  if (!background) return {}
  if (draft.bonusMode === 'one-one-one') return Object.fromEntries(background.abilities.map((a) => [a, 1]))
  const bonuses: Partial<Record<Ability, number>> = {}
  if (draft.bonusPlus2) bonuses[draft.bonusPlus2] = 2
  if (draft.bonusPlus1) bonuses[draft.bonusPlus1] = 1
  return bonuses
}

/** Итоговые значения: назначенное значение + прибавка предыстории (не больше 20). null, если не всё назначено. */
export function finalScores(draft: CreationDraft, data: RulesData): AbilityScores | null {
  const pool = abilityPool(draft)
  const bonuses = backgroundBonuses(draft, data)
  const scores = {} as AbilityScores
  for (const ability of ABILITIES) {
    const index = draft.assignment[ability]
    if (index === undefined || pool[index] === undefined) return null
    scores[ability] = Math.min(MAX_SCORE, pool[index] + (bonuses[ability] ?? 0))
  }
  return scores
}

/**
 * Рекомендуемая расстановка: лучшие значения — основным характеристикам класса,
 * затем Телосложению, затем остальным в обычном порядке.
 */
export function recommendedAssignment(cls: ClassDefinition, pool: number[]): Partial<Record<Ability, number>> {
  const order: Ability[] = [...new Set<Ability>([...cls.primary, 'con', 'dex', 'wis', 'str', 'cha', 'int'])]
  const indexes = pool.map((value, index) => ({ value, index })).sort((a, b) => b.value - a.value || a.index - b.index)
  return Object.fromEntries(order.map((ability, i) => [ability, indexes[i]?.index]).filter(([, i]) => i !== undefined))
}

// ---------- Навыки ----------

export interface SkillSlot {
  key: 'classSkills' | 'speciesSkills' | 'featSkills'
  label: string
  count: number
  options: SkillId[]
}

const resolveChoice = (choice: SkillChoice): SkillId[] => (choice.from === 'any' ? [...SKILLS] : choice.from)

/** Навыки, которые даются без выбора (предыстория). */
export function grantedSkills(draft: CreationDraft, data: RulesData): SkillId[] {
  return draft.backgroundId ? [...(data.backgrounds[draft.backgroundId]?.skills ?? [])] : []
}

/** Черты персонажа: от предыстории и (у Человека) на выбор. */
export function chosenFeats(draft: CreationDraft, data: RulesData): string[] {
  const feats: string[] = []
  const background = draft.backgroundId ? data.backgrounds[draft.backgroundId] : undefined
  if (background) feats.push(background.feat)
  if (draft.originFeat) feats.push(draft.originFeat)
  return feats
}

/** Все выборы навыков: класс, вид (Эльф, Человек), черта «Одарённый». */
export function skillSlots(draft: CreationDraft, data: RulesData): SkillSlot[] {
  const slots: SkillSlot[] = []
  const cls = draft.classId ? data.classes[draft.classId] : undefined
  if (cls) slots.push({ key: 'classSkills', label: `Класс: ${cls.name}`, count: cls.skillChoices.count, options: resolveChoice(cls.skillChoices) })
  const species = draft.speciesId ? data.species[draft.speciesId] : undefined
  if (species?.skillChoice) {
    slots.push({
      key: 'speciesSkills',
      label: `${species.name}: ${species.skillChoice.source ?? 'навык'}`,
      count: species.skillChoice.count,
      options: resolveChoice(species.skillChoice),
    })
  }
  const featCount = chosenFeats(draft, data).reduce((sum, id) => sum + (data.feats[id]?.skillChoices ?? 0), 0)
  if (featCount > 0) slots.push({ key: 'featSkills', label: 'Черта «Одарённый»', count: featCount, options: [...SKILLS] })
  return slots
}

/** Все навыки, которыми будет владеть персонаж. */
export function proficientSkills(draft: CreationDraft, data: RulesData): SkillId[] {
  return [...new Set([...grantedSkills(draft, data), ...draft.classSkills, ...draft.speciesSkills, ...draft.featSkills])]
}

export function expertiseCount(draft: CreationDraft, data: RulesData): number {
  return (draft.classId && data.classes[draft.classId]?.expertise) || 0
}

// ---------- Снаряжение ----------

function findOption(options: EquipmentOption[] | undefined, id: string | null) {
  return id ? options?.find((o) => o.id === id) : undefined
}

/** Раскрывает вариант снаряжения в предметы (наборы — в их содержимое). */
export function expandEquipment(option: EquipmentOption, data: RulesData): InventoryEntry[] {
  const lines: InventoryEntry[] = []
  for (const line of option.items) {
    if (line.packId !== undefined) lines.push(...data.packs[line.packId].contents.map((c) => ({ ...c })))
    else lines.push({ itemId: line.itemId, quantity: line.quantity ?? 1 })
  }
  return lines
}

/** Складывает одинаковые предметы. */
export function mergeItems(lines: InventoryEntry[]): InventoryEntry[] {
  const merged = new Map<string, number>()
  for (const { itemId, quantity } of lines) merged.set(itemId, (merged.get(itemId) ?? 0) + quantity)
  return [...merged].map(([itemId, quantity]) => ({ itemId, quantity }))
}

/**
 * Что надеть: лучший доспех, щит и первое оружие из списка. Если оружие двуручное, а есть щит —
 * берётся первое одноручное оружие; если такого нет — щит не надевается.
 */
export function autoEquip(items: InventoryEntry[], catalog: ItemCatalog): Equipment {
  const defs = items.map((i) => catalog[i.itemId]).filter(Boolean)
  const armor = defs
    .filter((d) => d.armor && d.armor.type !== 'shield')
    .sort((a, b) => b.armor!.baseAC - a.armor!.baseAC)[0]
  const shield = defs.find((d) => d.armor?.type === 'shield')
  const weapons = defs.filter((d) => d.weapon && !d.weapon.properties.includes('ammunition'))
  const ranged = defs.filter((d) => d.weapon?.properties.includes('ammunition'))
  const oneHanded = weapons.find((d) => !d.weapon!.properties.includes('two-handed'))
  let weapon = weapons[0] ?? ranged[0]
  let useShield = Boolean(shield)
  if (shield && weapon?.weapon?.properties.includes('two-handed')) {
    if (oneHanded) weapon = oneHanded
    else useShield = false
  }
  return { weapon: weapon?.id ?? null, armor: armor?.id ?? null, shield: useShield && shield ? shield.id : null }
}

export function startingInventory(draft: CreationDraft, data: RulesData, catalog: ItemCatalog) {
  const cls = draft.classId ? data.classes[draft.classId] : undefined
  const background = draft.backgroundId ? data.backgrounds[draft.backgroundId] : undefined
  const classOption = findOption(cls?.equipment, draft.classEquipment)
  const backgroundOption = findOption(background?.equipment, draft.backgroundEquipment)
  const lines = [
    ...(classOption ? expandEquipment(classOption, data) : []),
    ...(backgroundOption ? expandEquipment(backgroundOption, data) : []),
  ]
  const items = mergeItems(lines)
  return {
    gold: (classOption?.gold ?? 0) + (backgroundOption?.gold ?? 0),
    items,
    equipped: autoEquip(items, catalog),
  }
}

// ---------- Хиты ----------

/** Хиты 1-го уровня: максимум кости хитов класса + модификатор Телосложения (+1 у Дварфа), не меньше 1. */
export function startingHitPoints(draft: CreationDraft, data: RulesData, con: number): number {
  const cls = draft.classId ? data.classes[draft.classId] : undefined
  const species = draft.speciesId ? data.species[draft.speciesId] : undefined
  if (!cls) return 0
  return Math.max(1, cls.hitDie + abilityModifier(con) + (species?.hpPerLevel ?? 0))
}

// ---------- Проверка шагов ----------

/** Что ещё нужно выбрать на шаге. Пустой список — шаг завершён. */
export function stepProblems(step: CreationStep, draft: CreationDraft, data: RulesData): string[] {
  const problems: string[] = []
  const cls = draft.classId ? data.classes[draft.classId] : undefined
  const background = draft.backgroundId ? data.backgrounds[draft.backgroundId] : undefined
  const species = draft.speciesId ? data.species[draft.speciesId] : undefined

  switch (step) {
    case 'class':
      if (!cls) problems.push('Выберите класс')
      break
    case 'background':
      if (!background) {
        problems.push('Выберите предысторию')
      } else if (draft.bonusMode === 'two-one') {
        if (!draft.bonusPlus2 || !draft.bonusPlus1) problems.push('Распределите прибавки +2 и +1')
        else if (draft.bonusPlus2 === draft.bonusPlus1) problems.push('Прибавки +2 и +1 должны быть к разным характеристикам')
        else if (![draft.bonusPlus2, draft.bonusPlus1].every((a) => background.abilities.includes(a))) {
          problems.push('Прибавки можно дать только характеристикам предыстории')
        }
      }
      break
    case 'species':
      if (!species) {
        problems.push('Выберите вид')
      } else {
        if (species.choice && !species.choice.options.some((o) => o.id === draft.speciesOption)) {
          problems.push(`Выберите: ${species.choice.label.toLowerCase()}`)
        }
        if (species.originFeat && (!draft.originFeat || !data.feats[draft.originFeat])) problems.push('Выберите черту происхождения')
      }
      break
    case 'abilities': {
      if (draft.abilityMethod === 'roll' && (draft.rolls?.length ?? 0) !== 6) problems.push('Бросьте кубики')
      const missing = ABILITIES.filter((a) => draft.assignment[a] === undefined)
      if (missing.length > 0) problems.push(`Назначьте значения всем характеристикам (осталось ${missing.length})`)
      break
    }
    case 'skills': {
      const granted = new Set(grantedSkills(draft, data))
      const taken = new Set<SkillId>()
      for (const slot of skillSlots(draft, data)) {
        const chosen = draft[slot.key]
        if (chosen.length !== slot.count) problems.push(`${slot.label}: выберите ${slot.count} (выбрано ${chosen.length})`)
        for (const skill of chosen) {
          if (!slot.options.includes(skill)) problems.push(`${slot.label}: навык недоступен`)
          if (granted.has(skill) || taken.has(skill)) problems.push('Один навык нельзя выбрать дважды')
          taken.add(skill)
        }
      }
      const needExpertise = expertiseCount(draft, data)
      if (needExpertise > 0) {
        const proficient = new Set(proficientSkills(draft, data))
        if (draft.expertise.length !== needExpertise) problems.push(`Компетентность: выберите ${needExpertise} (выбрано ${draft.expertise.length})`)
        if (draft.expertise.some((s) => !proficient.has(s))) problems.push('Компетентность — только для навыков, которыми вы владеете')
      }
      break
    }
    case 'equipment':
      if (!findOption(cls?.equipment, draft.classEquipment)) problems.push('Выберите снаряжение класса')
      if (!findOption(background?.equipment, draft.backgroundEquipment)) problems.push('Выберите снаряжение предыстории')
      break
    case 'details': {
      const name = draft.name.trim()
      if (!name) problems.push('Введите имя персонажа')
      else if (name.length > MAX_NAME_LENGTH) problems.push(`Имя — не длиннее ${MAX_NAME_LENGTH} символов`)
      break
    }
    case 'summary':
      for (const s of CREATION_STEPS) if (s.id !== 'summary') problems.push(...stepProblems(s.id, draft, data))
      break
  }
  return [...new Set(problems)]
}

/** Первый незавершённый шаг (или «Итог»). */
export function firstIncompleteStep(draft: CreationDraft, data: RulesData): CreationStep {
  return CREATION_STEPS.find((s) => s.id !== 'summary' && stepProblems(s.id, draft, data).length > 0)?.id ?? 'summary'
}

export class CreationError extends Error {
  readonly problems: string[]
  constructor(problems: string[]) {
    super(`Персонаж не готов:\n- ${problems.join('\n- ')}`)
    this.name = 'CreationError'
    this.problems = problems
  }
}

/** Собирает готовый лист персонажа. Бросает CreationError, если какой-то шаг не завершён. */
export function buildCharacterSheet(draft: CreationDraft, data: RulesData, catalog: ItemCatalog, id: string): CharacterSheet {
  const problems = stepProblems('summary', draft, data)
  if (problems.length > 0) throw new CreationError(problems)

  const cls = data.classes[draft.classId!]
  const background = data.backgrounds[draft.backgroundId!]
  const species = data.species[draft.speciesId!]
  const abilities = finalScores(draft, data)!
  const hp = startingHitPoints(draft, data, abilities.con)

  const skills: Proficiencies['skills'] = {}
  for (const skill of proficientSkills(draft, data)) skills[skill] = 'proficient'
  for (const skill of draft.expertise) skills[skill] = 'expertise'

  return {
    character: {
      id,
      name: draft.name.trim(),
      species: species.name,
      speciesId: species.id,
      speciesOption: draft.speciesOption,
      classId: cls.id,
      className: cls.name,
      background: background.name,
      backgroundId: background.id,
      level: 1,
      abilities,
      maxHp: hp,
      hp,
      proficiencies: { savingThrows: [...cls.savingThrows], skills },
      conditions: [],
      feats: chosenFeats(draft, data),
      appearance: draft.appearance.trim(),
    },
    inventory: startingInventory(draft, data, catalog),
  }
}
