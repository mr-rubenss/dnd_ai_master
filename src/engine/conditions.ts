// Состояния (SRD 5.2) и их влияние на собственные броски к20 существа:
// проверки характеристик, спасброски и броски атаки.
import type { RollMode } from './dice'
import { ABILITY_NAMES_GENITIVE, type Ability } from './abilities'

export const CONDITIONS = [
  'blinded',
  'charmed',
  'deafened',
  'exhaustion',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
] as const
export type ConditionId = (typeof CONDITIONS)[number]

export const MAX_EXHAUSTION = 6

/** Действующее состояние. У Истощения есть уровень 1–6, у остальных — нет. */
export interface ActiveCondition {
  id: ConditionId
  level?: number
}

export interface ConditionDefinition {
  id: ConditionId
  name: string
  /** Краткое описание для игрока. */
  summary: string
}

export const CONDITION_DEFINITIONS: Record<ConditionId, ConditionDefinition> = {
  blinded: {
    id: 'blinded',
    name: 'Ослеплён',
    summary: 'Ничего не видит: проверки, требующие зрения, автоматически провальны; атаки по нему с преимуществом, его атаки — с помехой.',
  },
  charmed: {
    id: 'charmed',
    name: 'Очарован',
    summary: 'Не может атаковать очаровавшего; тот совершает проверки взаимодействия с ним с преимуществом.',
  },
  deafened: { id: 'deafened', name: 'Оглох', summary: 'Ничего не слышит: проверки, требующие слуха, автоматически провальны.' },
  exhaustion: {
    id: 'exhaustion',
    name: 'Истощение',
    summary: 'Броски к20 уменьшаются на 2 × уровень, скорость — на 5 футов × уровень. На 6-м уровне существо умирает.',
  },
  frightened: {
    id: 'frightened',
    name: 'Испуган',
    summary: 'Помеха на проверки характеристик и броски атаки, пока источник страха в поле зрения; не может приблизиться к нему.',
  },
  grappled: {
    id: 'grappled',
    name: 'Схвачен',
    summary: 'Скорость 0; помеха на атаки по всем, кроме схватившего.',
  },
  incapacitated: {
    id: 'incapacitated',
    name: 'Недееспособен',
    summary: 'Не может совершать действия, бонусные действия и реакции; теряет концентрацию; не может говорить.',
  },
  invisible: {
    id: 'invisible',
    name: 'Невидим',
    summary: 'Преимущество на инициативу и броски атаки; атаки по нему с помехой.',
  },
  paralyzed: {
    id: 'paralyzed',
    name: 'Парализован',
    summary: 'Недееспособен, скорость 0; спасброски Силы и Ловкости автоматически провальны; атаки по нему с преимуществом.',
  },
  petrified: {
    id: 'petrified',
    name: 'Окаменел',
    summary: 'Превращён в камень: недееспособен, спасброски Силы и Ловкости автоматически провальны, сопротивление всему урону.',
  },
  poisoned: { id: 'poisoned', name: 'Отравлен', summary: 'Помеха на броски атаки и проверки характеристик.' },
  prone: {
    id: 'prone',
    name: 'Сбит с ног',
    summary: 'Помеха на броски атаки; атаки по нему вблизи — с преимуществом, издалека — с помехой.',
  },
  restrained: {
    id: 'restrained',
    name: 'Опутан',
    summary: 'Скорость 0; помеха на броски атаки и спасброски Ловкости; атаки по нему с преимуществом.',
  },
  stunned: {
    id: 'stunned',
    name: 'Ошеломлён',
    summary: 'Недееспособен; спасброски Силы и Ловкости автоматически провальны; атаки по нему с преимуществом.',
  },
  unconscious: {
    id: 'unconscious',
    name: 'Без сознания',
    summary: 'Недееспособен, сбит с ног, роняет всё из рук; спасброски Силы и Ловкости автоматически провальны.',
  },
}

/** Состояния, которые автоматически включают другие (по SRD 5.2). */
const IMPLIED: Partial<Record<ConditionId, ConditionId[]>> = {
  paralyzed: ['incapacitated'],
  petrified: ['incapacitated'],
  stunned: ['incapacitated'],
  unconscious: ['incapacitated', 'prone'],
}

/** Все действующие состояния с учётом подразумеваемых (Без сознания → Недееспособен, Сбит с ног). */
export function effectiveConditions(conditions: readonly ActiveCondition[]): Set<ConditionId> {
  const result = new Set<ConditionId>()
  for (const { id } of conditions) {
    result.add(id)
    for (const implied of IMPLIED[id] ?? []) result.add(implied)
  }
  return result
}

/** Уровень Истощения (0, если его нет). */
export function exhaustionLevel(conditions: readonly ActiveCondition[]): number {
  return conditions.find((c) => c.id === 'exhaustion')?.level ?? 0
}

export type D20TestKind = 'check' | 'save' | 'attack'

export interface D20TestContext {
  kind: D20TestKind
  /** Характеристика броска (для спасбросков — какой спасбросок). */
  ability?: Ability
  /** Проверка требует зрения (например, Внимательность, чтобы что-то увидеть). */
  requiresSight?: boolean
  /** Проверка требует слуха. */
  requiresHearing?: boolean
}

export interface ConditionEffects {
  /** Причины преимущества (названия состояний). */
  advantage: string[]
  /** Причины помехи. */
  disadvantage: string[]
  /** Если бросок автоматически провален — причина. */
  autoFail: string | null
  /** Штраф к броску (Истощение: 2 × уровень). */
  penalty: number
}

const name = (id: ConditionId) => CONDITION_DEFINITIONS[id].name

/** Как состояния влияют на собственный бросок к20 существа. */
export function conditionEffects(conditions: readonly ActiveCondition[], context: D20TestContext): ConditionEffects {
  const active = effectiveConditions(conditions)
  const has = (id: ConditionId) => active.has(id)
  const effects: ConditionEffects = { advantage: [], disadvantage: [], autoFail: null, penalty: 0 }
  const { kind, ability } = context

  // Автоматические провалы.
  if (kind === 'check') {
    if (context.requiresSight && has('blinded')) effects.autoFail = `${name('blinded')}: проверка требует зрения`
    else if (context.requiresHearing && has('deafened')) effects.autoFail = `${name('deafened')}: проверка требует слуха`
  }
  if (kind === 'save' && (ability === 'str' || ability === 'dex')) {
    const cause = (['paralyzed', 'petrified', 'stunned', 'unconscious'] as const).find(has)
    if (cause) effects.autoFail = `${name(cause)}: спасбросок ${ABILITY_NAMES_GENITIVE[ability]} автоматически провален`
  }

  // Помеха.
  if (kind === 'check' || kind === 'attack') {
    if (has('poisoned')) effects.disadvantage.push(name('poisoned'))
    if (has('frightened')) effects.disadvantage.push(name('frightened'))
  }
  if (kind === 'attack') {
    for (const id of ['blinded', 'prone', 'restrained'] as const) if (has(id)) effects.disadvantage.push(name(id))
  }
  if (kind === 'save' && ability === 'dex' && has('restrained')) effects.disadvantage.push(name('restrained'))

  // Преимущество.
  if (kind === 'attack' && has('invisible')) effects.advantage.push(name('invisible'))

  // Истощение уменьшает любой бросок к20.
  const exhaustion = exhaustionLevel(conditions)
  if (exhaustion > 0) effects.penalty = 2 * exhaustion

  return effects
}

/** Итоговый режим: преимущество и помеха вместе отменяют друг друга (SRD 5.2). */
export function resolveRollMode(hasAdvantage: boolean, hasDisadvantage: boolean): RollMode {
  if (hasAdvantage === hasDisadvantage) return 'normal'
  return hasAdvantage ? 'advantage' : 'disadvantage'
}
