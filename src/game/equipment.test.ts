import { describe, expect, it } from 'vitest'
import itemsJson from '../data/items.json'
import type { Equipment, Inventory } from '../types/character'
import { equipActions, equipItem, equipmentProblems, unequipSlot, wieldedTwoHanded } from './equipment'
import { parseItemCatalog } from './items'

const catalog = parseItemCatalog(itemsJson)

/** Инвентарь с набором предметов (id или [id, количество]) и экипировкой. */
function inv(items: (string | [string, number])[], equipped: Partial<Equipment> = {}): Inventory {
  return {
    coins: { gp: 0, sp: 0, cp: 0 },
    items: items.map((i) => (typeof i === 'string' ? { itemId: i, quantity: 1 } : { itemId: i[0], quantity: i[1] })),
    equipped: { mainHand: null, offHand: null, armor: null, ...equipped },
  }
}

const reasonOf = (result: ReturnType<typeof equipItem>) => (result.ok ? null : result.reason)

describe('equipActions', () => {
  it('оружие — в руки, лёгкое — ещё и во вторую руку, щит и доспех — надеть', () => {
    expect(equipActions(catalog.greatsword).map((a) => a.label)).toEqual(['Взять в руки'])
    expect(equipActions(catalog.dagger).map((a) => a.slot)).toEqual(['mainHand', 'offHand'])
    expect(equipActions(catalog.shield)).toEqual([{ slot: 'offHand', label: 'Надеть' }])
    expect(equipActions(catalog['chain-mail'])).toEqual([{ slot: 'armor', label: 'Надеть' }])
    expect(equipActions(catalog.rope)).toEqual([])
  })
})

describe('equipItem: руки', () => {
  it('берёт оружие в основную руку, заменяя прежнее', () => {
    const result = equipItem(inv(['greatsword', 'mace'], { mainHand: 'greatsword' }), catalog, 'mace', 'mainHand')
    expect(result).toEqual({ ok: true, equipped: { mainHand: 'mace', offHand: null, armor: null } })
  })

  it('одноручное оружие и щит — можно', () => {
    expect(equipItem(inv(['mace', 'shield'], { mainHand: 'mace' }), catalog, 'shield', 'offHand')).toMatchObject({ ok: true })
  })

  it('двуручное оружие при щите во второй руке — нельзя, с объяснением', () => {
    expect(reasonOf(equipItem(inv(['greatsword', 'shield'], { offHand: 'shield' }), catalog, 'greatsword', 'mainHand'))).toBe(
      '«Двуручный меч» — двуручное оружие и занимает обе руки. Сначала уберите «Щит» из второй руки.',
    )
  })

  it('щит при двуручном оружии — нельзя', () => {
    expect(reasonOf(equipItem(inv(['greatsword', 'shield'], { mainHand: 'greatsword' }), catalog, 'shield', 'offHand'))).toBe(
      'Обе руки заняты двуручным «Двуручный меч». Сначала уберите его.',
    )
  })

  it('два лёгких оружия — можно; второй экземпляр того же оружия — если их два', () => {
    expect(equipItem(inv(['shortsword', 'scimitar'], { mainHand: 'shortsword' }), catalog, 'scimitar', 'offHand')).toMatchObject({ ok: true })
    expect(equipItem(inv([['dagger', 2]], { mainHand: 'dagger' }), catalog, 'dagger', 'offHand')).toMatchObject({
      ok: true,
      equipped: { mainHand: 'dagger', offHand: 'dagger' },
    })
    expect(reasonOf(equipItem(inv(['dagger'], { mainHand: 'dagger' }), catalog, 'dagger', 'offHand'))).toBe(
      'У вас только 1 шт. «Кинжал» — он уже в другой руке.',
    )
  })

  it('во вторую руку — только лёгкое оружие и только в пару к лёгкому', () => {
    expect(reasonOf(equipItem(inv(['mace', 'longsword'], { mainHand: 'mace' }), catalog, 'longsword', 'offHand'))).toBe(
      '«Длинный меч» не лёгкое — во вторую руку можно взять только лёгкое оружие',
    )
    expect(reasonOf(equipItem(inv(['mace', 'dagger'], { mainHand: 'mace' }), catalog, 'dagger', 'offHand'))).toBe(
      'Два оружия можно держать, только если оба лёгкие, а «Булава» в основной руке не лёгкое.',
    )
    expect(reasonOf(equipItem(inv(['dagger']), catalog, 'dagger', 'offHand'))).toBe(
      'Сначала возьмите лёгкое оружие в основную руку — второе оружие берут в пару к нему.',
    )
  })

  it('нелёгкое оружие в основную руку, когда во второй — оружие, нельзя', () => {
    expect(reasonOf(equipItem(inv(['shortsword', 'dagger', 'longsword'], { mainHand: 'shortsword', offHand: 'dagger' }), catalog, 'longsword', 'mainHand'))).toBe(
      'Во второй руке «Кинжал»: держать два оружия можно, только если оба лёгкие, а «Длинный меч» не лёгкое. Сначала уберите «Кинжал».',
    )
  })

  it('доспех надевается в слот доспеха, предметы не из инвентаря и не экипировка — отказ', () => {
    expect(equipItem(inv(['leather-armor', 'chain-mail'], { armor: 'leather-armor' }), catalog, 'chain-mail', 'armor')).toMatchObject({
      ok: true,
      equipped: { armor: 'chain-mail' },
    })
    expect(reasonOf(equipItem(inv([]), catalog, 'longsword', 'mainHand'))).toBe('Этого предмета нет в инвентаре')
    expect(reasonOf(equipItem(inv(['rope']), catalog, 'rope', 'mainHand'))).toBe('«Верёвка (50 футов)» нельзя взять в руки')
    expect(reasonOf(equipItem(inv(['shield']), catalog, 'shield', 'armor'))).toBe('«Щит» не доспех')
  })

  it('unequipSlot освобождает слот', () => {
    expect(unequipSlot({ mainHand: 'mace', offHand: 'shield', armor: null }, 'offHand')).toEqual({ mainHand: 'mace', offHand: null, armor: null })
  })
})

describe('equipmentProblems и хват', () => {
  it('находит несовместимую экипировку из сохранения', () => {
    expect(equipmentProblems({ mainHand: 'greatsword', offHand: 'shield', armor: null }, inv(['greatsword', 'shield']), catalog)).toEqual([
      '«Двуручный меч» — двуручное оружие и занимает обе руки, а во второй руке «Щит»',
    ])
    expect(equipmentProblems({ mainHand: 'dagger', offHand: 'dagger', armor: null }, inv(['dagger']), catalog)).toEqual([
      'У вас только 1 шт. «Кинжал», а экипировано 2',
    ])
  })

  it('двуручное и универсальное при свободной руке держатся двумя руками', () => {
    expect(wieldedTwoHanded({ mainHand: 'greatsword', offHand: null, armor: null }, catalog)).toBe(true)
    expect(wieldedTwoHanded({ mainHand: 'longsword', offHand: null, armor: null }, catalog)).toBe(true)
    expect(wieldedTwoHanded({ mainHand: 'longsword', offHand: 'shield', armor: null }, catalog)).toBe(false)
    expect(wieldedTwoHanded({ mainHand: 'mace', offHand: null, armor: null }, catalog)).toBe(false)
  })
})
