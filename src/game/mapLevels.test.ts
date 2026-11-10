// Три масштаба карт (6.2): формат (scale, parent, places), связи уровней (placeLinked), путь над картой, где отряд на
// уровнях выше, смена масштаба ведущим (set_map_view → mapLevelChanged), бой только на клеточной карте, состояние
// игры для ведущего, перенос старых историй (локации без scale) и окрестности здания на том же уровне.
import { describe, expect, it } from 'vitest'
import type { AiToolCall } from '../ai/types'
import { itemCatalog, priceList, rulesData } from '../data'
import adventureJson from '../data/adventures/drunken-griffin.json'
import fighterJson from '../data/characters/fighter-ratibor.json'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import type { LocationData } from '../types/location'
import type { StoryAction, StoryState } from '../types/story'
import { parseAdventure } from './adventure'
import { parseCharacterSheet } from './character'
import { LocationValidationError, parseLocation } from './location'
import { parseCreatedLocation, schemaProblems } from './locationCreate'
import { ancestorsOf, levelText, mapPath, partyPlaceOn, placeDetailNote, zoomInTarget, zoomOutNote } from './mapLevels'
import { gameStateText } from './masterState'
import { executeTool, type ToolContext } from './masterTools'
import { applyAction, checkAction, ENGINE, makeAction, MASTER, migrateStory, newStorySeed, replay } from './storyActions'
import { travelPlan } from './travel'

const tavern = parseLocation(drunkenGriffinJson)
const locations = { [tavern.id]: tavern }
const adventure = parseAdventure(adventureJson, locations)
const ratibor = parseCharacterSheet(fighterJson, itemCatalog)
const HERO = ratibor.character.id
const ctx: ToolContext = { catalog: itemCatalog, rules: rulesData, prices: priceList, now: () => 1000, newId: () => 'id1' }
const created = makeAction('s1', 0, { type: 'storyCreated', seed: newStorySeed({ id: 's1', title: 'Т', tone: 'detective', adventure, locations, party: [ratibor], now: 1 }) }, ENGINE, 1, 'c')
const call = (name: string, args: unknown): AiToolCall => ({ id: `c-${name}`, name, arguments: args, rawArguments: JSON.stringify(args) })

/** Частичная карта деревни: таверна — место на ней (уже есть в мире), мельница — место без карты. */
const village = {
  id: 'oak-village',
  name: 'Деревня Дубки',
  description: 'Десяток домов у тракта.',
  scale: { kind: 'area', cell: 50, unit: 'ft' },
  width: 24,
  height: 16,
  floor: 'grass',
  wallMaterial: 'wood',
  rooms: [{ id: 'all', x: 0, y: 0, w: 24, h: 16 }],
  objects: [{ id: 'oak', type: 'tree', name: 'Старый дуб', x: 4, y: 4 }],
  npcs: [],
  places: [
    { id: 'griffin', name: 'Таверна «Пьяный грифон»', kind: 'building', x: 10, y: 8, map: 'drunken-griffin' },
    { id: 'mill', name: 'Мельница', kind: 'building', x: 20, y: 3 },
  ],
  playerStart: { x: 10, y: 9 },
}
/** Общая карта: деревня — место на ней. */
const kingdom = {
  id: 'kingdom',
  name: 'Королевство',
  description: 'Холмы, леса и тракт.',
  scale: { kind: 'region', cell: 1, unit: 'mi' },
  width: 30,
  height: 20,
  floor: 'grass',
  wallMaterial: 'stone',
  rooms: [{ id: 'all', x: 0, y: 0, w: 30, h: 20 }],
  objects: [],
  npcs: [],
  places: [
    { id: 'oaks', name: 'Деревня Дубки', kind: 'village', x: 12, y: 9, map: 'oak-village' },
    { id: 'ruins', name: 'Старые руины', kind: 'ruins', x: 25, y: 4 },
  ],
  playerStart: { x: 12, y: 10 },
}

let seq = 1
/** Выполнить инструмент и записать его действия (как ход ведущего); отказ — ошибка теста. */
function tool(state: StoryState, name: string, args: unknown, log?: StoryAction[]) {
  const out = executeTool(state, call(name, args), ctx)
  if (!out.ok) throw new Error(String((out.result as { error?: string }).error))
  let next = state
  for (const { event, author } of out.events) {
    const action = makeAction('s1', seq++, event, author, 10 + seq, `a${seq}`)
    expect(checkAction(next, action, { catalog: itemCatalog })).toBeNull()
    log?.push(action)
    next = applyAction(next, action)
  }
  return { out, state: next }
}
const rejected = (state: StoryState, name: string, args: unknown) => {
  const out = executeTool(state, call(name, args), ctx)
  expect(out.ok).toBe(false)
  return String((out.result as { error?: string }).error)
}

/** Мир с тремя уровнями: королевство → деревня → таверна (отряд в таверне). */
function world(log?: StoryAction[]) {
  let s = applyAction(null, created)
  s = tool(s, 'create_location', { location: village }, log).state
  s = tool(s, 'create_location', { location: kingdom }, log).state
  return s
}

describe('формат: масштаб, карта уровнем выше, места', () => {
  it('места — только на общей и частичной карте, в пределах карты; родитель — не сама карта', () => {
    expect(parseLocation(kingdom).places?.map((p) => p.id)).toEqual(['oaks', 'ruins'])
    expect(parseLocation(kingdom).scale).toEqual({ kind: 'region', cell: 1, unit: 'mi' })
    const problems = (input: unknown) => {
      try {
        parseLocation(input)
        return []
      } catch (e) {
        return (e as LocationValidationError).problems
      }
    }
    expect(problems({ ...drunkenGriffinJson, places: [{ id: 'p', name: 'Место', x: 1, y: 1 }] }).join()).toContain('места бывают только на общей и частичной карте')
    expect(problems({ ...kingdom, places: [{ id: 'p', name: 'За краем', x: 40, y: 1 }] }).join()).toContain('places[0] "p"')
    expect(problems({ ...kingdom, parent: 'kingdom' }).join()).toContain('родителем самой себе')
    expect(problems({ ...kingdom, places: [{ id: 'p', name: 'Место', kind: 'castle', x: 1, y: 1 }] }).join()).toContain('"kind" должно быть одним из')
  })

  it('схема: у карты с parent или places выходы не обязательны, у остальных — обязательны', () => {
    expect(schemaProblems(kingdom)).toEqual([])
    expect(schemaProblems({ ...village, places: undefined, parent: 'kingdom' })).toEqual([])
    expect(schemaProblems({ ...village, places: undefined })).toEqual(['exits: нет обязательного поля'])
    expect(parseCreatedLocation({ ...village, places: undefined, exits: [] })).toMatchObject({ ok: false })
    expect(parseCreatedLocation(kingdom)).toMatchObject({ ok: true })
    expect(schemaProblems({ ...kingdom, places: [{ id: 'p', name: 'М', kind: 'castle', x: 1, y: 1 }] })[0]).toContain('places[0].kind')
  })
})

describe('иерархия карт мира', () => {
  it('места с map связывают карты: у таверны — родитель деревня, у деревни — королевство', () => {
    const s = world()
    expect(s.world.locations['drunken-griffin'].parent).toBe('oak-village')
    expect(s.world.locations['oak-village'].parent).toBe('kingdom')
    expect(ancestorsOf(s.world.locations, 'drunken-griffin').map((l) => l.id)).toEqual(['kingdom', 'oak-village'])
    expect(partyPlaceOn(s.world.locations, 'kingdom', 'drunken-griffin')?.id).toBe('oaks')
    expect(partyPlaceOn(s.world.locations, 'oak-village', 'drunken-griffin')?.id).toBe('griffin')
    expect(zoomInTarget(s.world.locations, 'kingdom', 'drunken-griffin')).toBe('oak-village')
    expect(zoomInTarget(s.world.locations, 'drunken-griffin', 'drunken-griffin')).toBeNull()
  })

  it('путь над картой: уровни выше, затем путь отряда на этом уровне; на карте выше — только уровни', () => {
    let s = world()
    expect(mapPath(s, 'drunken-griffin').map((i) => `${i.kind}:${i.name}${i.current ? '*' : ''}`)).toEqual([
      'level:Королевство',
      'level:Деревня Дубки',
      'trail:Таверна «Пьяный грифон»*',
    ])
    // Вышли на улицу: окрестности на том же уровне (у той же деревни) — путь «Таверна › Снаружи».
    s = tool(s, 'travel', { exit: 'tavern-door' }).state
    expect(s.world.locations[s.world.currentLocationId].parent).toBe('oak-village')
    expect(mapPath(s, s.world.currentLocationId).map((i) => i.name)).toEqual(['Королевство', 'Деревня Дубки', 'Таверна «Пьяный грифон»', 'Снаружи: Таверна «Пьяный грифон»'])
    // У улицы своего места нет — отряд на деревне у места соседней таверны.
    expect(partyPlaceOn(s.world.locations, 'oak-village', s.world.currentLocationId)?.id).toBe('griffin')
    expect(mapPath(s, 'oak-village').map((i) => `${i.name}${i.current ? '*' : ''}`)).toEqual(['Королевство', 'Деревня Дубки*'])
  })

  it('карта уровнем выше должна быть крупнее, место — открывать карту ниже; чужое место не перехватить', () => {
    const s = world()
    const fine = { ...village, id: 'fine', places: undefined, parent: 'drunken-griffin' }
    expect(rejected(s, 'create_location', { location: fine })).toContain('карта уровнем выше должна быть крупнее')
    const up = { ...kingdom, id: 'world', places: [{ id: 'k', name: 'Королевство', x: 1, y: 1, map: 'kingdom' }] }
    expect(rejected(s, 'create_location', { location: up })).toContain('место открывает карту уровнем ниже')
    const steal = { ...kingdom, id: 'other', places: [{ id: 'v', name: 'Дубки', x: 1, y: 1, map: 'oak-village' }] }
    expect(rejected(s, 'create_location', { location: steal })).toContain('уже есть карта уровнем выше [kingdom]')
    expect(rejected(s, 'create_location', { location: { ...fine, parent: 'nowhere' } })).toContain('карты [nowhere] нет')
  })

  it('create_location с place: новая клеточная карта открывается местом «Мельница» на деревне', () => {
    let s = world()
    const mill = { ...tavernLike('mill-inside', 'Мельница внутри'), parent: 'oak-village' }
    s = tool(s, 'create_location', { location: mill, place: 'mill' }).state
    expect(s.world.locations['oak-village'].places?.find((p) => p.id === 'mill')?.map).toBe('mill-inside')
    expect(s.world.locations['mill-inside'].parent).toBe('oak-village')
    expect(rejected(s, 'create_location', { location: { ...mill, id: 'mill-2' }, place: 'mill' })).toContain('уже открывает карту [mill-inside]')
    expect(rejected(s, 'create_location', { location: { ...mill, id: 'mill-3' }, place: 'nope' })).toContain('нет места [nope]')
  })

  it('связи уровней и смену масштаба записывает только движок', () => {
    const s = world()
    const linked = makeAction('s1', 99, { type: 'placeLinked', locationId: 'kingdom', placeId: 'ruins', map: 'drunken-griffin' }, MASTER, 1, 'x')
    expect(checkAction(s, linked, { catalog: itemCatalog })).toBe('Места с картами связывает движок.')
    const level = makeAction('s1', 99, { type: 'mapLevelChanged', from: 'drunken-griffin', to: 'kingdom', reason: 'путь', positions: { [HERO]: { x: 1, y: 1 } } }, MASTER, 1, 'x')
    expect(checkAction(s, level, { catalog: itemCatalog })).toContain('меняет движок')
  })
})

/** Небольшая клеточная карта без выходов (через уровень выше — parent). */
function tavernLike(id: string, name: string) {
  return {
    id,
    name,
    description: 'Комната.',
    cellFeet: 5,
    width: 8,
    height: 6,
    floor: 'wood',
    wallMaterial: 'stone',
    rooms: [{ id: 'room', x: 0, y: 0, w: 8, h: 6 }],
    objects: [],
    npcs: [],
    playerStart: { x: 3, y: 3 },
  }
}

describe('смена масштаба для отряда (set_map_view)', () => {
  it('вверх — отряд у места, откуда пришёл; вниз — у входа; путь и состояние ведущему', () => {
    let s = world()
    const up = tool(s, 'set_map_view', { map: 'kingdom', reason: 'отряд вышел из деревни на тракт' })
    s = up.state
    expect(s.world.currentLocationId).toBe('kingdom')
    expect(s.party[0].position).toEqual({ x: 12, y: 9 })
    expect(String((up.out.result as { message: string }).message)).toContain('общая карта (1 клетка = 1 миля)')
    expect(levelText(s)).toContain('Места на этой карте: «Деревня Дубки» [oaks] (деревня) (12, 9) → карта [oak-village]; «Старые руины» [ruins] (руины) (25, 4) → карты нет.')
    // Вниз сразу на клеточную карту таверны (через уровень) — у её входа.
    s = tool(s, 'set_map_view', { map: 'drunken-griffin', reason: 'вернулись в таверну' }).state
    expect(s.world.currentLocationId).toBe('drunken-griffin')
    expect(s.party[0].position).toEqual(tavern.playerStart)
    expect(levelText(s)).toContain('Выше: «Деревня Дубки» [oak-village] (частичная карта) — отряд у места «Таверна «Пьяный грифон»» (10, 8); «Королевство» [kingdom] (общая карта) — отряд у места «Деревня Дубки» (12, 9).')
    expect(gameStateText(s, { catalog: itemCatalog, rules: rulesData })).toContain('## Масштаб карты\nОтряд на карте «Таверна «Пьяный грифон»» [drunken-griffin] — клеточная карта (1 клетка = 5 фт.).')
  })

  it('отказы: нет карты, та же карта, карта того же масштаба, карта вне вложенности, бой', () => {
    let s = world()
    expect(rejected(s, 'set_map_view', { map: 'nowhere', reason: 'x' })).toContain('Создай её create_location со scale')
    expect(rejected(s, 'set_map_view', { map: 'drunken-griffin', reason: 'x' })).toContain('Отряд и так на карте')
    s = tool(s, 'create_location', { location: { ...tavernLike('cellar', 'Подвал'), parent: 'oak-village' } }).state
    expect(rejected(s, 'set_map_view', { map: 'cellar', reason: 'x' })).toContain('того же масштаба: туда ведёт выход (travel)')
    expect(rejected(s, 'set_map_view', { map: 'kingdom', reason: '' })).toContain('reason')
    s = tool(s, 'set_combat', { state: 'start' }).state
    expect(rejected(s, 'set_map_view', { map: 'kingdom', reason: 'бегство' })).toContain('Идёт бой')
  })

  it('бой начинается только на клеточной карте: на общей — с map (отряд переходит на карту места)', () => {
    let s = world()
    s = tool(s, 'set_map_view', { map: 'kingdom', reason: 'в путь' }).state
    expect(rejected(s, 'set_combat', { state: 'start' })).toContain('Бой — только на клеточной карте')
    expect(rejected(s, 'set_combat', { state: 'start', map: 'oak-village' })).toContain('не клеточная карта')
    const combat = makeAction('s1', 99, { type: 'combatChanged', combat: { round: 1, speed: {}, moved: {} } }, MASTER, 1, 'x')
    expect(checkAction(s, combat, { catalog: itemCatalog })).toContain('Бой идёт только на клеточной карте')
    s = tool(s, 'set_combat', { state: 'start', map: 'drunken-griffin' }).state
    expect(s.world.currentLocationId).toBe('drunken-griffin')
    expect(s.combat?.round).toBe(1)
    expect(levelText(s)).toContain('Идёт бой: карта закреплена на клеточной.')
  })
})

describe('заметки ведущему от игрока', () => {
  it('«подробнее» о месте без карты и «отдалить» без карты выше — просьба создать, отряд не переходит', () => {
    const s = world()
    const k = s.world.locations.kingdom
    const note = placeDetailNote(k, k.places![1], 'Ратибор')
    expect(note).toContain('create_location (scale.kind: area, parent: "kingdom", place: "ruins")')
    expect(note).toContain('отряд туда не переходит')
    expect(zoomOutNote(tavern, 'Ратибор')).toContain('scale.kind: area')
  })
})

describe('перенос старых историй (локации до 6.2 — без scale)', () => {
  /** Локация в старом формате: без scale, как в сохранениях до масштабов. */
  const legacy = (l: LocationData) => {
    const { scale: _s, ...rest } = l
    return rest as LocationData
  }
  const oldSeed = () => {
    const seed = structuredClone((created as Extract<StoryAction, { type: 'storyCreated' }>).seed) as StoryState
    seed.world.locations = Object.fromEntries(Object.entries(seed.world.locations).map(([id, l]) => [id, legacy(l)]))
    return seed
  }

  it('журнал старой истории воспроизводится: локации — клеточные, ход по карте работает; журнал не меняется', () => {
    const seed = oldSeed()
    const start = makeAction('old', 0, { type: 'storyCreated', seed }, ENGINE, 1, 'o0')
    const move = makeAction('old', 1, { type: 'heroMoved', heroId: HERO, to: { x: 10, y: 12 } }, ENGINE, 2, 'o1')
    const journal = [start, move]
    const before = JSON.stringify(journal)
    const s = replay(journal)
    expect(s.world.locations['drunken-griffin'].scale).toEqual({ kind: 'tactical', cell: 5, unit: 'ft' })
    expect(s.party[0].position).toEqual({ x: 10, y: 12 })
    expect(JSON.stringify(journal)).toBe(before)
    // Дальше — как в новой истории: путь над картой, состояние ведущему, выход на улицу.
    expect(mapPath(s, s.world.currentLocationId)).toEqual([{ id: 'drunken-griffin', name: 'Таверна «Пьяный грифон»', kind: 'trail', current: true }])
    expect(levelText(s)).toContain('клеточная карта (1 клетка = 5 фт.)')
    expect(typeof travelPlan(s, 'tavern-door')).not.toBe('string')
  })

  it('старый снимок (кэш состояния) переносится так же; пустой мир и уже новые локации не трогаются', () => {
    const snapshot = { ...applyAction(null, created), world: { ...applyAction(null, created).world, locations: oldSeed().world.locations } }
    expect(migrateStory(snapshot).world.locations['drunken-griffin'].scale?.kind).toBe('tactical')
    const empty = { ...snapshot, world: { ...snapshot.world, locations: {} } }
    expect(migrateStory(empty).world.locations).toEqual({})
    const fresh = applyAction(null, created)
    expect(migrateStory(fresh).world).toBe(fresh.world)
  })
})
