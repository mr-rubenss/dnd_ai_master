import { describe, expect, it } from 'vitest'
import itemsJson from '../data/items.json'
import backgroundsJson from '../data/rules/backgrounds.json'
import featsJson from '../data/rules/feats.json'
import type { FeatDefinition } from '../types/rules'
import {
  BACKGROUND_TEMPLATE,
  buildCustomBackground,
  emptyCustomBackground,
  equipmentCost,
  validateBackgroundTemplate,
  type CustomBackgroundInput,
} from './backgroundTemplate'
import { parseItemCatalog } from './items'

const catalog = parseItemCatalog(itemsJson)
const feats = Object.fromEntries((featsJson as FeatDefinition[]).map((f) => [f.id, f]))
const ctx = { feats, catalog }

/** Корабельный юнга: корректная своя предыстория. */
function sailor(patch: Partial<CustomBackgroundInput> = {}): CustomBackgroundInput {
  return {
    ...emptyCustomBackground(),
    name: 'Корабельный юнга',
    abilities: ['str', 'dex', 'wis'],
    skills: ['athletics', 'perception'],
    tool: 'navigators-tools',
    feat: 'alert',
    items: [
      { itemId: 'rope', quantity: 2 },
      { itemId: 'dagger', quantity: 1 },
    ],
    ...patch,
  }
}

const check = (input: CustomBackgroundInput) => validateBackgroundTemplate(buildCustomBackground(input, catalog), ctx)

describe('шаблон предыстории 2024', () => {
  it('все четыре предыстории SRD укладываются в шаблон', () => {
    for (const bg of backgroundsJson) expect(validateBackgroundTemplate(bg, ctx), bg.id).toEqual([])
  })

  it('корректная своя предыстория проходит', () => {
    expect(check(sailor())).toEqual([])
  })

  it('сдача от 50 зм остаётся золотом, вариант B — 50 зм', () => {
    const bg = buildCustomBackground(sailor(), catalog)
    expect(equipmentCost(sailor().items, catalog)).toBe(4)
    expect(bg.equipment).toEqual([
      { id: 'A', items: [{ itemId: 'rope', quantity: 2 }, { itemId: 'dagger', quantity: 1 }], gold: 46 },
      { id: 'B', items: [], gold: 50 },
    ])
    expect(bg).toMatchObject({ id: 'custom', name: 'Корабельный юнга', tool: { itemId: 'navigators-tools' }, feat: 'alert' })
  })

  it('объясняет каждое нарушение шаблона', () => {
    expect(check(sailor({ name: '  ' }))).toEqual(['Введите название предыстории'])
    expect(check(sailor({ abilities: ['str', 'dex'] }))).toEqual(['Выберите 3 разные характеристики для прибавок (выбрано 2)'])
    expect(check(sailor({ skills: ['athletics', 'athletics'] }))).toEqual(['Выберите 2 разных навыка (выбрано 2)'])
    expect(check(sailor({ tool: 'rope' }))).toEqual(['Выберите один инструмент'])
    expect(check(sailor({ feat: null }))).toEqual(['Выберите черту происхождения'])
    expect(check(sailor({ feat: 'defense' }))).toEqual(['«Оборона» — не черта происхождения'])
  })

  it(`снаряжение — не дороже ${BACKGROUND_TEMPLATE.budget} зм и только покупаемые предметы`, () => {
    expect(check(sailor({ items: [{ itemId: 'chain-mail', quantity: 1 }] }))).toEqual(['Снаряжение стоит 75 зм — больше 50 зм'])
    expect(check(sailor({ items: [{ itemId: 'silver-amulet', quantity: 1 }] }))).toEqual(['«Серебряный амулет» нельзя купить'])
    // 3 длинных меча (45 зм) и 2 кинжала (4 зм) — 49 зм, укладывается.
    expect(check(sailor({ items: [{ itemId: 'longsword', quantity: 3 }, { itemId: 'dagger', quantity: 2 }] }))).toEqual([])
  })

  it('проверяет произвольные данные — например, предысторию, предложенную ИИ', () => {
    expect(validateBackgroundTemplate('строка', ctx)).toEqual(['Предыстория должна быть объектом'])
    const fromAi = {
      name: 'Охотник за головами',
      abilities: ['str', 'dex', 'luck'],
      skills: ['tracking', 'stealth'],
      tool: { choose: 'weapons' },
      feat: 'great-weapon-fighting',
      equipment: [{ id: 'A', items: [{ itemId: 'longbow', quantity: 1 }, { packId: 'explorers-pack' }], gold: 10 }],
    }
    expect(validateBackgroundTemplate(fromAi, ctx)).toEqual([
      'Выберите 3 разные характеристики для прибавок (выбрано 3)',
      'Выберите 2 разных навыка (выбрано 2)',
      'Выберите один инструмент',
      '«Бой большим оружием» — не черта происхождения',
      'Снаряжение предыстории — только предметы из справочника',
      'Снаряжение стоит 50 зм и ещё 10 зм золотом — больше 50 зм',
    ])
  })
})
