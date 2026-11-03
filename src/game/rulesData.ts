// Загрузка и проверка данных для создания персонажа. Проверяются ссылки на навыки,
// характеристики, черты, наборы и предметы справочника — чтобы ошибка в JSON
// (в том числе сгенерированном ИИ) не дошла до игры.
import { ABILITIES } from '../engine/abilities'
import { SKILLS } from '../engine/skills'
import type { ItemCatalog } from '../types/items'
import type {
  BackgroundDefinition,
  ClassDefinition,
  EquipmentOption,
  FeatDefinition,
  PackDefinition,
  RulesData,
  SkillChoice,
  SpeciesDefinition,
} from '../types/rules'
import { isInt, isNonEmptyString, isObject, ValidationError } from './validation'

export interface RawRulesData {
  classes: unknown
  backgrounds: unknown
  species: unknown
  feats: unknown
  packs: unknown
}

const isAbility = (value: unknown) => (ABILITIES as readonly unknown[]).includes(value)
const isSkill = (value: unknown) => (SKILLS as readonly unknown[]).includes(value)

export function parseRulesData(raw: RawRulesData, catalog: ItemCatalog): RulesData {
  const problems: string[] = []
  const fail = (message: string) => problems.push(message)

  const byId = <T>(list: unknown, file: string, check: (entry: Record<string, unknown>, where: string) => void) => {
    const result: Record<string, T> = {}
    if (!Array.isArray(list)) {
      fail(`${file}: ожидается массив`)
      return result
    }
    list.forEach((entry: unknown, i) => {
      if (!isObject(entry) || !isNonEmptyString(entry.id)) return fail(`${file}[${i}]: нужен объект с непустым "id"`)
      const where = `${file} "${entry.id}"`
      if (result[entry.id]) fail(`${where}: повторяющийся id`)
      if (!isNonEmptyString(entry.name)) fail(`${where}: нет "name"`)
      check(entry, where)
      result[entry.id] = entry as T
    })
    return result
  }

  const packs = byId<PackDefinition>(raw.packs, 'packs', (pack, where) => {
    if (!Array.isArray(pack.contents)) return fail(`${where}: "contents" должно быть массивом`)
    for (const line of pack.contents as { itemId?: unknown; quantity?: unknown }[]) {
      if (typeof line.itemId !== 'string' || !catalog[line.itemId]) fail(`${where}: неизвестный предмет "${String(line.itemId)}"`)
      if (!isInt(line.quantity) || line.quantity < 1) fail(`${where}: количество — положительное целое`)
    }
  })

  const feats = byId<FeatDefinition>(raw.feats, 'feats', (feat, where) => {
    if (!isNonEmptyString(feat.description)) fail(`${where}: нет описания`)
  })

  const checkEquipment = (options: unknown, where: string) => {
    if (!Array.isArray(options) || options.length === 0) return fail(`${where}: "equipment" — непустой массив вариантов`)
    for (const option of options as EquipmentOption[]) {
      if (!isNonEmptyString(option.id)) fail(`${where}: у варианта снаряжения нет "id"`)
      if (!isInt(option.gold) || option.gold < 0) fail(`${where}: вариант ${option.id}: "gold" — неотрицательное целое`)
      if (!Array.isArray(option.items)) {
        fail(`${where}: вариант ${option.id}: "items" должно быть массивом`)
        continue
      }
      for (const line of option.items) {
        if (line.packId !== undefined) {
          if (!packs[line.packId]) fail(`${where}: вариант ${option.id}: неизвестный набор "${line.packId}"`)
        } else if (!catalog[line.itemId]) {
          fail(`${where}: вариант ${option.id}: неизвестный предмет "${String(line.itemId)}"`)
        } else if (line.quantity !== undefined && (!isInt(line.quantity) || line.quantity < 1)) {
          fail(`${where}: вариант ${option.id}: количество "${line.itemId}" — положительное целое`)
        }
      }
    }
  }

  const checkSkillChoice = (choice: unknown, where: string) => {
    if (!isObject(choice)) return fail(`${where}: выбор навыков должен быть объектом`)
    const c = choice as unknown as SkillChoice
    if (!isInt(c.count) || c.count < 1) fail(`${where}: "count" — положительное целое`)
    if (c.from !== 'any' && (!Array.isArray(c.from) || !c.from.every(isSkill))) fail(`${where}: "from" — "any" или массив навыков`)
    else if (Array.isArray(c.from) && c.from.length < c.count) fail(`${where}: вариантов меньше, чем нужно выбрать`)
  }

  const classes = byId<ClassDefinition>(raw.classes, 'classes', (cls, where) => {
    if (![6, 8, 10, 12].includes(cls.hitDie as number)) fail(`${where}: "hitDie" — 6, 8, 10 или 12`)
    if (!Array.isArray(cls.primary) || !cls.primary.every(isAbility)) fail(`${where}: "primary" — массив характеристик`)
    if (!Array.isArray(cls.savingThrows) || cls.savingThrows.length !== 2 || !cls.savingThrows.every(isAbility)) {
      fail(`${where}: "savingThrows" — две характеристики`)
    }
    checkSkillChoice(cls.skillChoices, where)
    if (cls.expertise !== undefined && (!isInt(cls.expertise) || cls.expertise < 1)) fail(`${where}: "expertise" — положительное целое`)
    checkEquipment(cls.equipment, where)
  })

  const backgrounds = byId<BackgroundDefinition>(raw.backgrounds, 'backgrounds', (bg, where) => {
    if (!Array.isArray(bg.abilities) || bg.abilities.length !== 3 || !bg.abilities.every(isAbility) || new Set(bg.abilities).size !== 3) {
      fail(`${where}: "abilities" — три разные характеристики`)
    }
    if (typeof bg.feat !== 'string' || !feats[bg.feat]) fail(`${where}: неизвестная черта "${String(bg.feat)}"`)
    if (!Array.isArray(bg.skills) || bg.skills.length !== 2 || !bg.skills.every(isSkill)) fail(`${where}: "skills" — два навыка`)
    checkEquipment(bg.equipment, where)
  })

  const species = byId<SpeciesDefinition>(raw.species, 'species', (sp, where) => {
    if (!isInt(sp.speed) || sp.speed <= 0) fail(`${where}: "speed" — положительное целое`)
    if (!isInt(sp.darkvision) || sp.darkvision < 0) fail(`${where}: "darkvision" — неотрицательное целое`)
    if (sp.skillChoice !== undefined) checkSkillChoice(sp.skillChoice, where)
    if (sp.choice !== undefined) {
      const choice = sp.choice as { options?: unknown }
      if (!isObject(sp.choice) || !Array.isArray(choice.options) || choice.options.length < 2) fail(`${where}: "choice" — минимум два варианта`)
    }
  })

  if (problems.length > 0) throw new ValidationError('Некорректные данные правил', problems)
  return { classes, backgrounds, species, feats, packs }
}
