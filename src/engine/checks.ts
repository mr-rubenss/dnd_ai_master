// Проверки характеристик, навыков и спасброски (SRD 5.2). Чистые функции.
//
// Важно: в SRD 5.2 натуральные 20 и 1 НЕ дают автоматического успеха или провала
// проверкам и спасброскам (это правило только для бросков атаки). Итог сравнивается со Сл.
import {
  ABILITY_NAMES,
  ABILITY_NAMES_GENITIVE,
  abilityModifier,
  proficiencyBonus,
  type Ability,
  type AbilityScores,
} from './abilities'
import { conditionEffects, CONDITION_DEFINITIONS, resolveRollMode, type ActiveCondition } from './conditions'
import { cryptoRng, formatNotation, roll, type RollMode, type RollResult, type Rng } from './dice'
import type { ArmorType } from '../types/items'
import { PROFICIENCY_MULTIPLIER, SKILL_DEFINITIONS, type ProficiencyLevel, type SkillId } from './skills'

export interface Proficiencies {
  /** Спасброски, которыми владеет персонаж. */
  savingThrows: Ability[]
  /** Навыки с владением или компетентностью; отсутствующие — без владения. */
  skills: Partial<Record<SkillId, Exclude<ProficiencyLevel, 'none'>>>
  /** Владение доспехами: лёгкие, средние, тяжёлые, щиты (Armor Training из SRD 5.2). */
  armor: ArmorType[]
  /** Инструменты, которыми владеет персонаж (id предметов справочника). */
  tools: string[]
}

/** Всё, что нужно правилам проверок от персонажа (или НПС). */
export interface CheckSubject {
  level: number
  abilities: AbilityScores
  proficiencies: Proficiencies
  conditions: ActiveCondition[]
  /** Особые бонусы к проверкам навыков (Чудотворец жреца: +Мдр к Интеллекту (Магия или Религия)). */
  skillBonuses?: SkillBonus[]
}

export interface SkillBonus {
  skills: SkillId[]
  label: string
  value: number
}

const bonusesFor = (subject: CheckSubject, skill: SkillId) => (subject.skillBonuses ?? []).filter((b) => b.skills.includes(skill))

export const MIN_DC = 1
export const MAX_DC = 30

/** Типичные Сл из SRD 5.2. */
export const DC_LABELS: [number, string][] = [
  [5, 'очень лёгкая'],
  [10, 'лёгкая'],
  [15, 'средняя'],
  [20, 'сложная'],
  [25, 'очень сложная'],
  [30, 'почти невозможная'],
]

export function skillProficiency(subject: CheckSubject, skill: SkillId): ProficiencyLevel {
  return subject.proficiencies.skills[skill] ?? 'none'
}

export function isSaveProficient(subject: CheckSubject, ability: Ability): boolean {
  return subject.proficiencies.savingThrows.includes(ability)
}

/** Модификатор навыка: модификатор характеристики + БМ × (0, 1 или 2). */
export function skillModifier(subject: CheckSubject, skill: SkillId): number {
  const { ability } = SKILL_DEFINITIONS[skill]
  const multiplier = PROFICIENCY_MULTIPLIER[skillProficiency(subject, skill)]
  const extra = bonusesFor(subject, skill).reduce((sum, b) => sum + b.value, 0)
  return abilityModifier(subject.abilities[ability]) + multiplier * proficiencyBonus(subject.level) + extra
}

/** Модификатор спасброска: модификатор характеристики + БМ при владении. */
export function savingThrowModifier(subject: CheckSubject, ability: Ability): number {
  return abilityModifier(subject.abilities[ability]) + (isSaveProficient(subject, ability) ? proficiencyBonus(subject.level) : 0)
}

/**
 * Пассивное Восприятие: 10 + модификатор Мудрости (Внимательность),
 * +5 при преимуществе и −5 при помехе (в т. ч. от состояний — Отравлен, Испуган).
 */
export function passivePerception(subject: CheckSubject, mode: RollMode = 'normal'): number {
  const effects = conditionEffects(subject.conditions, { kind: 'check', ability: 'wis' })
  const finalMode = resolveRollMode(
    mode === 'advantage' || effects.advantage.length > 0,
    mode === 'disadvantage' || effects.disadvantage.length > 0,
  )
  const modeBonus = finalMode === 'advantage' ? 5 : finalMode === 'disadvantage' ? -5 : 0
  return 10 + skillModifier(subject, 'perception') + modeBonus
}

export interface ModifierPart {
  label: string
  value: number
}

export type CheckTarget = { ability: Ability; skill?: undefined } | { skill: SkillId; ability?: undefined }

export interface CheckOptions {
  /** Сложность (Сл), целое от 1 до 30. */
  dc: number
  /** Запрошенный режим (например, от помощи союзника); состояния учитываются отдельно. */
  mode?: RollMode
  requiresSight?: boolean
  requiresHearing?: boolean
  rng?: Rng
}

export interface D20TestResult {
  kind: 'check' | 'save'
  ability: Ability
  skill: SkillId | null
  /** «Мудрость (Внимательность)», «Спасбросок Ловкости». */
  label: string
  dc: number
  requestedMode: RollMode
  /** Итоговый режим с учётом состояний. */
  mode: RollMode
  advantageReasons: string[]
  disadvantageReasons: string[]
  /** Слагаемые модификатора: характеристика, мастерство, штрафы. */
  modifiers: ModifierPart[]
  modifier: number
  /** Бросок; null, если бросок автоматически провален и не совершался. */
  roll: RollResult | null
  total: number | null
  autoFailReason: string | null
  success: boolean
  /** На сколько итог больше (или меньше) Сл. */
  margin: number | null
}

export class CheckError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CheckError'
  }
}

function validateDc(dc: number) {
  if (!Number.isInteger(dc) || dc < MIN_DC || dc > MAX_DC) throw new CheckError(`Сл должна быть целым числом от ${MIN_DC} до ${MAX_DC}, а не ${dc}`)
}

/** Проверка характеристики или навыка против Сл. */
export function abilityCheck(subject: CheckSubject, target: CheckTarget, options: CheckOptions): D20TestResult {
  validateDc(options.dc)
  const pb = proficiencyBonus(subject.level)
  const skill = target.skill ?? null
  const ability = skill ? SKILL_DEFINITIONS[skill].ability : target.ability!
  const modifiers: ModifierPart[] = [{ label: ABILITY_NAMES[ability], value: abilityModifier(subject.abilities[ability]) }]
  if (skill) {
    const level = skillProficiency(subject, skill)
    if (level === 'proficient') modifiers.push({ label: 'Владение', value: pb })
    if (level === 'expertise') modifiers.push({ label: 'Компетентность', value: 2 * pb })
    for (const b of bonusesFor(subject, skill)) modifiers.push({ label: b.label, value: b.value })
  }
  const label = skill ? `${ABILITY_NAMES[ability]} (${SKILL_DEFINITIONS[skill].name})` : `Проверка ${ABILITY_NAMES_GENITIVE[ability]}`
  return resolveD20Test(subject, { kind: 'check', ability, skill, label, modifiers }, options)
}

/** Спасбросок против Сл. */
export function savingThrow(subject: CheckSubject, ability: Ability, options: CheckOptions): D20TestResult {
  validateDc(options.dc)
  const modifiers: ModifierPart[] = [{ label: ABILITY_NAMES[ability], value: abilityModifier(subject.abilities[ability]) }]
  if (isSaveProficient(subject, ability)) modifiers.push({ label: 'Владение', value: proficiencyBonus(subject.level) })
  return resolveD20Test(
    subject,
    { kind: 'save', ability, skill: null, label: `Спасбросок ${ABILITY_NAMES_GENITIVE[ability]}`, modifiers },
    options,
  )
}

interface TestSpec {
  kind: 'check' | 'save'
  ability: Ability
  skill: SkillId | null
  label: string
  modifiers: ModifierPart[]
}

function resolveD20Test(subject: CheckSubject, spec: TestSpec, options: CheckOptions): D20TestResult {
  const requestedMode = options.mode ?? 'normal'
  const effects = conditionEffects(subject.conditions, {
    kind: spec.kind,
    ability: spec.ability,
    requiresSight: options.requiresSight,
    requiresHearing: options.requiresHearing,
  })
  const modifiers = [...spec.modifiers]
  if (effects.penalty > 0) {
    const level = effects.penalty / 2
    modifiers.push({ label: `${CONDITION_DEFINITIONS.exhaustion.name} ${level}`, value: -effects.penalty })
  }
  const modifier = modifiers.reduce((sum, part) => sum + part.value, 0)

  const advantageReasons = [...(requestedMode === 'advantage' ? ['запрошено'] : []), ...effects.advantage]
  const disadvantageReasons = [...(requestedMode === 'disadvantage' ? ['запрошено'] : []), ...effects.disadvantage]
  const mode = resolveRollMode(advantageReasons.length > 0, disadvantageReasons.length > 0)

  const base = {
    kind: spec.kind,
    ability: spec.ability,
    skill: spec.skill,
    label: spec.label,
    dc: options.dc,
    requestedMode,
    mode,
    advantageReasons,
    disadvantageReasons,
    modifiers,
    modifier,
  }

  if (effects.autoFail) {
    return { ...base, roll: null, total: null, autoFailReason: effects.autoFail, success: false, margin: null }
  }

  const notation = modifier === 0 ? '1d20' : `1d20${modifier > 0 ? '+' : '-'}${Math.abs(modifier)}`
  const result = roll(notation, { mode, rng: options.rng ?? cryptoRng })
  return {
    ...base,
    roll: result,
    total: result.total,
    autoFailReason: null,
    success: result.total >= options.dc,
    margin: result.total - options.dc,
  }
}

const MODE_TEXT: Record<RollMode, string> = { normal: '', advantage: ', преимущество', disadvantage: ', помеха' }

/** Текст результата для журнала и для ИИ-ведущего. */
export function formatD20Test(result: D20TestResult): string {
  const head = `${result.label}, Сл ${result.dc}${MODE_TEXT[result.mode]}`
  if (!result.roll) return `${head}: автоматический провал (${result.autoFailReason})`
  const dice = result.roll.groups[0].dice.map((d) => (d.kept ? String(d.value) : `(${d.value})`)).join(', ')
  const mod = result.modifier === 0 ? '' : ` ${result.modifier < 0 ? '−' : '+'} ${Math.abs(result.modifier)}`
  return `${head}: ${formatNotation(result.roll.notation)} → [${dice}]${mod} = ${result.total} — ${result.success ? 'успех' : 'провал'}`
}

