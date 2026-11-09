// Метки игрока: действия markPlaced / markEdited / markRemoved (проверки и применение, воспроизведение журнала)
// и раздел «Метки игрока на карте» в состоянии игры для ведущего.
import { describe, expect, it } from 'vitest'
import { itemCatalog, rulesData } from '../data'
import adventureJson from '../data/adventures/drunken-griffin.json'
import fighterJson from '../data/characters/fighter-ratibor.json'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import type { PlayerMark, StoryEvent, StoryState } from '../types/story'
import { parseAdventure } from './adventure'
import { parseCharacterSheet } from './character'
import { parseLocation } from './location'
import { MARK_TEXT_MAX, markAt, marksOf, marksText, MAX_MARKS_PER_LOCATION, normalizeMarkText } from './marks'
import { gameStateText } from './masterState'
import { applyAction, checkAction, ENGINE, makeAction, MASTER, newStorySeed, player, replay, SYSTEM } from './storyActions'
import type { ActionAuthor } from '../types/story'

const ratibor = parseCharacterSheet(fighterJson, itemCatalog)
const tavern = parseLocation(drunkenGriffinJson)
const adventure = parseAdventure(adventureJson, { [tavern.id]: tavern })
const HERO = ratibor.character.id

const created = makeAction(
  's1',
  0,
  { type: 'storyCreated', seed: newStorySeed({ id: 's1', title: 'Т', tone: 'detective', adventure, locations: { [tavern.id]: tavern }, party: [ratibor], now: 1 }) },
  ENGINE,
  1,
  'c',
)
const start = () => applyAction(null, created)

const mark = (extra: Partial<PlayerMark> = {}): PlayerMark => ({ id: 'm1', heroId: HERO, locationId: tavern.id, x: 1, y: 9, icon: 'cache', text: 'тайник?', at: 5, ...extra })

let seq = 1
const act = (event: StoryEvent, author: ActionAuthor = player(HERO)) => makeAction('s1', seq++, event, author, 10 + seq, `a${seq}`)
const check = (s: StoryState, event: StoryEvent, author?: ActionAuthor) => checkAction(s, act(event, author), { catalog: itemCatalog })

describe('метки игрока: действия', () => {
  it('поставить, изменить, удалить — и всё переживает воспроизведение журнала', () => {
    let s = start()
    const placed = act({ type: 'markPlaced', mark: mark() })
    expect(checkAction(s, placed, { catalog: itemCatalog })).toBeNull()
    s = applyAction(s, placed)
    expect(marksOf(s.world, tavern.id)).toEqual([mark()])
    expect(markAt(s.world, tavern.id, { x: 1, y: 9 })?.text).toBe('тайник?')
    expect(markAt(s.world, 'elsewhere', { x: 1, y: 9 })).toBeNull()

    const edited = act({ type: 'markEdited', markId: 'm1', icon: 'danger', text: 'опасно' })
    expect(checkAction(s, edited, { catalog: itemCatalog })).toBeNull()
    s = applyAction(s, edited)
    expect(s.world.marks?.[0]).toMatchObject({ icon: 'danger', text: 'опасно', at: edited.at, x: 1, y: 9 })

    const second = act({ type: 'markPlaced', mark: mark({ id: 'm2', x: 5, y: 5, icon: 'note', text: '' }) })
    s = applyAction(s, second)
    const removed = act({ type: 'markRemoved', markId: 'm1' })
    expect(checkAction(s, removed, { catalog: itemCatalog })).toBeNull()
    s = applyAction(s, removed)
    expect(s.world.marks?.map((m) => m.id)).toEqual(['m2'])

    const back = replay([created, placed, edited, second, removed])
    expect(back.world.marks).toEqual(s.world.marks)
  })

  it('старая история без поля marks: меток нет, раздел для ведущего пуст', () => {
    const s = start()
    expect(s.world.marks).toBeUndefined()
    expect(marksOf(s.world, tavern.id)).toEqual([])
    expect(marksText(s, tavern)).toBe('')
    expect(gameStateText(s, { catalog: itemCatalog, rules: rulesData })).not.toContain('Метки игрока')
  })

  it('метки ставит, правит и удаляет только игрок своего героя', () => {
    let s = start()
    expect(check(s, { type: 'markPlaced', mark: mark() }, MASTER)).toBe('Метки на карте ставит игрок.')
    expect(check(s, { type: 'markPlaced', mark: mark() }, ENGINE)).toBe('Метки на карте ставит игрок.')
    expect(check(s, { type: 'markPlaced', mark: mark() }, SYSTEM)).toBe('Метки на карте ставит игрок.')
    expect(check(s, { type: 'markPlaced', mark: mark({ heroId: 'someone' }) })).toBe('Метку ставит игрок своего героя.')
    expect(check(s, { type: 'markPlaced', mark: mark() }, player('stranger'))).toBe('Этого героя нет в отряде истории.')
    s = applyAction(s, act({ type: 'markPlaced', mark: mark() }))
    expect(check(s, { type: 'markEdited', markId: 'm1', icon: 'note', text: 'x' }, MASTER)).toBe('Метки на карте правит игрок.')
    expect(check(s, { type: 'markRemoved', markId: 'm1' }, MASTER)).toBe('Метки на карте убирает игрок.')
    // Чужая метка (поставлена другим героем отряда) — не правится.
    const other = { ...s, world: { ...s.world, marks: [mark({ heroId: 'friend' })] } }
    expect(check(other, { type: 'markRemoved', markId: 'm1' })).toBe('Метку правит и убирает тот, кто её поставил.')
    expect(check(s, { type: 'markRemoved', markId: 'nope' })).toBe('Такой метки нет.')
    expect(check(s, { type: 'markEdited', markId: 'nope', icon: 'note', text: '' })).toBe('Такой метки нет.')
  })

  it('недопустимые метки отклоняются с причиной', () => {
    let s = start()
    expect(check(s, { type: 'markPlaced', mark: mark({ locationId: 'nowhere' }) })).toBe('В мире этой истории нет такой локации.')
    expect(check(s, { type: 'markPlaced', mark: mark({ x: tavern.width }) })).toBe(`Метка за пределами карты ${tavern.width}×${tavern.height}.`)
    expect(check(s, { type: 'markPlaced', mark: mark({ y: -1 }) })).toContain('за пределами карты')
    expect(check(s, { type: 'markPlaced', mark: mark({ x: 1.5 }) })).toContain('за пределами карты')
    expect(check(s, { type: 'markPlaced', mark: mark({ icon: 'skull' as never }) })).toContain('Значок метки — один из')
    expect(check(s, { type: 'markPlaced', mark: mark({ text: 'а'.repeat(MARK_TEXT_MAX + 1) }) })).toBe(`Текст метки — не длиннее ${MARK_TEXT_MAX} символов.`)
    expect(check(s, { type: 'markPlaced', mark: mark({ text: ' тайник ' }) })).toBe('Текст метки — одной строкой, без пробелов по краям.')
    expect(check(s, { type: 'markPlaced', mark: mark({ id: '' }) })).toBe('У метки нужен новый id.')
    s = applyAction(s, act({ type: 'markPlaced', mark: mark() }))
    expect(check(s, { type: 'markPlaced', mark: mark({ x: 2 }) })).toBe('У метки нужен новый id.')
    expect(check(s, { type: 'markPlaced', mark: mark({ id: 'm2' }) })).toBe('В этой клетке уже есть метка — измените её.')
    expect(check(s, { type: 'markEdited', markId: 'm1', icon: 'note', text: 'а'.repeat(MARK_TEXT_MAX + 1) })).toContain('не длиннее')
  })

  it('на одной карте не больше MAX_MARKS_PER_LOCATION меток', () => {
    const s = start()
    const many = Array.from({ length: MAX_MARKS_PER_LOCATION }, (_, i) => mark({ id: `k${i}`, x: i % tavern.width, y: Math.floor(i / tavern.width) }))
    const full = { ...s, world: { ...s.world, marks: many } }
    expect(check(full, { type: 'markPlaced', mark: mark({ id: 'new', x: 10, y: 10 }) })).toContain(`уже ${MAX_MARKS_PER_LOCATION} меток`)
  })

  it('завершённая история и вопрос вне игры: завершённую не меняют, вне игры игрок метки ставит', () => {
    const s = start()
    expect(check({ ...s, status: 'completed' }, { type: 'markPlaced', mark: mark() })).toBe('История завершена — в ней больше ничего не происходит.')
    expect(check({ ...s, outOfGame: true }, { type: 'markPlaced', mark: mark() })).toBeNull()
  })

  it('текст метки приводится к одной строке', () => {
    expect(normalizeMarkText('  тайник\n  за   камнем? ')).toBe('тайник за камнем?')
  })
})

describe('метки игрока: ведущему', () => {
  it('ведущий видит метки текущей карты: подпись, клетку, расстояние до героя и что там (и скрытое)', () => {
    let s = start()
    s = applyAction(s, act({ type: 'markPlaced', mark: mark() }))
    s = applyAction(s, act({ type: 'markPlaced', mark: mark({ id: 'm2', x: 10, y: 12, icon: 'question', text: '' }) }))
    const text = marksText(s, tavern)
    expect(text).toContain('## Метки игрока на карте')
    expect(text).toContain('не факты мира')
    expect(text).toContain('игрок отметил: «тайник?» (значок «тайник») — клетка (1, 9)')
    expect(text).toContain('Тайник за камнем [hearth-cache] (скрыт)')
    expect(text).toContain('«Общий зал»')
    // Герой у входа (10, 13): метка в (10, 12) — ближе, она первая.
    const lines = text.split('\n').filter((l) => l.startsWith('- '))
    expect(lines[0]).toContain('значок «вопрос» без текста — клетка (10, 12)')
    expect(lines[0]).toContain('5 фт. от Ратибор')
    expect(lines[1]).toContain('клетка (1, 9)')
    expect(gameStateText(s, { catalog: itemCatalog, rules: rulesData })).toContain('игрок отметил: «тайник?»')
  })

  it('метки другой локации ведущему не идут', () => {
    let s = start()
    s = applyAction(s, act({ type: 'markPlaced', mark: mark() }))
    const elsewhere = { ...tavern, id: 'cellar', name: 'Погреб' }
    expect(marksText({ ...s, world: { ...s.world, locations: { ...s.world.locations, cellar: elsewhere } } }, elsewhere)).toBe('')
  })
})
