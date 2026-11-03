import { describe, expect, it } from 'vitest'
import itemsJson from '../data/items.json'
import backgroundsJson from '../data/rules/backgrounds.json'
import classesJson from '../data/rules/classes.json'
import featsJson from '../data/rules/feats.json'
import packsJson from '../data/rules/packs.json'
import speciesJson from '../data/rules/species.json'
import { abilityModifier } from '../engine/abilities'
import { armorClass, inventoryWeight, parseCharacterSheet } from './character'
import {
  abilityPool,
  assignScore,
  autoEquip,
  buildCharacterSheet,
  chooseAbilityMethod,
  chooseBackground,
  chooseClass,
  chooseSpecies,
  CreationError,
  emptyDraft,
  finalScores,
  firstIncompleteStep,
  recommendedAssignment,
  skillSlots,
  startingInventory,
  stepProblems,
  toolProficiencies,
  updateCustomBackground,
  type CreationDraft,
} from './creation'
import { parseItemCatalog } from './items'
import { parseRulesData } from './rulesData'
import { CUSTOM_BACKGROUND_ID } from './backgroundTemplate'

const catalog = parseItemCatalog(itemsJson)
const data = parseRulesData(
  { classes: classesJson, backgrounds: backgroundsJson, species: speciesJson, feats: featsJson, packs: packsJson },
  catalog,
)

/** Значение генератора для грани `face` на к6. */
const d6 = (face: number) => (face - 0.5) / 6

/** Стандартный набор по порядку: СИЛ 15, ЛОВ 14, ТЕЛ 13, ИНТ 12, МДР 10, ХАР 8. */
function assignInOrder(draft: CreationDraft): CreationDraft {
  return (['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).reduce((d, a, i) => assignScore(d, a, i), draft)
}

/** Воин-человек-солдат, как Ратибор. */
function fighterDraft(): CreationDraft {
  let d: CreationDraft = { ...chooseClass(emptyDraft(), 'fighter'), fightingStyle: 'great-weapon-fighting' }
  d = chooseBackground(d, 'soldier', data)
  d = { ...d, bonusPlus2: 'str', bonusPlus1: 'con', backgroundTool: 'dice-set' }
  d = chooseSpecies(d, 'human')
  d = { ...d, originFeat: 'alert' }
  d = assignInOrder(d)
  d = { ...d, classSkills: ['perception', 'survival'], speciesSkills: ['insight'] }
  d = { ...d, classEquipment: 'A', backgroundEquipment: 'A', name: '  Ратибор  ', appearance: 'Ветеран' }
  return d
}

describe('данные правил SRD 5.2', () => {
  it('12 классов, 4 предыстории, 9 видов, 4 черты происхождения и 4 боевых стиля', () => {
    expect(Object.keys(data.classes)).toHaveLength(12)
    expect(Object.keys(data.backgrounds).sort()).toEqual(['acolyte', 'criminal', 'sage', 'soldier'])
    expect(Object.keys(data.species)).toHaveLength(9)
    const ids = (category: string) => Object.values(data.feats).filter((f) => f.category === category).map((f) => f.id).sort()
    expect(ids('origin')).toEqual(['alert', 'magic-initiate', 'savage-attacker', 'skilled'])
    expect(ids('fighting-style')).toEqual(['archery', 'defense', 'great-weapon-fighting', 'two-weapon-fighting'])
  })

  it('кость хитов и спасброски классов', () => {
    expect(data.classes.barbarian).toMatchObject({ hitDie: 12, savingThrows: ['str', 'con'] })
    expect(data.classes.wizard).toMatchObject({ hitDie: 6, savingThrows: ['int', 'wis'] })
    expect(data.classes.rogue).toMatchObject({ hitDie: 8, expertise: 2 })
  })

  it('отклоняет ссылки на несуществующие предметы, наборы и черты', () => {
    const brokenClasses = structuredClone(classesJson) as { equipment: { items: object[] }[] }[]
    brokenClasses[0].equipment[0].items.push({ itemId: 'laser-sword' }, { packId: 'magic-pack' })
    const brokenBackgrounds = structuredClone(backgroundsJson)
    brokenBackgrounds[0].feat = 'flight'
    expect(() =>
      parseRulesData({ classes: brokenClasses, backgrounds: brokenBackgrounds, species: speciesJson, feats: featsJson, packs: packsJson }, catalog),
    ).toThrow(
      /classes "barbarian": вариант A: неизвестный предмет "laser-sword"[\s\S]*неизвестный набор "magic-pack"[\s\S]*backgrounds "acolyte": неизвестная черта "flight"/,
    )
  })
})

describe('шаги создания', () => {
  it('пустой черновик начинается с выбора класса', () => {
    expect(firstIncompleteStep(emptyDraft(), data)).toBe('class')
    expect(stepProblems('class', emptyDraft(), data)).toEqual(['Выберите класс'])
  })

  it('прибавки предыстории: +2/+1 к разным характеристикам из её списка', () => {
    const d = { ...chooseBackground(emptyDraft(), 'soldier', data), backgroundTool: 'dice-set' }
    expect(stepProblems('background', d, data)).toEqual(['Распределите прибавки +2 и +1'])
    expect(stepProblems('background', { ...d, bonusPlus2: 'str', bonusPlus1: 'str' }, data)).toEqual([
      'Прибавки +2 и +1 должны быть к разным характеристикам',
    ])
    expect(stepProblems('background', { ...d, bonusPlus2: 'cha', bonusPlus1: 'str' }, data)).toEqual([
      'Прибавки можно дать только характеристикам предыстории',
    ])
    expect(stepProblems('background', { ...d, bonusMode: 'one-one-one' }, data)).toEqual([])
  })

  it('вид с выбором ветви и черта Человека', () => {
    expect(stepProblems('species', chooseSpecies(emptyDraft(), 'elf'), data)).toEqual(['Выберите: эльфийская ветвь'])
    expect(stepProblems('species', chooseSpecies(emptyDraft(), 'human'), data)).toEqual(['Выберите черту происхождения'])
    expect(stepProblems('species', chooseSpecies(emptyDraft(), 'orc'), data)).toEqual([])
  })

  it('смена класса сбрасывает навыки и снаряжение класса', () => {
    const d = chooseClass({ ...fighterDraft() }, 'wizard')
    expect(d).toMatchObject({ classId: 'wizard', classSkills: [], classEquipment: null })
    expect(d.speciesSkills).toEqual(['insight'])
  })

  it('смена предыстории убирает из выбора навыки, которые она теперь даёт сама', () => {
    const d = chooseBackground({ ...emptyDraft(), classSkills: ['stealth', 'perception'] }, 'criminal', data)
    expect(d.classSkills).toEqual(['perception'])
  })
})

describe('характеристики', () => {
  it('стандартный набор и прибавки предыстории', () => {
    const d = fighterDraft()
    expect(abilityPool(d)).toEqual([15, 14, 13, 12, 10, 8])
    expect(finalScores(d, data)).toEqual({ str: 17, dex: 14, con: 14, int: 12, wis: 10, cha: 8 })
    expect(finalScores({ ...d, bonusMode: 'one-one-one' }, data)).toEqual({ str: 16, dex: 15, con: 14, int: 12, wis: 10, cha: 8 })
  })

  it('значение из набора нельзя назначить дважды — характеристики меняются местами', () => {
    let d = assignScore(emptyDraft(), 'str', 0)
    d = assignScore(d, 'dex', 1)
    d = assignScore(d, 'dex', 0)
    expect(d.assignment).toEqual({ dex: 0, str: 1 })
    d = assignScore(d, 'con', 1)
    expect(d.assignment).toEqual({ dex: 0, con: 1 })
  })

  it('бросок 4к6: шесть значений, худший кубик отбрасывается, итог не больше 20 с прибавкой', () => {
    const rng = (() => {
      const faces = [6, 6, 6, 1, ...Array(20).fill(3)]
      return () => d6(faces.shift() ?? 3)
    })()
    let d = chooseAbilityMethod(chooseBackground(emptyDraft(), 'soldier', data), 'roll', rng)
    d = { ...d, bonusPlus2: 'str', bonusPlus1: 'dex' }
    expect(d.rolls).toHaveLength(6)
    expect(d.rolls![0].groups[0].dice.map((x) => x.kept)).toEqual([true, true, true, false])
    expect(abilityPool(d)).toEqual([18, 9, 9, 9, 9, 9])
    d = assignInOrder(d)
    expect(finalScores(d, data)!.str).toBe(20)
  })

  it('смена метода сбрасывает расстановку', () => {
    const d = chooseAbilityMethod(assignInOrder(emptyDraft()), 'standard')
    expect(d.assignment).toEqual({})
  })

  it('рекомендуемая расстановка ставит лучшие значения основным характеристикам класса', () => {
    const assignment = recommendedAssignment(data.classes.wizard, [15, 14, 13, 12, 10, 8])
    expect(assignment.int).toBe(0)
    expect(assignment.con).toBe(1)
    expect(new Set(Object.values(assignment)).size).toBe(6)
  })
})

describe('навыки', () => {
  it('у Человека-Одарённого три выбора: класс, Умелость, черта на 3 навыка', () => {
    const d = { ...chooseSpecies(chooseClass(emptyDraft(), 'fighter'), 'human'), originFeat: 'skilled' }
    expect(skillSlots(d, data).map((s) => [s.key, s.count])).toEqual([
      ['classSkills', 2],
      ['speciesSkills', 1],
      ['featSkills', 3],
    ])
  })

  it('Эльф выбирает один из трёх навыков Острых чувств', () => {
    const slot = skillSlots(chooseSpecies(emptyDraft(), 'elf'), data).find((s) => s.key === 'speciesSkills')!
    expect(slot.options).toEqual(['insight', 'perception', 'survival'])
  })

  it('нельзя выбрать навык, который уже даёт предыстория, или выбрать навык дважды', () => {
    const d = { ...fighterDraft(), classSkills: ['athletics' as const, 'perception' as const] }
    expect(stepProblems('skills', d, data)).toContain('Один навык нельзя выбрать дважды')
    const d2 = { ...fighterDraft(), speciesSkills: ['perception' as const] }
    expect(stepProblems('skills', d2, data)).toContain('Один навык нельзя выбрать дважды')
  })

  it('навык не из списка класса отклоняется', () => {
    const d = { ...fighterDraft(), classSkills: ['arcana' as const, 'perception' as const] }
    expect(stepProblems('skills', d, data)).toContain('Класс: Воин: навык недоступен')
  })

  it('Плут выбирает компетентность в двух навыках, которыми владеет', () => {
    let d = chooseBackground(chooseClass(emptyDraft(), 'rogue'), 'criminal', data)
    d = { ...d, classSkills: ['acrobatics', 'perception', 'deception', 'investigation'] }
    expect(stepProblems('skills', d, data)).toEqual(['Компетентность: выберите 2 (выбрано 0)'])
    expect(stepProblems('skills', { ...d, expertise: ['stealth', 'athletics'] }, data)).toEqual([
      'Компетентность — только для навыков, которыми вы владеете',
    ])
    expect(stepProblems('skills', { ...d, expertise: ['stealth', 'perception'] }, data)).toEqual([])
  })
})

describe('снаряжение', () => {
  it('воин A + солдат A: наборы раскрываются, одинаковые предметы складываются', () => {
    const inventory = startingInventory(fighterDraft(), data, catalog)
    expect(inventory.gold).toBe(18)
    const qty = Object.fromEntries(inventory.items.map((i) => [i.itemId, i.quantity]))
    expect(qty).toMatchObject({ 'chain-mail': 1, greatsword: 1, javelin: 8, rations: 10, torch: 10, arrow: 20, 'travelers-clothes': 1 })
    expect(inventory.equipped).toEqual({ mainHand: 'greatsword', offHand: null, armor: 'chain-mail' })
  })

  it('только золото: варианты B', () => {
    const inventory = startingInventory({ ...fighterDraft(), classEquipment: 'C', backgroundEquipment: 'B' }, data, catalog)
    expect(inventory).toEqual({ gold: 205, items: [], equipped: { mainHand: null, offHand: null, armor: null } })
  })

  it('со щитом надевается одноручное оружие', () => {
    expect(autoEquip([{ itemId: 'shield', quantity: 1 }, { itemId: 'greatsword', quantity: 1 }, { itemId: 'mace', quantity: 1 }], catalog)).toEqual({
      mainHand: 'mace',
      offHand: 'shield',
      armor: null,
    })
    expect(autoEquip([{ itemId: 'shield', quantity: 1 }, { itemId: 'greatsword', quantity: 1 }], catalog).offHand).toBeNull()
  })

  it('у каждого класса и предыстории все варианты снаряжения собираются', () => {
    for (const cls of Object.values(data.classes)) {
      for (const option of cls.equipment) {
        const inventory = startingInventory({ ...fighterDraft(), classId: cls.id, classEquipment: option.id }, data, catalog)
        expect(inventory.gold).toBeGreaterThanOrEqual(option.gold)
        for (const entry of inventory.items) expect(catalog[entry.itemId], entry.itemId).toBeDefined()
      }
    }
  })
})

describe('готовый лист персонажа', () => {
  it('собирает воина, совпадающего с Ратибором по правилам', () => {
    const sheet = buildCharacterSheet(fighterDraft(), data, catalog, 'new-hero')
    const { character, inventory } = sheet
    expect(character).toMatchObject({
      id: 'new-hero',
      name: 'Ратибор',
      species: 'Человек',
      className: 'Воин',
      background: 'Солдат',
      level: 1,
      maxHp: 12,
      hp: 12,
      feats: ['savage-attacker', 'alert', 'great-weapon-fighting'],
      appearance: 'Ветеран',
      conditions: [],
    })
    expect(character.proficiencies).toEqual({
      savingThrows: ['str', 'con'],
      skills: { athletics: 'proficient', intimidation: 'proficient', perception: 'proficient', survival: 'proficient', insight: 'proficient' },
      tools: ['dice-set'],
    })
    expect(armorClass(character, inventory, catalog)).toBe(16)
    expect(inventoryWeight(inventory, catalog)).toBe(148)
    // Лист проходит ту же проверку, что и загружаемые персонажи.
    expect(parseCharacterSheet(sheet, catalog)).toEqual(sheet)
  })

  it('хиты: кость хитов + ТЕЛ, у Дварфа +1', () => {
    const base = { ...fighterDraft(), speciesId: 'dwarf', originFeat: null, speciesSkills: [] }
    expect(buildCharacterSheet(base, data, catalog, 'x').character.maxHp).toBe(10 + abilityModifier(14) + 1)
    const wizard = { ...base, classId: 'wizard', classSkills: ['arcana' as const, 'history' as const], classEquipment: 'A' }
    expect(buildCharacterSheet(wizard, data, catalog, 'x').character.maxHp).toBe(6 + 2 + 1)
  })

  it('Плут: компетентность записывается в навыки', () => {
    let d = chooseBackground(chooseClass(emptyDraft(), 'rogue'), 'criminal', data)
    d = { ...d, bonusPlus2: 'dex', bonusPlus1: 'con' }
    d = { ...chooseSpecies(d, 'elf'), speciesOption: 'wood-elf', speciesSkills: ['perception'] }
    d = assignInOrder({ ...d, classSkills: ['acrobatics', 'deception', 'investigation', 'insight'], expertise: ['stealth', 'perception'] })
    d = { ...d, classEquipment: 'A', backgroundEquipment: 'B', name: 'Тень' }
    const { character, inventory } = buildCharacterSheet(d, data, catalog, 'r')
    expect(character.proficiencies.skills).toMatchObject({ stealth: 'expertise', perception: 'expertise', acrobatics: 'proficient' })
    expect(character.speciesOption).toBe('wood-elf')
    expect(character.feats).toEqual(['alert'])
    expect(inventory.equipped).toEqual({ mainHand: 'dagger', offHand: null, armor: 'leather-armor' })
    expect(character.proficiencies.tools).toEqual(['thieves-tools'])
    // Кожаный доспех 11 + ЛОВ (14+2=16 → +3).
    expect(armorClass(character, inventory, catalog)).toBe(14)
  })

  it('Варвар без доспеха: Защита без доспехов 10 + ЛОВ + ТЕЛ', () => {
    let d = chooseBackground(chooseClass(emptyDraft(), 'barbarian'), 'soldier', data)
    d = { ...chooseSpecies(d, 'orc'), bonusPlus2: 'str', bonusPlus1: 'con', backgroundTool: 'playing-cards' }
    d = assignInOrder({ ...d, classSkills: ['survival', 'perception'], classEquipment: 'A', backgroundEquipment: 'B', name: 'Грок' })
    const { character, inventory } = buildCharacterSheet(d, data, catalog, 'b')
    expect(inventory.equipped.armor).toBeNull()
    expect(armorClass(character, inventory, catalog)).toBe(10 + 2 + 2)
  })

  it('незаконченный персонаж — ошибка со списком того, что не выбрано', () => {
    expect(() => buildCharacterSheet(chooseClass(emptyDraft(), 'fighter'), data, catalog, 'x')).toThrow(CreationError)
    try {
      buildCharacterSheet({ ...fighterDraft(), name: ' ' }, data, catalog, 'x')
    } catch (error) {
      expect((error as CreationError).problems).toEqual(['Введите имя персонажа'])
    }
  })
})

describe('боевой стиль и инструменты', () => {
  it('воину нужен боевой стиль; черта происхождения не подходит', () => {
    const d = chooseClass(emptyDraft(), 'fighter')
    expect(stepProblems('class', d, data)).toEqual(['Выберите боевой стиль'])
    expect(stepProblems('class', { ...d, fightingStyle: 'alert' }, data)).toEqual(['Выберите боевой стиль'])
    expect(stepProblems('class', { ...d, fightingStyle: 'defense' }, data)).toEqual([])
  })

  it('Оборона в итоговом листе: +1 к КД в кольчуге', () => {
    const { character, inventory } = buildCharacterSheet({ ...fighterDraft(), fightingStyle: 'defense' }, data, catalog, 'x')
    expect(character.feats).toContain('defense')
    expect(armorClass(character, inventory, catalog)).toBe(17)
  })

  it('смена класса сбрасывает боевой стиль и инструменты', () => {
    expect(chooseClass({ ...fighterDraft(), classTools: ['lute'] }, 'bard')).toMatchObject({ fightingStyle: null, classTools: [] })
  })

  it('Солдат выбирает игровой набор: он во владении и в снаряжении', () => {
    const d = { ...fighterDraft(), backgroundTool: 'playing-cards' }
    expect(stepProblems('background', { ...d, backgroundTool: 'lute' }, data)).toEqual(['Выберите инструмент предыстории'])
    const { character, inventory } = buildCharacterSheet(d, data, catalog, 'x')
    expect(character.proficiencies.tools).toEqual(['playing-cards'])
    expect(inventory.items.map((i) => i.itemId)).toContain('playing-cards')
    expect(inventory.items.map((i) => i.itemId)).not.toContain('dice-set')
  })

  it('Бард выбирает 3 музыкальных инструмента, первый — в снаряжении', () => {
    let d = chooseClass(emptyDraft(), 'bard')
    expect(stepProblems('class', d, data)).toEqual(['Выберите инструменты: 3 (выбрано 0)'])
    expect(stepProblems('class', { ...d, classTools: ['lyre', 'flute', 'smiths-tools'] }, data)).toEqual(['Этот инструмент нельзя выбрать для класса'])
    d = { ...d, classTools: ['lyre', 'flute', 'drum'], classEquipment: 'A' }
    expect(stepProblems('class', d, data)).toEqual([])
    expect(startingInventory(d, data, catalog).items.map((i) => i.itemId)).toContain('lyre')
    expect(toolProficiencies(d, data)).toEqual(['lyre', 'flute', 'drum'])
  })

  it('Монах выбирает 1 инструмент ремесленника или музыкальный', () => {
    const d = { ...chooseClass(emptyDraft(), 'monk'), classTools: ['smiths-tools'], classEquipment: 'A' }
    expect(stepProblems('class', d, data)).toEqual([])
    expect(startingInventory(d, data, catalog).items.map((i) => i.itemId)).toContain('smiths-tools')
  })

  it('Плут и преступник: воровские инструменты один раз', () => {
    const d = { ...chooseBackground(chooseClass(emptyDraft(), 'rogue'), 'criminal', data) }
    expect(toolProficiencies(d, data)).toEqual(['thieves-tools'])
  })
})

describe('своя предыстория', () => {
  function customDraft(): CreationDraft {
    let d: CreationDraft = { ...chooseClass(emptyDraft(), 'fighter'), fightingStyle: 'archery' }
    d = chooseBackground(d, CUSTOM_BACKGROUND_ID, data)
    d = updateCustomBackground(
      d,
      {
        name: 'Корабельный юнга',
        abilities: ['str', 'dex', 'wis'],
        skills: ['athletics', 'perception'],
        tool: 'navigators-tools',
        feat: 'skilled',
        items: [
          { itemId: 'rope', quantity: 2 },
          { itemId: 'dagger', quantity: 1 },
        ],
      },
      data,
    )
    return { ...d, bonusPlus2: 'dex', bonusPlus1: 'str' }
  }

  it('шаг предыстории проверяет шаблон и прибавки', () => {
    const d = chooseBackground(emptyDraft(), CUSTOM_BACKGROUND_ID, data)
    expect(stepProblems('background', d, data)).toEqual([
      'Введите название предыстории',
      'Выберите 3 разные характеристики для прибавок (выбрано 0)',
      'Выберите 2 разных навыка (выбрано 0)',
      'Выберите один инструмент',
      'Выберите черту происхождения',
    ])
    expect(stepProblems('background', customDraft(), data)).toEqual([])
  })

  it('убранная характеристика снимает прибавку, навыки предыстории убираются из выбора класса', () => {
    let d: CreationDraft = { ...customDraft(), classSkills: ['athletics'] }
    d = updateCustomBackground(d, { abilities: ['str', 'con', 'wis'], skills: ['athletics', 'survival'] }, data)
    expect(d.bonusPlus2).toBeNull()
    expect(d.bonusPlus1).toBe('str')
    expect(d.classSkills).toEqual([])
  })

  it('собирает персонажа: навыки, инструмент, черта «Одарённый» с тремя навыками, сдача золотом', () => {
    let d = customDraft()
    d = chooseSpecies(d, 'orc')
    d = assignInOrder({ ...d, classSkills: ['history', 'insight'], featSkills: ['arcana', 'medicine', 'nature'] })
    d = { ...d, classEquipment: 'C', backgroundEquipment: 'A', name: 'Сёма' }
    expect(stepProblems('summary', d, data)).toEqual([])
    const { character, inventory } = buildCharacterSheet(d, data, catalog, 'x')
    expect(character).toMatchObject({ background: 'Корабельный юнга', backgroundId: 'custom', feats: ['skilled', 'archery'] })
    expect(character.proficiencies.tools).toEqual(['navigators-tools'])
    expect(Object.keys(character.proficiencies.skills).sort()).toEqual(
      ['arcana', 'athletics', 'history', 'insight', 'medicine', 'nature', 'perception'].sort(),
    )
    expect(finalScores(d, data)).toMatchObject({ str: 16, dex: 16 })
    expect(inventory.gold).toBe(155 + 46)
    expect(inventory.equipped.mainHand).toBe('dagger')
  })

  it('дорогое снаряжение не пропускает шаг', () => {
    const d = updateCustomBackground(customDraft(), { items: [{ itemId: 'spellbook', quantity: 2 }] }, data)
    expect(stepProblems('background', d, data)).toEqual(['Снаряжение стоит 100 зм — больше 50 зм'])
  })
})
