// Загрузка и проверка данных для создания персонажа. Проверяются ссылки на навыки,
// характеристики, черты, наборы и предметы справочника — чтобы ошибка в JSON
// (в том числе сгенерированном ИИ) не дошла до игры.
import { ABILITIES } from '../engine/abilities'
import { SKILLS } from '../engine/skills'
import { ARMOR_TYPES, TOOL_KINDS, type ItemCatalog } from '../types/items'
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
import { validateBackgroundTemplate } from './backgroundTemplate'
import { parseSpellCatalog, parseSpellSlotTables } from './spells'
import { INITIATE_LISTS, type ClassSpellcasting, type InnateSpellGrant } from '../types/spells'
import { isInt, isNonEmptyString, isObject, ValidationError } from './validation'

export interface RawRulesData {
  classes: unknown
  backgrounds: unknown
  species: unknown
  feats: unknown
  packs: unknown
  /** Справочник заклинаний (src/data/spells.json) и таблицы ячеек (rules/spell-slots.json). */
  spells: unknown
  spellSlots: unknown
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

  const spells = parseSpellCatalog(raw.spells)
  const spellSlots = parseSpellSlotTables(raw.spellSlots)
  const checkInnate = (list: unknown, where: string) => {
    if (list === undefined) return
    if (!Array.isArray(list)) return fail(`${where}: "innateSpells" — массив`)
    for (const g of list as InnateSpellGrant[]) {
      if (!isObject(g) || !spells[g.spellId]) fail(`${where}: неизвестное заклинание "${String(g?.spellId)}"`)
      else if (g.uses !== undefined && g.uses !== 'proficiency') fail(`${where}: "uses" — proficiency`)
      else if (spells[g.spellId].level > 0 && g.uses === undefined) fail(`${where}: у заклинания "${g.spellId}" 1-го круга и выше нужно число бесплатных сотворений ("uses")`)
    }
  }
  const twenty = (a: unknown) => Array.isArray(a) && a.length === 20 && a.every((n) => isInt(n) && n >= 0)

  const packs = byId<PackDefinition>(raw.packs, 'packs', (pack, where) => {
    if (!Array.isArray(pack.contents)) return fail(`${where}: "contents" должно быть массивом`)
    for (const line of pack.contents as { itemId?: unknown; quantity?: unknown }[]) {
      if (typeof line.itemId !== 'string' || !catalog[line.itemId]) fail(`${where}: неизвестный предмет "${String(line.itemId)}"`)
      if (!isInt(line.quantity) || line.quantity < 1) fail(`${where}: количество — положительное целое`)
    }
  })

  const feats = byId<FeatDefinition>(raw.feats, 'feats', (feat, where) => {
    if (!isNonEmptyString(feat.description)) fail(`${where}: нет описания`)
    if (feat.category !== 'origin' && feat.category !== 'fighting-style') fail(`${where}: "category" — origin или fighting-style`)
  })

  const isToolItem = (id: unknown) => typeof id === 'string' && catalog[id]?.toolKind !== undefined
  const isToolKind = (kind: unknown) => (TOOL_KINDS as readonly unknown[]).includes(kind)

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
        if (line.chosenTool !== undefined) {
          if (line.chosenTool !== 'class' && line.chosenTool !== 'background') fail(`${where}: вариант ${option.id}: "chosenTool" — class или background`)
        } else if (line.packId !== undefined) {
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
    if (!Array.isArray(cls.armorTraining) || !cls.armorTraining.every((t) => (ARMOR_TYPES as readonly unknown[]).includes(t))) {
      fail(`${where}: "armorTraining" — массив из ${ARMOR_TYPES.join(', ')}`)
    }
    if (!['all', 'none', 'light', 'finesse-or-light'].includes(cls.martialWeapons as string)) {
      fail(`${where}: "martialWeapons" — all, none, light или finesse-or-light`)
    }
    const tools = cls.tools as ClassDefinition['tools']
    if (tools !== undefined) {
      for (const id of tools.fixed ?? []) if (!isToolItem(id)) fail(`${where}: "${id}" — не инструмент`)
      if (tools.choose && (!isInt(tools.choose.count) || tools.choose.count < 1 || !tools.choose.kinds.every(isToolKind))) {
        fail(`${where}: "tools.choose" — { count, kinds }`)
      }
    }
    const usesChosenTool = (cls.equipment as EquipmentOption[] | undefined)?.some((o) => o.items?.some((l) => l.chosenTool === 'class'))
    if (usesChosenTool && !tools?.choose) fail(`${where}: снаряжение ссылается на выбранный инструмент, но выбора инструмента нет`)
    checkEquipment(cls.equipment, where)
    const sc = cls.spellcasting as ClassSpellcasting | undefined
    if (sc !== undefined) {
      if (!isObject(sc) || !isAbility(sc.ability)) fail(`${where}: spellcasting.ability — характеристика`)
      else {
        if (!['full', 'half', 'pact'].includes(sc.progression)) fail(`${where}: spellcasting.progression — full, half или pact`)
        if (!twenty(sc.cantrips) || !twenty(sc.prepared)) fail(`${where}: spellcasting.cantrips и prepared — по 20 целых (уровни 1–20)`)
        if (!['long-rest-any', 'long-rest-one', 'level-one'].includes(sc.swap)) fail(`${where}: spellcasting.swap — long-rest-any, long-rest-one или level-one`)
        if (sc.spellbook !== undefined && (!isInt(sc.spellbook.start) || !isInt(sc.spellbook.perLevel))) fail(`${where}: spellcasting.spellbook — { start, perLevel }`)
        const list = Object.values(spells).filter((sp) => sp.classes.includes(cls.id as string))
        if (twenty(sc.cantrips) && list.filter((sp) => sp.level === 0).length < sc.cantrips[0]) fail(`${where}: в списке класса меньше заговоров, чем нужно на 1-м уровне`)
        const need = Math.max(sc.prepared[0] ?? 0, sc.spellbook?.start ?? 0)
        if (list.filter((sp) => sp.level === 1).length < need) fail(`${where}: в списке класса меньше заклинаний 1-го круга, чем нужно на 1-м уровне`)
      }
    }
  })

  const backgrounds = byId<BackgroundDefinition>(raw.backgrounds, 'backgrounds', (bg, where) => {
    if (!Array.isArray(bg.abilities) || bg.abilities.length !== 3 || !bg.abilities.every(isAbility) || new Set(bg.abilities).size !== 3) {
      fail(`${where}: "abilities" — три разные характеристики`)
    }
    if (typeof bg.feat !== 'string' || !feats[bg.feat]) fail(`${where}: неизвестная черта "${String(bg.feat)}"`)
    else if (feats[bg.feat].category !== 'origin') fail(`${where}: черта "${bg.feat}" — не черта происхождения`)
    const tool = bg.tool as { itemId?: unknown; choose?: unknown } | undefined
    if (!isObject(tool) || (tool.itemId !== undefined ? !isToolItem(tool.itemId) : !isToolKind(tool.choose))) {
      fail(`${where}: "tool" — { "itemId": инструмент } или { "choose": вид инструмента }`)
    }
    if (!Array.isArray(bg.skills) || bg.skills.length !== 2 || !bg.skills.every(isSkill)) fail(`${where}: "skills" — два навыка`)
    checkEquipment(bg.equipment, where)
    if (bg.featSpellList !== undefined && !(INITIATE_LISTS as readonly unknown[]).includes(bg.featSpellList)) fail(`${where}: "featSpellList" — ${INITIATE_LISTS.join(', ')}`)
  })

  const species = byId<SpeciesDefinition>(raw.species, 'species', (sp, where) => {
    if (!isInt(sp.speed) || sp.speed <= 0) fail(`${where}: "speed" — положительное целое`)
    if (!isInt(sp.darkvision) || sp.darkvision < 0) fail(`${where}: "darkvision" — неотрицательное целое`)
    if (sp.skillChoice !== undefined) checkSkillChoice(sp.skillChoice, where)
    if (sp.choice !== undefined) {
      const choice = sp.choice as { options?: unknown }
      if (!isObject(sp.choice) || !Array.isArray(choice.options) || choice.options.length < 2) fail(`${where}: "choice" — минимум два варианта`)
      else for (const o of choice.options as { id?: string; innateSpells?: unknown }[]) checkInnate(o.innateSpells, `${where} / ${o.id}`)
    }
    checkInnate(sp.innateSpells, where)
  })

  // Официальные предыстории обязаны укладываться в тот же шаблон 2024, что и свои.
  for (const bg of Object.values(backgrounds)) {
    for (const problem of validateBackgroundTemplate(bg, { feats, catalog })) fail(`backgrounds "${bg.id}": ${problem}`)
  }

  if (problems.length > 0) throw new ValidationError('Некорректные данные правил', problems)
  return { classes, backgrounds, species, feats, packs, catalog, spells, spellSlots }
}
