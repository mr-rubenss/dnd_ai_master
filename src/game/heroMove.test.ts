import { describe, expect, it } from 'vitest'
import { itemCatalog } from '../data'
import adventureJson from '../data/adventures/drunken-griffin.json'
import fighterJson from '../data/characters/fighter-ratibor.json'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import type { ActionAuthor, StoryEvent, StoryState } from '../types/story'
import { parseAdventure } from './adventure'
import { parseCharacterSheet } from './character'
import { approachCell, heroMovePlan, heroReachable } from './heroMove'
import { parseLocation } from './location'
import { entityActions } from './mapActions'
import { applyAction, checkAction, currentLocation, ENGINE, makeAction, MASTER, newStorySeed, player } from './storyActions'

const location = parseLocation(drunkenGriffinJson)
const locations = { [location.id]: location }
const adventure = parseAdventure(adventureJson, locations)
const ratibor = parseCharacterSheet(fighterJson, itemCatalog)
const fresh = (): StoryState => newStorySeed({ id: 's1', title: 'Тест', tone: 'detective', adventure, locations, party: [ratibor], now: 1 })

const act = (state: StoryState, event: StoryEvent, author: ActionAuthor) => {
  const action = makeAction(state.id, 1, event, author, 2, 'a1')
  const reason = checkAction(state, action, { catalog: itemCatalog })
  return reason ?? applyAction(state, action)
}

describe('перемещение героя', () => {
  it('путь и длина в футах; герой стоит у входа (10, 13)', () => {
    const s = fresh()
    expect(s.party[0].position).toEqual({ x: 10, y: 13 })
    const plan = heroMovePlan(currentLocation(s), s, 'ratibor', { x: 10, y: 11 })
    expect(plan).toMatchObject({ feet: 10 })
  })

  it('нельзя: за картой, занято НПС или мебелью, за запертой дверью; на стул — можно, ковёр не мешает', () => {
    const s = fresh()
    const loc = currentLocation(s)
    expect(heroMovePlan(loc, s, 'ratibor', { x: 25, y: 3 })).toBe('Эта клетка за пределами карты.')
    expect(heroMovePlan(loc, s, 'ratibor', { x: 7, y: 1 })).toBe('Клетка занята: НПС «Гуннар».')
    expect(heroMovePlan(loc, s, 'ratibor', { x: 9, y: 7 })).toBe('Клетка занята: объект «Центральный стол».')
    expect(heroMovePlan(loc, s, 'ratibor', { x: 17, y: 3 })).toBe('Туда не дойти: путь перекрывают стены, закрытые двери или мебель.')
    expect(heroMovePlan(loc, s, 'ratibor', { x: 8, y: 7 })).toMatchObject({ feet: expect.any(Number) })
    expect(heroMovePlan(loc, s, 'ratibor', { x: 8, y: 9 })).toMatchObject({ feet: expect.any(Number) })
    expect(heroReachable(loc, s, 'ratibor').has('17,3')).toBe(false)
  })

  it('«Подойти»: ближайшая свободная клетка рядом с НПС; уже рядом — идти не нужно', () => {
    const s = fresh()
    const near = approachCell(currentLocation(s), s, 'ratibor', { x: 17, y: 9, w: 1, h: 1 })!
    expect(Math.max(Math.abs(near.cell.x - 17), Math.abs(near.cell.y - 9))).toBe(1)
    expect(near.plan.path.at(-1)).toEqual(near.cell)
    const moved = act(s, { type: 'heroMoved', heroId: 'ratibor', to: near.cell }, player('ratibor')) as StoryState
    expect(approachCell(currentLocation(moved), moved, 'ratibor', { x: 17, y: 9, w: 1, h: 1 })!.plan.path).toEqual([])
  })

  it('действие heroMoved: игрок двигает своего героя по правилам; ведущий героя не двигает; в стену — отказ', () => {
    const s = fresh()
    const next = act(s, { type: 'heroMoved', heroId: 'ratibor', to: { x: 12, y: 11 } }, player('ratibor')) as StoryState
    expect(next.party[0].position).toEqual({ x: 12, y: 11 })
    expect(act(s, { type: 'heroMoved', heroId: 'ratibor', to: { x: 12, y: 11 } }, MASTER)).toBe('Героя передвигает игрок или движок, а не ведущий напрямую (инструмент move_hero).')
    expect(act(s, { type: 'heroMoved', heroId: 'ratibor', to: { x: 12, y: 11 } }, player('someone'))).toBe('Этого героя нет в отряде истории.')
    expect(act(s, { type: 'heroMoved', heroId: 'ratibor', to: { x: 16, y: 2 } }, ENGINE)).toMatch(/^Туда не дойти/)
  })
})

describe('меню действий на карте', () => {
  const ids = (t: Parameters<typeof entityActions>[0]) => entityActions(t).map((a) => a.label)
  it('НПС — подойти, осмотреть, поговорить; дверь — открыть или закрыть; предмет — взять', () => {
    expect(ids({ kind: 'npc', name: 'Гуннар' })).toEqual(['Подойти', 'Осмотреть', 'Поговорить'])
    expect(ids({ kind: 'door', name: 'Входная дверь', doorState: 'closed' })).toEqual(['Подойти', 'Осмотреть', 'Открыть'])
    expect(ids({ kind: 'door', name: 'Входная дверь', doorState: 'open' })).toEqual(['Подойти', 'Осмотреть', 'Закрыть'])
    expect(ids({ kind: 'object', name: 'Свеча', type: 'candle' })).toEqual(['Подойти', 'Осмотреть', 'Взять'])
    expect(ids({ kind: 'object', name: 'Стол', type: 'table' })).toEqual(['Подойти', 'Осмотреть'])
  })

  it('текст — от имени героя', () => {
    const talk = entityActions({ kind: 'npc', name: 'Гуннар' }).find((a) => a.id === 'talk')!
    expect(talk.text).toBe('Заговариваю с «Гуннар».')
    // У НПС — без слова «НПС», имя в кавычках без склонения.
    expect(entityActions({ kind: 'npc', name: 'Тобиас' }).map((a) => a.text)).toEqual(['Подхожу к «Тобиас».', 'Присматриваюсь к «Тобиас».', 'Заговариваю с «Тобиас».'])
    // Двери и предметы — как раньше.
    expect(entityActions({ kind: 'object', name: 'Свеча', type: 'candle' }).map((a) => a.text)).toEqual(['Подхожу ближе: «Свеча».', 'Осматриваю: «Свеча».', 'Беру: «Свеча».'])
    expect(entityActions({ kind: 'door', name: 'Входная дверь', doorState: 'locked' }).at(-1)!.text).toBe('Открываю дверь «Входная дверь».')
  })
})
