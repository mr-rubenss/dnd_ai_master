// Атаки экипированным оружием (SRD 5.2): бонус атаки, урон и пояснения. Чистые функции.
import { abilityModifier, proficiencyBonus, type Ability, type AbilityScores } from '../engine/abilities'
import type { Equipment } from '../types/character'
import type { DamageType, ItemCatalog, ItemDefinition } from '../types/items'
import type { MartialWeaponTraining } from '../types/rules'
import { wieldedTwoHanded } from './equipment'

export interface AttackSubject {
  level: number
  abilities: AbilityScores
  /** id черт: учитываются черты боевого стиля. */
  feats: string[]
}

export interface WeaponAttack {
  slot: 'mainHand' | 'offHand'
  itemId: string
  name: string
  ability: Ability
  proficient: boolean
  attackBonus: number
  /** Кубы урона в нотации «1d10» (для универсального оружия двумя руками — увеличенные). */
  damageDice: string
  damageBonus: number
  damageType: DamageType
  twoHanded: boolean
  /** Пояснения: «бонусное действие», «Бой большим оружием»… */
  notes: string[]
}

/** Владеет ли персонаж оружием: простым — все классы SRD 5.2, воинским — по классу. */
export function isWeaponProficient(item: ItemDefinition, training: MartialWeaponTraining): boolean {
  const weapon = item.weapon
  if (!weapon) return false
  if (weapon.kind === 'simple' || training === 'all') return true
  if (training === 'light') return weapon.properties.includes('light')
  if (training === 'finesse-or-light') return weapon.properties.includes('light') || weapon.properties.includes('finesse')
  return false
}

/** Характеристика атаки: дальнобойное — Ловкость, фехтовальное — лучшая из Силы и Ловкости, иначе Сила. */
export function attackAbility(item: ItemDefinition, abilities: AbilityScores): Ability {
  const props = item.weapon?.properties ?? []
  if (props.includes('ammunition')) return 'dex'
  if (props.includes('finesse')) return abilityModifier(abilities.dex) > abilityModifier(abilities.str) ? 'dex' : 'str'
  return 'str'
}

export function weaponAttacks(
  subject: AttackSubject,
  equipped: Equipment,
  catalog: ItemCatalog,
  training: MartialWeaponTraining,
): WeaponAttack[] {
  const attacks: WeaponAttack[] = []
  const pb = proficiencyBonus(subject.level)
  const hasFeat = (id: string) => subject.feats.includes(id)
  const twoHands = wieldedTwoHanded(equipped, catalog)

  for (const slot of ['mainHand', 'offHand'] as const) {
    const id = equipped[slot]
    const item = id ? catalog[id] : undefined
    if (!item?.weapon) continue
    const weapon = item.weapon
    const ability = attackAbility(item, subject.abilities)
    const mod = abilityModifier(subject.abilities[ability])
    const proficient = isWeaponProficient(item, training)
    const ranged = weapon.properties.includes('ammunition')
    const notes: string[] = []

    let attackBonus = mod + (proficient ? pb : 0)
    if (!proficient) notes.push('нет владения: бонус мастерства не добавляется')
    if (ranged && hasFeat('archery')) {
      attackBonus += 2
      notes.push('Стрельба: +2 к атаке')
    }

    const isMainTwoHanded = slot === 'mainHand' && twoHands
    const damageDice = isMainTwoHanded && weapon.versatileDamage ? weapon.versatileDamage : weapon.damage
    if (isMainTwoHanded && weapon.versatileDamage) notes.push('двумя руками')

    // Урон дополнительной атаки второй рукой: без модификатора (если он не отрицательный), кроме боя двумя оружиями.
    let damageBonus = mod
    if (slot === 'offHand') {
      notes.push('бонусное действие после атаки лёгким оружием')
      if (hasFeat('two-weapon-fighting')) notes.push('Бой двумя оружиями: модификатор к урону')
      else if (mod > 0) damageBonus = 0
    }
    if (isMainTwoHanded && !ranged && hasFeat('great-weapon-fighting')) notes.push('Бой большим оружием: 1 и 2 на кубиках урона считаются за 3')

    attacks.push({
      slot,
      itemId: item.id,
      name: item.name,
      ability,
      proficient,
      attackBonus,
      damageDice,
      damageBonus,
      damageType: weapon.damageType,
      twoHanded: isMainTwoHanded,
      notes,
    })
  }
  return attacks
}
