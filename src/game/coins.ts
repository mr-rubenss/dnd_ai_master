// Кошелёк героя: медные (мм), серебряные (см) и золотые (зм) монеты. 1 зм = 10 см = 100 мм (SRD 5.2).
// Платёж — монетами со сдачей: сначала мелкими, потом крупными; если без размена не выходит — разменивается одна
// монета крупнее, сдача — серебром и медью. Чистые функции, всё в целых монетах.

export interface Coins {
  /** Золотые монеты. */
  gp: number
  /** Серебряные монеты. */
  sp: number
  /** Медные монеты. */
  cp: number
}

export const COIN_UNITS = ['cp', 'sp', 'gp'] as const
export type CoinUnit = (typeof COIN_UNITS)[number]
/** Сколько медных в монете. */
export const COIN_VALUE: Record<CoinUnit, number> = { cp: 1, sp: 10, gp: 100 }
export const COIN_LABELS: Record<CoinUnit, string> = { cp: 'мм', sp: 'см', gp: 'зм' }

export const NO_COINS: Coins = { gp: 0, sp: 0, cp: 0 }

/** Стоимость кошелька в медных. */
export const coinsValue = (c: Coins) => c.gp * 100 + c.sp * 10 + c.cp

/** Сумма в медных → монеты (крупными, как обычно отсчитывают). */
export function coinsFromCp(cp: number): Coins {
  const total = Math.max(0, Math.round(cp))
  return { gp: Math.floor(total / 100), sp: Math.floor((total % 100) / 10), cp: total % 10 }
}

/** Сумма в золотых (как в справочнике: 0,04 зм = 4 мм) → медные. */
export const gpToCp = (gp: number) => Math.round(gp * 100)

/** Старое сохранение: золото числом (с дробной частью) → монеты. */
export const coinsFromGold = (gold: number) => coinsFromCp(gpToCp(gold))

export const isCoins = (v: unknown): v is Coins =>
  !!v &&
  typeof v === 'object' &&
  COIN_UNITS.every((u) => Number.isInteger((v as Record<string, unknown>)[u]) && ((v as Record<string, number>)[u] ?? -1) >= 0)

/** Получить деньги: добавляются монетами (крупными). */
export function addCoins(purse: Coins, cp: number): Coins {
  const add = coinsFromCp(cp)
  return { gp: purse.gp + add.gp, sp: purse.sp + add.sp, cp: purse.cp + add.cp }
}

/**
 * Заплатить `cost` медных: сначала медью, потом серебром, потом золотом; если ровно не выходит — размен одной монеты
 * (серебряной, если не хватает меньше 10 мм, иначе золотой) со сдачей. null — денег не хватает.
 */
export function payCoins(purse: Coins, cost: number): Coins | null {
  if (!Number.isInteger(cost) || cost < 0) return null
  if (coinsValue(purse) < cost) return null
  let { gp, sp, cp } = purse
  let rest = cost
  const takeCp = Math.min(cp, rest)
  cp -= takeCp
  rest -= takeCp
  const takeSp = Math.min(sp, Math.floor(rest / 10))
  sp -= takeSp
  rest -= takeSp * 10
  const takeGp = Math.min(gp, Math.floor(rest / 100))
  gp -= takeGp
  rest -= takeGp * 100
  if (rest > 0 && sp > 0 && rest < 10) {
    sp -= 1
    cp += 10 - rest
    rest = 0
  }
  if (rest > 0 && gp > 0) {
    gp -= 1
    const change = 100 - rest
    sp += Math.floor(change / 10)
    cp += change % 10
    rest = 0
  }
  // Остаток мог остаться, если серебра не хватило на десятки, а золота нет: доплачиваем оставшимися монетами.
  if (rest > 0) {
    const left = coinsValue({ gp, sp, cp }) - rest
    return left < 0 ? null : coinsFromCp(left)
  }
  return { gp, sp, cp }
}

/** Изменить кошелёк на `delta` медных (плюс — получил, минус — заплатил). null — денег не хватает. */
export const changeCoins = (purse: Coins, delta: number) => (delta >= 0 ? addCoins(purse, delta) : payCoins(purse, -delta))

/** «18 зм 5 см 3 мм» (нулевые номиналы пропускаются; пустой кошелёк — «0 мм»). */
export function formatCoins(c: Coins): string {
  const parts = [c.gp ? `${c.gp} зм` : '', c.sp ? `${c.sp} см` : '', c.cp ? `${c.cp} мм` : ''].filter(Boolean)
  return parts.length ? parts.join(' ') : '0 мм'
}

/** Сумма в медных — коротко: «4 мм», «5 см», «2 зм 5 см». */
export const formatCp = (cp: number) => formatCoins(coinsFromCp(Math.abs(cp)))

/** Цена в монетах: число и номинал → медные; null — не целое число медных. */
export function priceToCp(amount: number, unit: CoinUnit): number | null {
  const cp = amount * COIN_VALUE[unit]
  const rounded = Math.round(cp)
  return Math.abs(cp - rounded) < 1e-9 ? rounded : null
}
