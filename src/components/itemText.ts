// Тексты для отображения предметов игроку.
import type { ArmorType, DamageType, ItemCategory, ItemDefinition, WeaponMastery, WeaponProperty } from '../types/items'

/** Владение доспехами текстом: «Лёгкие и средние доспехи, щиты», «Все доспехи, щиты», «нет». */
export function armorTrainingText(training: readonly ArmorType[]): string {
  const body = training.filter((t) => t !== 'shield')
  const names = { light: 'лёгкие', medium: 'средние', heavy: 'тяжёлые' } as const
  const parts: string[] = []
  if (body.length === 3) parts.push('все доспехи')
  else if (body.length > 0) {
    const list = body.map((t) => names[t as keyof typeof names])
    parts.push(`${list.length > 1 ? `${list.slice(0, -1).join(', ')} и ${list.at(-1)}` : list[0]} доспехи`)
  }
  if (training.includes('shield')) parts.push('щиты')
  if (parts.length === 0) return 'нет'
  const text = parts.join(', ')
  return text[0].toUpperCase() + text.slice(1)
}

export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  weapon: 'Оружие',
  armor: 'Доспехи',
  ammunition: 'Боеприпасы',
  gear: 'Снаряжение',
  tool: 'Инструменты',
  consumable: 'Расходуемое',
  treasure: 'Ценности',
}

const DAMAGE_LABELS: Record<DamageType, string> = {
  slashing: 'рубящий',
  piercing: 'колющий',
  bludgeoning: 'дробящий',
}

const PROPERTY_LABELS: Record<WeaponProperty, string> = {
  ammunition: 'боеприпасы',
  finesse: 'фехтовальное',
  heavy: 'тяжёлое',
  light: 'лёгкое',
  loading: 'перезарядка',
  reach: 'досягаемость',
  thrown: 'метательное',
  'two-handed': 'двуручное',
  versatile: 'универсальное',
}

const MASTERY_LABELS: Record<WeaponMastery, string> = {
  cleave: 'Рассечение',
  graze: 'Задевание',
  nick: 'Подрез',
  push: 'Толчок',
  sap: 'Ослабление',
  slow: 'Замедление',
  topple: 'Опрокидывание',
  vex: 'Досаждение',
}

const ARMOR_TYPE_LABELS = { light: 'Лёгкий доспех', medium: 'Средний доспех', heavy: 'Тяжёлый доспех', shield: 'Щит' }

/** «2d6» → «2к6», как принято в русских изданиях. */
export const formatDice = (dice: string) => dice.replace('d', 'к')

export const formatNumber = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })

export const formatWeight = (pounds: number) => `${formatNumber(pounds)} фнт.`

/** Короткая сводка: «2к6 рубящий» или «КД 16». */
export function itemSummary(item: ItemDefinition): string | null {
  if (item.weapon) return `${formatDice(item.weapon.damage)} ${DAMAGE_LABELS[item.weapon.damageType]}`
  if (item.armor) return item.armor.type === 'shield' ? `КД +${item.armor.baseAC}` : `КД ${item.armor.baseAC}`
  return null
}

/** Строки характеристик для раскрытого описания предмета. */
export function itemStatLines(item: ItemDefinition): [string, string][] {
  const lines: [string, string][] = []
  const w = item.weapon
  if (w) {
    let damage = `${formatDice(w.damage)} ${DAMAGE_LABELS[w.damageType]}`
    if (w.versatileDamage) damage += ` (двумя руками ${formatDice(w.versatileDamage)})`
    lines.push(['Урон', damage])
    if (w.properties.length > 0) lines.push(['Свойства', w.properties.map((p) => PROPERTY_LABELS[p]).join(', ')])
    if (w.range) lines.push(['Дистанция', `${w.range.normal}/${w.range.long} фт.`])
    if (w.mastery) lines.push(['Приём', MASTERY_LABELS[w.mastery]])
  }
  const a = item.armor
  if (a) {
    lines.push(['Тип', ARMOR_TYPE_LABELS[a.type]])
    lines.push(['КД', a.type === 'shield' ? `+${a.baseAC}` : String(a.baseAC)])
    if (a.strength) lines.push(['Требуется', `Сила ${a.strength}`])
    if (a.stealthDisadvantage) lines.push(['Скрытность', 'помеха'])
  }
  return lines
}
