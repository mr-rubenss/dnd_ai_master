import { describe, expect, it } from 'vitest'
import itemsJson from '../data/items.json'
import type { Equipment } from '../types/character'
import { isWeaponProficient, weaponAttacks, type AttackSubject } from './attacks'
import { parseItemCatalog } from './items'

const catalog = parseItemCatalog(itemsJson)
/** СИЛ 17 (+3), ЛОВ 14 (+2), 1-й уровень (БМ +2). */
const fighter = (feats: string[] = []): AttackSubject => ({
  level: 1,
  abilities: { str: 17, dex: 14, con: 14, int: 8, wis: 12, cha: 10 },
  feats,
})
const hands = (mainHand: string | null, offHand: string | null = null): Equipment => ({ mainHand, offHand, armor: null })

describe('владение оружием', () => {
  it('простое — все; воинское — по классу', () => {
    expect(isWeaponProficient(catalog.dagger, 'none')).toBe(true)
    expect(isWeaponProficient(catalog.longsword, 'none')).toBe(false)
    expect(isWeaponProficient(catalog.longsword, 'all')).toBe(true)
    expect(isWeaponProficient(catalog.shortsword, 'light')).toBe(true) // Монах: лёгкое воинское
    expect(isWeaponProficient(catalog.longsword, 'light')).toBe(false)
    expect(isWeaponProficient(catalog.scimitar, 'finesse-or-light')).toBe(true) // Плут
    expect(isWeaponProficient(catalog.greatsword, 'finesse-or-light')).toBe(false)
  })
})

describe('weaponAttacks', () => {
  it('двуручный меч Ратибора: атака +5, урон 2к6+3, Бой большим оружием', () => {
    const [attack] = weaponAttacks(fighter(['great-weapon-fighting']), hands('greatsword'), catalog, 'all')
    expect(attack).toMatchObject({ slot: 'mainHand', ability: 'str', attackBonus: 5, damageDice: '2d6', damageBonus: 3, twoHanded: true })
    expect(attack.notes).toContain('Бой большим оружием: 1 и 2 на кубиках урона считаются за 3')
  })

  it('универсальное оружие: двумя руками — большая кость, со щитом — обычная', () => {
    expect(weaponAttacks(fighter(), hands('longsword'), catalog, 'all')[0]).toMatchObject({ damageDice: '1d10', twoHanded: true })
    expect(weaponAttacks(fighter(), hands('longsword', 'shield'), catalog, 'all')[0]).toMatchObject({ damageDice: '1d8', twoHanded: false })
  })

  it('фехтовальное оружие берёт лучшую из Силы и Ловкости, дальнобойное — Ловкость', () => {
    const nimble = { ...fighter(), abilities: { ...fighter().abilities, str: 10, dex: 18 } }
    expect(weaponAttacks(nimble, hands('scimitar'), catalog, 'all')[0]).toMatchObject({ ability: 'dex', attackBonus: 6 })
    expect(weaponAttacks(fighter(), hands('shortbow'), catalog, 'all')[0]).toMatchObject({ ability: 'dex', attackBonus: 4 })
  })

  it('Стрельба: +2 к атаке дальнобойным оружием', () => {
    const [attack] = weaponAttacks(fighter(['archery']), hands('longbow'), catalog, 'all')
    expect(attack.attackBonus).toBe(2 + 2 + 2)
    expect(attack.notes).toContain('Стрельба: +2 к атаке')
  })

  it('вторая рука: урон без модификатора, с Боем двумя оружиями — с модификатором', () => {
    const plain = weaponAttacks(fighter(), hands('shortsword', 'scimitar'), catalog, 'all')
    expect(plain.map((a) => [a.slot, a.damageBonus])).toEqual([
      ['mainHand', 3],
      ['offHand', 0],
    ])
    const twf = weaponAttacks(fighter(['two-weapon-fighting']), hands('shortsword', 'scimitar'), catalog, 'all')
    expect(twf[1].damageBonus).toBe(3)
  })

  it('без владения бонус мастерства не добавляется', () => {
    const [attack] = weaponAttacks(fighter(), hands('greatsword'), catalog, 'none')
    expect(attack).toMatchObject({ proficient: false, attackBonus: 3 })
    expect(attack.notes).toContain('нет владения: бонус мастерства не добавляется')
  })

  it('щит и пустые руки — атак оружием нет', () => {
    expect(weaponAttacks(fighter(), hands(null, 'shield'), catalog, 'all')).toEqual([])
  })
})
