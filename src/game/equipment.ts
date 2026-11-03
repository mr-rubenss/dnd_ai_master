// Экипировка: что можно взять в руки и надеть (SRD 5.2). Чистые функции.
// Основная рука держит оружие. Вторая — щит или второе лёгкое оружие (если в основной тоже лёгкое).
// Двуручное оружие занимает обе руки. Вне боя менять экипировку можно свободно;
// ограничения по действиям в бою появятся вместе с боевой системой.
import type { Equipment, Inventory } from '../types/character'
import type { ItemCatalog, ItemDefinition } from '../types/items'

export const EQUIPMENT_SLOTS = ['mainHand', 'offHand', 'armor'] as const
export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number]

export const SLOT_NAMES: Record<EquipmentSlot, string> = {
  mainHand: 'Основная рука',
  offHand: 'Вторая рука',
  armor: 'Доспех',
}

export const EMPTY_EQUIPMENT: Equipment = { mainHand: null, offHand: null, armor: null }

export type EquipResult = { ok: true; equipped: Equipment } | { ok: false; reason: string }

const quote = (item: ItemDefinition | undefined) => `«${item?.name ?? '?'}»`
const isTwoHanded = (item: ItemDefinition | undefined) => Boolean(item?.weapon?.properties.includes('two-handed'))
const isLight = (item: ItemDefinition | undefined) => Boolean(item?.weapon?.properties.includes('light'))
const isShield = (item: ItemDefinition | undefined) => item?.armor?.type === 'shield'
const isBodyArmor = (item: ItemDefinition | undefined) => Boolean(item?.armor && item.armor.type !== 'shield')

/** Что делает кнопка экипировки для предмета: «Взять в руки», «Во вторую руку», «Надеть». */
export interface EquipAction {
  slot: EquipmentSlot
  label: string
}

/** Какими способами можно экипировать предмет (без проверки совместимости — её делает equipItem). */
export function equipActions(item: ItemDefinition): EquipAction[] {
  if (item.weapon) {
    const actions: EquipAction[] = [{ slot: 'mainHand', label: 'Взять в руки' }]
    if (isLight(item)) actions.push({ slot: 'offHand', label: 'Во вторую руку' })
    return actions
  }
  if (isShield(item)) return [{ slot: 'offHand', label: 'Надеть' }]
  if (isBodyArmor(item)) return [{ slot: 'armor', label: 'Надеть' }]
  return []
}

/** Проверяет экипировку целиком. Пустой список — всё допустимо. */
export function equipmentProblems(equipped: Equipment, inventory: Inventory, catalog: ItemCatalog): string[] {
  const problems: string[] = []
  const quantity = new Map(inventory.items.map((e) => [e.itemId, e.quantity]))
  const used = new Map<string, number>()
  for (const slot of EQUIPMENT_SLOTS) {
    const id = equipped[slot]
    if (id === null) continue
    const item = catalog[id]
    if (!item || !quantity.has(id)) {
      problems.push(`${SLOT_NAMES[slot]}: предмета «${id}» нет в инвентаре`)
      continue
    }
    used.set(id, (used.get(id) ?? 0) + 1)
    if (slot === 'mainHand' && !item.weapon) problems.push(`${SLOT_NAMES.mainHand}: ${quote(item)} — не оружие`)
    if (slot === 'offHand' && !item.weapon && !isShield(item)) problems.push(`${SLOT_NAMES.offHand}: ${quote(item)} — не оружие и не щит`)
    if (slot === 'armor' && !isBodyArmor(item)) problems.push(`${SLOT_NAMES.armor}: ${quote(item)} — не доспех`)
  }
  for (const [id, count] of used) {
    if (count > (quantity.get(id) ?? 0)) problems.push(`У вас только ${quantity.get(id)} шт. ${quote(catalog[id])}, а экипировано ${count}`)
  }

  const main = equipped.mainHand ? catalog[equipped.mainHand] : undefined
  const off = equipped.offHand ? catalog[equipped.offHand] : undefined
  if (off && isTwoHanded(main)) {
    problems.push(`${quote(main)} — двуручное оружие и занимает обе руки, а во второй руке ${quote(off)}`)
  }
  if (off?.weapon && !isTwoHanded(main)) {
    if (!isLight(off)) problems.push(`${quote(off)} не лёгкое — во вторую руку можно взять только лёгкое оружие`)
    else if (!main?.weapon) problems.push(`Чтобы держать ${quote(off)} во второй руке, в основной нужно лёгкое оружие`)
    else if (!isLight(main)) problems.push(`Два оружия можно держать, только если оба лёгкие, а ${quote(main)} не лёгкое`)
  }
  return problems
}

/**
 * Экипирует предмет в слот. Предмет в том же слоте заменяется; если новый предмет несовместим
 * с другой рукой — экипировка не меняется, а причина объясняется игроку.
 */
export function equipItem(inventory: Inventory, catalog: ItemCatalog, itemId: string, slot: EquipmentSlot): EquipResult {
  const item = catalog[itemId]
  const owned = inventory.items.find((e) => e.itemId === itemId)
  if (!item || !owned) return { ok: false, reason: 'Этого предмета нет в инвентаре' }
  if (!equipActions(item).some((a) => a.slot === slot)) {
    const why =
      slot === 'armor' ? 'не доспех' : slot === 'offHand' && item.weapon ? 'не лёгкое — во вторую руку можно взять только лёгкое оружие' : 'нельзя взять в руки'
    return { ok: false, reason: `${quote(item)} ${why}` }
  }

  const current = inventory.equipped
  const next: Equipment = { ...current, [slot]: itemId }
  const otherHand = slot === 'mainHand' ? next.offHand : slot === 'offHand' ? next.mainHand : null
  const other = otherHand ? catalog[otherHand] : undefined

  // Понятные причины для типичных конфликтов рук.
  if (slot === 'mainHand' && isTwoHanded(item) && other) {
    return { ok: false, reason: `${quote(item)} — двуручное оружие и занимает обе руки. Сначала уберите ${quote(other)} из второй руки.` }
  }
  if (slot === 'mainHand' && other?.weapon && !isLight(item)) {
    return {
      ok: false,
      reason: `Во второй руке ${quote(other)}: держать два оружия можно, только если оба лёгкие, а ${quote(item)} не лёгкое. Сначала уберите ${quote(other)}.`,
    }
  }
  if (slot === 'offHand' && isTwoHanded(other)) {
    return { ok: false, reason: `Обе руки заняты двуручным ${quote(other)}. Сначала уберите его.` }
  }
  if (slot === 'offHand' && item.weapon && !other?.weapon) {
    return { ok: false, reason: `Сначала возьмите лёгкое оружие в основную руку — второе оружие берут в пару к нему.` }
  }
  if (slot === 'offHand' && item.weapon && !isLight(other)) {
    return { ok: false, reason: `Два оружия можно держать, только если оба лёгкие, а ${quote(other)} в основной руке не лёгкое.` }
  }

  const copiesUsed = EQUIPMENT_SLOTS.filter((s) => next[s] === itemId).length
  if (copiesUsed > owned.quantity) {
    return { ok: false, reason: `У вас только ${owned.quantity} шт. ${quote(item)} — он уже в другой руке.` }
  }

  const problems = equipmentProblems(next, inventory, catalog)
  if (problems.length > 0) return { ok: false, reason: problems[0] }
  return { ok: true, equipped: next }
}

/** Убирает предмет из слота. */
export function unequipSlot(equipped: Equipment, slot: EquipmentSlot): Equipment {
  return { ...equipped, [slot]: null }
}

/** Держит ли персонаж оружие основной руки двумя руками (двуручное или универсальное при свободной второй руке). */
export function wieldedTwoHanded(equipped: Equipment, catalog: ItemCatalog): boolean {
  const main = equipped.mainHand ? catalog[equipped.mainHand] : undefined
  if (!main?.weapon) return false
  return isTwoHanded(main) || (main.weapon.properties.includes('versatile') && equipped.offHand === null)
}
