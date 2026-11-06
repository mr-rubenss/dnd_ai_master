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
  /** Английское название из SRD 5.2.1. */
  nameEn: string
  /** Краткое описание для игрока. */
  summary: string
}

export const CONDITION_DEFINITIONS: Record<ConditionId, ConditionDefinition> = {
  blinded: {
    id: 'blinded',
    name: 'Ослеплён', nameEn: 'Blinded',
    summary: 'Ничего не видит: проверки, требующие зрения, автоматически провальны; атаки по нему с преимуществом, его атаки — с помехой.',
  },
  charmed: {
    id: 'charmed',
    name: 'Очарован', nameEn: 'Charmed',
    summary: 'Не может атаковать очаровавшего и направлять на него вредящие эффекты; тот совершает с преимуществом проверки общения с ним.',
  },
  deafened: { id: 'deafened', name: 'Оглох', nameEn: 'Deafened', summary: 'Ничего не слышит: проверки, требующие слуха, автоматически провальны.' },
  exhaustion: {
    id: 'exhaustion',
    name: 'Истощение', nameEn: 'Exhaustion',
    summary: 'Броски к20 уменьшаются на 2 × уровень, скорость — на 5 футов × уровень. На 6-м уровне существо умирает. Долгий отдых снимает 1 уровень.',
  },
  frightened: {
    id: 'frightened',
    name: 'Испуган', nameEn: 'Frightened',
    summary: 'Помеха на проверки характеристик и броски атаки, пока источник страха в поле зрения; не может приблизиться к нему.',
  },
  grappled: {
    id: 'grappled',
    name: 'Схвачен', nameEn: 'Grappled',
    summary: 'Скорость 0; помеха на атаки по всем, кроме схватившего; схвативший может тащить его.',
  },
  incapacitated: {
    id: 'incapacitated',
    name: 'Недееспособен', nameEn: 'Incapacitated',
    summary: 'Не может совершать действия, бонусные действия и реакции; концентрация прерывается; не может говорить; помеха на инициативу.',
  },
  invisible: {
    id: 'invisible',
    name: 'Невидим', nameEn: 'Invisible',
    summary: 'Преимущество на инициативу и броски атаки; атаки по нему с помехой; на него не действуют эффекты, требующие видеть цель.',
  },
  paralyzed: {
    id: 'paralyzed',
    name: 'Парализован', nameEn: 'Paralyzed',
    summary: 'Недееспособен, скорость 0; спасброски Силы и Ловкости автоматически провальны; атаки по нему с преимуществом, попадание вблизи (5 футов) — критическое.',
  },
  petrified: {
    id: 'petrified',
    name: 'Окаменел', nameEn: 'Petrified',
    summary: 'Превращён в камень: недееспособен, скорость 0; атаки по нему с преимуществом; спасброски Силы и Ловкости автоматически провальны; сопротивление всему урону; иммунитет к Отравлен.',
  },
  poisoned: { id: 'poisoned', name: 'Отравлен', nameEn: 'Poisoned', summary: 'Помеха на броски атаки и проверки характеристик.' },
  prone: {
    id: 'prone',
    name: 'Сбит с ног', nameEn: 'Prone',
    summary: 'Помеха на броски атаки; атаки по нему вблизи — с преимуществом, издалека — с помехой.',
  },
  restrained: {
    id: 'restrained',
    name: 'Опутан', nameEn: 'Restrained',
    summary: 'Скорость 0; атаки по нему с преимуществом, его атаки — с помехой; помеха на спасброски Ловкости.',
  },
  stunned: {
    id: 'stunned',
    name: 'Ошеломлён', nameEn: 'Stunned',
    summary: 'Недееспособен; спасброски Силы и Ловкости автоматически провальны; атаки по нему с преимуществом.',
  },
  unconscious: {
    id: 'unconscious',
    name: 'Без сознания', nameEn: 'Unconscious',
    summary: 'Недееспособен и сбит с ног, роняет всё из рук, скорость 0; спасброски Силы и Ловкости автоматически провальны; атаки по нему с преимуществом, попадание вблизи (5 футов) — критическое.',
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
