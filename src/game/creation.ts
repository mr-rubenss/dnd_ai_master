// Создание персонажа по правилам D&D 2024 (SRD 5.2). Чистые функции: черновик выборов игрока →
// проверка каждого шага → готовый лист персонажа. UI только показывает варианты и вызывает эти функции.
import { ABILITIES, abilityModifier, type Ability, type AbilityScores } from '../engine/abilities'
import type { Proficiencies } from '../engine/checks'
import { roll, type Rng, type RollResult } from '../engine/dice'
import { SKILLS, type SkillId } from '../engine/skills'
import type { CharacterSheet, Equipment, InventoryEntry } from '../types/character'
import type { ItemCatalog } from '../types/items'
import type { ToolKind } from '../types/items'
import type { BackgroundDefinition, ClassDefinition, EquipmentOption, RulesData, SkillChoice } from '../types/rules'
import {
  buildCustomBackground,
  CUSTOM_BACKGROUND_ID,
  emptyCustomBackground,
  validateBackgroundTemplate,
  type CustomBackgroundInput,
} from './backgroundTemplate'
import type { BackgroundProposal } from './backgroundFromStory'
import { MAX_BACKSTORY_LENGTH } from './character'

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
  /** Черта боевого стиля (Воин). */
  fightingStyle: string | null
  /** Инструменты, выбранные для класса (Бард — 3 музыкальных, Монах — 1). */
  classTools: string[]
  /** Инструмент предыстории, если он на выбор (Солдат — игровой набор). */
  backgroundTool: string | null
  /** Своя предыстория (используется, когда backgroundId === 'custom'). */
  customBackground: CustomBackgroundInput
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
  /** «История героя» — свободный текст игрока; доступна при любой предыстории и попадает в лист персонажа. */
  backstory: string
  /** Как заполнена своя предыстория: вручную или «по моей истории» (предложение ИИ, которое можно править). */
  backgroundSource: 'manual' | 'story'
  /** Последнее предложение ИИ «по моей истории»: объяснения выбора и дописанные детали. */
  backgroundProposal: BackgroundProposal | null
}

export function emptyDraft(): CreationDraft {
  return {
    classId: null,
    fightingStyle: null,
    classTools: [],
    backgroundTool: null,
    customBackground: emptyCustomBackground(),
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
    backstory: '',
    backgroundSource: 'manual',
    backgroundProposal: null,
  }
}

/** Выбрать «Свою предысторию» вручную или «По моей истории». */
export function chooseCustomBackground(draft: CreationDraft, source: 'manual' | 'story', data: RulesData): CreationDraft {
  return { ...chooseBackground(draft, CUSTOM_BACKGROUND_ID, data), backgroundSource: source }
}

/** Применить предложение ИИ: поля своей предыстории заполняются (их можно править), объяснения сохраняются. */
export function applyBackgroundProposal(draft: CreationDraft, proposal: BackgroundProposal, data: RulesData): CreationDraft {
  const next = chooseCustomBackground(draft, 'story', data)
  return { ...updateCustomBackground(next, proposal.input, data), backgroundProposal: proposal }
}

/** Решение игрока по дописанной ИИ детали: принятая дописывается в «Историю героя». */
export function decideProposalDetail(draft: CreationDraft, index: number, accept: boolean): CreationDraft {
  const proposal = draft.backgroundProposal
  const detail = proposal?.details[index]
  if (!proposal || !detail || detail.status !== 'pending') return draft
  const details = proposal.details.map((d, i) => (i === index ? { ...d, status: accept ? ('accepted' as const) : ('rejected' as const) } : d))
  const backstory = accept ? [draft.backstory.trim(), detail.text.trim()].filter(Boolean).join(' ').slice(0, MAX_BACKSTORY_LENGTH) : draft.backstory
  return { ...draft, backstory, backgroundProposal: { ...proposal, details } }
}

// ---------- Обновление черновика: смена выбора сбрасывает зависящие от него решения ----------

export function chooseClass(draft: CreationDraft, classId: string): CreationDraft {
  if (draft.classId === classId) return draft
  return { ...draft, classId, fightingStyle: null, classTools: [], classSkills: [], expertise: [], classEquipment: null }
}

/** Навыки предыстории даются автоматически — убираем их из выбранных в других местах. */
function withoutGranted(draft: CreationDraft, data: RulesData): CreationDraft {
  const granted = new Set(backgroundOf(draft, data)?.skills ?? [])
  const keep = (skills: SkillId[]) => skills.filter((s) => !granted.has(s))
  return {
    ...draft,
    classSkills: keep(draft.classSkills),
    speciesSkills: keep(draft.speciesSkills),
    featSkills: keep(draft.featSkills),
  }
}

export function chooseBackground(draft: CreationDraft, backgroundId: string, data: RulesData): CreationDraft {
  if (draft.backgroundId === backgroundId) return draft
  return withoutGranted(
    { ...draft, backgroundId, bonusPlus2: null, bonusPlus1: null, backgroundTool: null, backgroundEquipment: null, expertise: [] },
    data,
  )
}

/** Изменяет свою предысторию; прибавки к убранным характеристикам и конфликтующие навыки сбрасываются. */
export function updateCustomBackground(draft: CreationDraft, patch: Partial<CustomBackgroundInput>, data: RulesData): CreationDraft {
  const customBackground = { ...draft.customBackground, ...patch }
  const keepBonus = (a: Ability | null) => (a && customBackground.abilities.includes(a) ? a : null)
  const next = { ...draft, customBackground, bonusPlus2: keepBonus(draft.bonusPlus2), bonusPlus1: keepBonus(draft.bonusPlus1) }
  return patch.skills ? withoutGranted(next, data) : next
}

/** Предыстория черновика: готовая из данных или своя, собранная по шаблону. */
export function backgroundOf(draft: CreationDraft, data: RulesData): BackgroundDefinition | undefined {
  if (draft.backgroundId === CUSTOM_BACKGROUND_ID) return buildCustomBackground(draft.customBackground, data.catalog)
  return draft.backgroundId ? data.backgrounds[draft.backgroundId] : undefined
}

/** Инструменты, которыми будет владеть персонаж: от класса и предыстории. */
export function toolProficiencies(draft: CreationDraft, data: RulesData): string[] {
  const cls = draft.classId ? data.classes[draft.classId] : undefined
  const background = backgroundOf(draft, data)
  const backgroundTool = background?.tool.itemId || (background?.tool.choose ? draft.backgroundTool : null)
  return [...new Set([...(cls?.tools?.fixed ?? []), ...draft.classTools, ...(backgroundTool ? [backgroundTool] : [])])]
}

/** Инструменты вида (или видов) из справочника. */
export function toolsOfKinds(kinds: ToolKind[], data: RulesData): string[] {
  return Object.values(data.catalog)
    .filter((item) => item.toolKind && kinds.includes(item.toolKind))
    .map((item) => item.id)
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
  const background = backgroundOf(draft, data)
  if (!background) return {}
  if (draft.bonusMode === 'one-one-one') return Object.fromEntries((background.abilities ?? []).map((a) => [a, 1]))
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
  return [...(backgroundOf(draft, data)?.skills ?? [])]
}

/** Черты персонажа: от предыстории, (у Человека) черта происхождения на выбор и боевой стиль (Воин). */
export function chosenFeats(draft: CreationDraft, data: RulesData): string[] {
  const feats: string[] = []
  const background = backgroundOf(draft, data)
  if (background?.feat) feats.push(background.feat)
  if (draft.originFeat) feats.push(draft.originFeat)
  const cls = draft.classId ? data.classes[draft.classId] : undefined
  if (cls?.fightingStyle && draft.fightingStyle) feats.push(draft.fightingStyle)
  return [...new Set(feats)]
}

/** Черты нужной категории (происхождения или боевого стиля). */
export function featsOfCategory(category: 'origin' | 'fighting-style', data: RulesData) {
  return Object.values(data.feats).filter((f) => f.category === category)
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

/** Инструменты, выбранные игроком, на которые ссылается снаряжение ({ "chosenTool": "class" }). */
export interface ChosenTools {
  class?: string | null
  background?: string | null
}

/** Раскрывает вариант снаряжения в предметы (наборы — в их содержимое, выбранный инструмент — в предмет). */
export function expandEquipment(option: EquipmentOption, data: RulesData, chosen: ChosenTools = {}): InventoryEntry[] {
  const lines: InventoryEntry[] = []
  for (const line of option.items) {
    if (line.chosenTool !== undefined) {
      const itemId = chosen[line.chosenTool]
      if (itemId) lines.push({ itemId, quantity: 1 })
    } else if (line.packId !== undefined) {
      lines.push(...data.packs[line.packId].contents.map((c) => ({ ...c })))
    } else {
      lines.push({ itemId: line.itemId, quantity: line.quantity ?? 1 })
    }
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
 * Что надеть: лучший доспех, в основную руку — первое оружие ближнего боя (или дальнобойное),
 * во вторую — щит. Если оружие двуручное, а есть щит, — берётся первое одноручное оружие;
 * если такого нет — щит остаётся в рюкзаке.
 */
export function autoEquip(items: InventoryEntry[], catalog: ItemCatalog): Equipment {
  const defs = items.map((i) => catalog[i.itemId]).filter(Boolean)
  const armor = defs.filter((d) => d.armor && d.armor.type !== 'shield').sort((a, b) => b.armor!.baseAC - a.armor!.baseAC)[0]
  const shield = defs.find((d) => d.armor?.type === 'shield')
  const melee = defs.filter((d) => d.weapon && !d.weapon.properties.includes('ammunition'))
  const ranged = defs.filter((d) => d.weapon?.properties.includes('ammunition'))
  const oneHanded = melee.find((d) => !d.weapon!.properties.includes('two-handed'))
  let weapon = melee[0] ?? ranged[0]
  let useShield = Boolean(shield)
  if (shield && weapon?.weapon?.properties.includes('two-handed')) {
    if (oneHanded) weapon = oneHanded
    else useShield = false
  }
  return { mainHand: weapon?.id ?? null, offHand: useShield && shield ? shield.id : null, armor: armor?.id ?? null }
}

export function startingInventory(draft: CreationDraft, data: RulesData, catalog: ItemCatalog) {
  const cls = draft.classId ? data.classes[draft.classId] : undefined
  const background = backgroundOf(draft, data)
  const classOption = findOption(cls?.equipment, draft.classEquipment)
  const backgroundOption = findOption(background?.equipment, draft.backgroundEquipment)
  const chosen: ChosenTools = { class: draft.classTools[0] ?? null, background: draft.backgroundTool }
  const lines = [
    ...(classOption ? expandEquipment(classOption, data, chosen) : []),
    ...(backgroundOption ? expandEquipment(backgroundOption, data, chosen) : []),
  ]
  const items = mergeItems(lines)
  return {
    gold: Math.round(((classOption?.gold ?? 0) + (backgroundOption?.gold ?? 0)) * 100) / 100,
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
  const background = backgroundOf(draft, data)
  const species = draft.speciesId ? data.species[draft.speciesId] : undefined

  switch (step) {
    case 'class':
      if (!cls) {
        problems.push('Выберите класс')
        break
      }
      if (cls.fightingStyle && (!draft.fightingStyle || data.feats[draft.fightingStyle]?.category !== 'fighting-style')) {
        problems.push('Выберите боевой стиль')
      }
      if (cls.tools?.choose) {
        const { count, kinds } = cls.tools.choose
        const allowed = new Set(toolsOfKinds(kinds, data))
        if (draft.classTools.length !== count) problems.push(`Выберите инструменты: ${count} (выбрано ${draft.classTools.length})`)
        else if (!draft.classTools.every((t) => allowed.has(t)) || new Set(draft.classTools).size !== count) {
          problems.push('Этот инструмент нельзя выбрать для класса')
        }
      }
      break
    case 'background':
      if (!background) {
        problems.push('Выберите предысторию')
        break
      }
      if (background.id === CUSTOM_BACKGROUND_ID) {
        problems.push(...validateBackgroundTemplate(background, { feats: data.feats, catalog: data.catalog }))
        if (problems.length > 0) break
      }
      if (background.tool.choose && (!draft.backgroundTool || data.catalog[draft.backgroundTool]?.toolKind !== background.tool.choose)) {
        problems.push('Выберите инструмент предыстории')
      }
      if (draft.bonusMode === 'two-one') {
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
        if (species.originFeat && data.feats[draft.originFeat ?? '']?.category !== 'origin') problems.push('Выберите черту происхождения')
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
  const background = backgroundOf(draft, data)!
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
      proficiencies: { savingThrows: [...cls.savingThrows], skills, armor: [...cls.armorTraining], tools: toolProficiencies(draft, data) },
      conditions: [],
      feats: chosenFeats(draft, data),
      appearance: draft.appearance.trim(),
      ...(draft.backstory.trim() ? { backstory: draft.backstory.trim() } : {}),
    },
    inventory: startingInventory(draft, data, catalog),
  }
}
