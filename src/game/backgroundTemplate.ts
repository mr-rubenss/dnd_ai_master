// Шаблон предыстории D&D 2024 (SRD 5.2): три характеристики для прибавок, два навыка, один инструмент,
// одна черта происхождения и снаряжение не дороже 50 зм (или 50 зм золотом).
// Этой же функцией проверяются своя предыстория игрока и предыстория, предложенная ИИ.
import { ABILITIES, type Ability } from '../engine/abilities'
import { SKILLS, type SkillId } from '../engine/skills'
import type { InventoryEntry } from '../types/character'
import { TOOL_KINDS, type ItemCatalog, type ToolKind } from '../types/items'
import type { BackgroundDefinition, EquipmentOption, FeatDefinition, ToolGrant } from '../types/rules'
import { isInt, isObject } from './validation'

export const BACKGROUND_TEMPLATE = {
  abilities: 3,
  skills: 2,
  /** Бюджет снаряжения в зм. */
  budget: 50,
  maxNameLength: 40,
  maxDescriptionLength: 300,
} as const

export interface TemplateContext {
  feats: Record<string, FeatDefinition>
  catalog: ItemCatalog
}

/** Покупаемые предметы — у которых есть цена. */
export function purchasableItems(catalog: ItemCatalog) {
  return Object.values(catalog).filter((item) => item.cost !== undefined)
}

/** Самый дорогой инструмент вида — так оценивается стоимость «инструмента на выбор». */
function maxToolCost(kind: ToolKind, catalog: ItemCatalog): number {
  return Math.max(0, ...Object.values(catalog).filter((i) => i.toolKind === kind).map((i) => i.cost ?? 0))
}

/** Стоимость строк снаряжения в зм (с округлением до медной монеты). */
export function equipmentCost(lines: InventoryEntry[], catalog: ItemCatalog): number {
  const total = lines.reduce((sum, line) => sum + (catalog[line.itemId]?.cost ?? 0) * line.quantity, 0)
  return Math.round(total * 100) / 100
}

/**
 * Проверяет предысторию по шаблону 2024. Принимает произвольные данные (JSON от игрока или ИИ)
 * и возвращает список нарушений на русском; пустой список — предыстория допустима.
 */
export function validateBackgroundTemplate(raw: unknown, { feats, catalog }: TemplateContext): string[] {
  const problems: string[] = []
  const fail = (message: string) => problems.push(message)
  if (!isObject(raw)) return ['Предыстория должна быть объектом']

  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name) fail('Введите название предыстории')
  else if (name.length > BACKGROUND_TEMPLATE.maxNameLength) fail(`Название — не длиннее ${BACKGROUND_TEMPLATE.maxNameLength} символов`)
  if (typeof raw.description === 'string' && raw.description.length > BACKGROUND_TEMPLATE.maxDescriptionLength) {
    fail(`Описание — не длиннее ${BACKGROUND_TEMPLATE.maxDescriptionLength} символов`)
  }

  const abilities = Array.isArray(raw.abilities) ? raw.abilities : []
  if (
    abilities.length !== BACKGROUND_TEMPLATE.abilities ||
    !abilities.every((a) => (ABILITIES as readonly unknown[]).includes(a)) ||
    new Set(abilities).size !== abilities.length
  ) {
    fail(`Выберите ${BACKGROUND_TEMPLATE.abilities} разные характеристики для прибавок (выбрано ${abilities.length})`)
  }

  const skills = Array.isArray(raw.skills) ? raw.skills : []
  if (
    skills.length !== BACKGROUND_TEMPLATE.skills ||
    !skills.every((s) => (SKILLS as readonly unknown[]).includes(s)) ||
    new Set(skills).size !== skills.length
  ) {
    fail(`Выберите ${BACKGROUND_TEMPLATE.skills} разных навыка (выбрано ${skills.length})`)
  }

  const tool = raw.tool as Partial<ToolGrant> | undefined
  const toolValid = isObject(tool)
    ? typeof tool.itemId === 'string'
      ? catalog[tool.itemId]?.toolKind !== undefined
      : (TOOL_KINDS as readonly unknown[]).includes(tool.choose)
    : false
  if (!toolValid) fail('Выберите один инструмент')

  const feat = typeof raw.feat === 'string' ? feats[raw.feat] : undefined
  if (!feat) fail('Выберите черту происхождения')
  else if (feat.category !== 'origin') fail(`«${feat.name}» — не черта происхождения`)

  const options = Array.isArray(raw.equipment) ? (raw.equipment as EquipmentOption[]) : []
  if (options.length === 0) fail('Нет вариантов снаряжения')
  for (const option of options) {
    if (!isObject(option) || !Array.isArray(option.items) || typeof option.gold !== 'number' || option.gold < 0) {
      fail('Вариант снаряжения: нужны предметы и золото')
      continue
    }
    let cost = 0
    for (const line of option.items) {
      if (line.chosenTool === 'background') {
        cost += tool?.choose ? maxToolCost(tool.choose, catalog) : (catalog[tool?.itemId ?? '']?.cost ?? 0)
        continue
      }
      const item = line.itemId ? catalog[line.itemId] : undefined
      const quantity = 'quantity' in line && line.quantity !== undefined ? line.quantity : 1
      if (!item || line.packId !== undefined || line.chosenTool !== undefined) {
        fail('Снаряжение предыстории — только предметы из справочника')
      } else if (item.cost === undefined) {
        fail(`«${item.name}» нельзя купить`)
      } else if (!isInt(quantity) || quantity < 1) {
        fail(`Количество «${item.name}» — положительное целое`)
      } else {
        cost += item.cost * quantity
      }
    }
    const total = Math.round((cost + option.gold) * 100) / 100
    if (total > BACKGROUND_TEMPLATE.budget) {
      fail(`Снаряжение стоит ${formatGold(Math.round(cost * 100) / 100)} зм${option.gold ? ` и ещё ${formatGold(option.gold)} зм золотом` : ''} — больше ${BACKGROUND_TEMPLATE.budget} зм`)
    }
  }

  return [...new Set(problems)]
}

export const formatGold = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })

/** Своя предыстория в черновике создания персонажа. */
export interface CustomBackgroundInput {
  name: string
  description: string
  abilities: Ability[]
  skills: SkillId[]
  tool: string | null
  feat: string | null
  /** Набор снаряжения (вариант A); остаток бюджета превращается в золото. */
  items: InventoryEntry[]
}

export const CUSTOM_BACKGROUND_ID = 'custom'

export function emptyCustomBackground(): CustomBackgroundInput {
  return { name: '', description: '', abilities: [], skills: [], tool: null, feat: null, items: [] }
}

/** Собирает определение предыстории из ввода игрока: вариант A — выбранный набор и сдача, вариант B — 50 зм. */
export function buildCustomBackground(input: CustomBackgroundInput, catalog: ItemCatalog): BackgroundDefinition {
  const cost = equipmentCost(input.items, catalog)
  const leftover = Math.max(0, Math.round((BACKGROUND_TEMPLATE.budget - cost) * 100) / 100)
  return {
    id: CUSTOM_BACKGROUND_ID,
    name: input.name.trim(),
    description: input.description.trim(),
    abilities: input.abilities as BackgroundDefinition['abilities'],
    feat: input.feat ?? '',
    skills: input.skills,
    tool: { itemId: input.tool ?? '' },
    equipment: [
      { id: 'A', items: input.items.map((i) => ({ itemId: i.itemId, quantity: i.quantity })), gold: leftover },
      { id: 'B', items: [], gold: BACKGROUND_TEMPLATE.budget },
    ],
  }
}
