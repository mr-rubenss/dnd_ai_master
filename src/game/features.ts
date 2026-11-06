// Умения с ограниченным числом применений — единый учёт (SRD 5.2.1): умения класса («Второе дыхание», «Ярость»,
// «Наложение рук»), особенности вида (оружие дыхания, «Прилив адреналина», «Неутомимая стойкость»), воззвания
// и бесплатные сотворения заклинаний (черта, вид, умение класса). Сколько всего, сколько осталось и когда
// восстанавливается. Траты умений — Character.featureUses, бесплатных сотворений — Character.magic.freeUsed. Чистые функции.
import { abilityModifier, proficiencyBonus } from '../engine/abilities'
import type { Character } from '../types/character'
import type { ClassResource, RulesData } from '../types/rules'
import { innateSpells, type MagicRules, type MagicSubject } from './magic'

export type FeatureRules = Pick<RulesData, 'classes' | 'species' | 'invocations'>
export type FeatureSubject = Pick<Character, 'classId' | 'level' | 'abilities' | 'featureUses' | 'speciesId' | 'speciesOption'> & Partial<Pick<Character, 'invocations'>>

/** Откуда умение: класс, вид, воззвание. */
export type ResourceSource = 'class' | 'species' | 'invocation'

export interface ResourceState {
  resource: ClassResource
  source: ResourceSource
  /** Для игрока: «Воин», «Драконорождённый (Красный)», «Воззвание». */
  sourceName: string
  max: number
  used: number
  left: number
}

const levelIndex = (level: number) => Math.min(20, Math.max(1, level)) - 1

/** Сколько применений умения на уровне героя. */
export function resourceMax(resource: ClassResource, c: Pick<Character, 'level' | 'abilities'>): number {
  if (resource.uses) return resource.uses[levelIndex(c.level)] ?? 0
  if (resource.usesAbility) return Math.max(1, abilityModifier(c.abilities[resource.usesAbility]))
  if (resource.usesProficiency) return proficiencyBonus(c.level)
  return 0
}

/** Умения с применениями героя: класса, вида (с уровня minLevel) и выбранных воззваний. */
export function featureResources(c: FeatureSubject, rules: Partial<FeatureRules> & Pick<RulesData, 'classes'>): ResourceState[] {
  const defs: { resource: ClassResource; source: ResourceSource; sourceName: string }[] = []
  const cls = rules.classes[c.classId]
  for (const resource of cls?.resources ?? []) defs.push({ resource, source: 'class', sourceName: cls?.name ?? c.classId })
  const species = rules.species?.[c.speciesId]
  if (species) {
    const option = species.choice?.options.find((o) => o.id === c.speciesOption)
    const sourceName = option ? `${species.name} (${option.name})` : species.name
    for (const resource of species.resources ?? []) defs.push({ resource, source: 'species', sourceName })
  }
  for (const choice of c.invocations ?? []) {
    const inv = rules.invocations?.[choice.id]
    if (inv?.resource) defs.push({ resource: inv.resource, source: 'invocation', sourceName: `Воззвание «${inv.name}»` })
  }
  return defs
    .filter((d) => (d.resource.minLevel ?? 1) <= c.level)
    .map((d) => {
      const max = resourceMax(d.resource, c)
      const used = Math.min(max, c.featureUses?.[d.resource.id] ?? 0)
      return { ...d, max, used, left: max - used }
    })
}

/** Сколько применений вернёт короткий отдых. */
export function shortRestReturn(r: Pick<ResourceState, 'resource' | 'used'>): number {
  const back = r.resource.shortRest
  return back === 'all' ? r.used : Math.min(r.used, back ?? 0)
}

/** Когда восстанавливается — подпись для игрока и ведущего. */
export function recoveryText(resource: Pick<ClassResource, 'shortRest'>): string {
  if (resource.shortRest === 'all') return 'короткий или долгий отдых'
  if (resource.shortRest) return `короткий отдых: +${resource.shortRest}, долгий — все`
  return 'долгий отдых'
}

// ---------- Всё вместе: умения и бесплатные сотворения ----------

export interface LimitedUse {
  /** id умения (featureUses) или ключ бесплатного сотворения (magic.freeUsed). */
  key: string
  kind: 'feature' | 'spell'
  name: string
  sourceName: string
  description: string
  max: number
  used: number
  left: number
  /** Когда восстанавливается. */
  recovery: string
  /** Запас («Наложение рук»): тратится любым количеством. */
  pool?: boolean
}

/** Единый список применений героя — раздел «Умения» листа и состояние игры для ведущего. */
export function limitedUses(c: FeatureSubject & MagicSubject, rules: FeatureRules & MagicRules): LimitedUse[] {
  const features: LimitedUse[] = featureResources(c, rules).map((r) => ({
    key: r.resource.id,
    kind: 'feature',
    name: r.resource.name,
    sourceName: r.sourceName,
    description: r.resource.description,
    max: r.max,
    used: r.used,
    left: r.left,
    recovery: recoveryText(r.resource),
    ...(r.resource.pool ? { pool: true } : {}),
  }))
  const casts: LimitedUse[] = innateSpells(c, rules)
    .filter((s) => s.freeMax !== null && s.freeMax > 0)
    .map((s) => {
      const max = s.freeMax ?? 0
      const used = Math.min(max, s.freeUsed)
      return {
        key: s.key,
        kind: 'spell',
        name: `«${rules.spells[s.spellId]?.name ?? s.spellId}» без ячейки`,
        sourceName: s.sourceName,
        description: rules.spells[s.spellId]?.description ?? '',
        max,
        used,
        left: max - used,
        recovery: 'долгий отдых',
      }
    })
  return [...features, ...casts]
}

/** Названия всех умений с применениями (класс, вид, воззвание) — для строки изменений. */
export function featureNames(rules: Partial<FeatureRules> & Pick<RulesData, 'classes'>): Record<string, string> {
  const all = [
    ...Object.values(rules.classes).flatMap((c) => c.resources ?? []),
    ...Object.values(rules.species ?? {}).flatMap((s) => s.resources ?? []),
    ...Object.values(rules.invocations ?? {}).flatMap((i) => (i.resource ? [i.resource] : [])),
  ]
  return Object.fromEntries(all.map((r) => [r.id, r.name]))
}
