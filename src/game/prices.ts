// Прейскурант еды, напитков, ночлега и услуг (SRD 5.2) — src/data/prices.json. Ведущий берёт цены отсюда:
// по id (change_gold с price) или называет свою цену в тексте и списывает ровно её. Чистые функции.
import { COIN_LABELS, COIN_UNITS, priceToCp, type CoinUnit } from './coins'
import { isNonEmptyString, isObject, isOneOf, ValidationError } from './validation'

export const PRICE_CATEGORIES = ['drink', 'food', 'lodging', 'service'] as const
export type PriceCategory = (typeof PRICE_CATEGORIES)[number]
export const PRICE_CATEGORY_LABELS: Record<PriceCategory, string> = { drink: 'Напитки', food: 'Еда', lodging: 'Ночлег', service: 'Услуги' }

export interface PriceEntry {
  id: string
  name: string
  category: PriceCategory
  price: { amount: number; unit: CoinUnit }
  /** Цена в медных. */
  cp: number
}

export type PriceList = Record<string, PriceEntry>

export function parsePrices(raw: unknown): PriceList {
  const problems: string[] = []
  const list: PriceList = {}
  const entries = isObject(raw) && Array.isArray(raw.entries) ? raw.entries : null
  if (!entries) throw new ValidationError('Некорректный прейскурант', ['ожидается { entries: [...] }'])
  entries.forEach((e: unknown, i) => {
    const where = `entries[${i}]`
    if (!isObject(e) || !isNonEmptyString(e.id) || !isNonEmptyString(e.name)) return problems.push(`${where}: нужны id и name`)
    if (list[e.id]) problems.push(`${where}: повторяющийся id "${e.id}"`)
    if (!isOneOf(PRICE_CATEGORIES, e.category)) problems.push(`${where}: category — ${PRICE_CATEGORIES.join(', ')}`)
    const price = isObject(e.price) ? (e.price as { amount?: unknown; unit?: unknown }) : {}
    const amount = typeof price.amount === 'number' ? price.amount : NaN
    const unit = isOneOf(COIN_UNITS, price.unit) ? price.unit : null
    const cp = unit && Number.isFinite(amount) ? priceToCp(amount, unit) : null
    if (!unit || !cp || cp <= 0) return problems.push(`${where}: price — { amount, unit: cp|sp|gp } на целое число медных`)
    list[e.id] = { id: e.id, name: e.name, category: e.category as PriceCategory, price: { amount, unit }, cp }
  })
  if (problems.length) throw new ValidationError('Некорректный прейскурант', problems)
  return list
}

export const formatPrice = (p: PriceEntry) => `${p.price.amount} ${COIN_LABELS[p.price.unit]}`

/** Прейскурант для системного промта ведущего: id — название — цена, по разделам. */
export function pricesText(prices: PriceList): string {
  const sections = PRICE_CATEGORIES.map((cat) => {
    const lines = Object.values(prices)
      .filter((p) => p.category === cat)
      .map((p) => `- ${p.id}: ${p.name} — ${formatPrice(p)}`)
    return lines.length ? `${PRICE_CATEGORY_LABELS[cat]}:\n${lines.join('\n')}` : ''
  })
  return `## Прейскурант (SRD 5.2; 1 зм = 10 см = 100 мм)\n${sections.filter(Boolean).join('\n')}\nПредметы снаряжения — по цене из справочника предметов.`
}
