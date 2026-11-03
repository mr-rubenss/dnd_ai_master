import { describe, expect, it } from 'vitest'
import fighterJson from '../data/characters/fighter-ratibor.json'
import itemsJson from '../data/items.json'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import adventureJson from '../data/adventures/drunken-griffin.json'
import type { CharacterSheet } from '../types/character'
import type { StoryState } from '../types/story'
import type { HeroRoster } from '../types/heroes'
import { parseCharacterSheet } from './character'
import {
  addHero,
  createHeroRecord,
  deleteHero,
  EMPTY_ROSTER,
  heroSummary,
  joinStory,
  leaveStory,
  parseRoster,
  reconcileRoster,
  renameHero,
  retireHero,
  type RosterResult,
} from './heroes'
import { parseItemCatalog } from './items'
import { parseLocation } from './location'
import { parseAdventure } from './adventure'
import { applyAction, makeAction, newStorySeed, player, storyMeta } from './storyActions'

const catalog = parseItemCatalog(itemsJson)
const location = parseLocation(drunkenGriffinJson)
const locations = { [location.id]: location }
const adventure = parseAdventure(adventureJson, locations)
const ratibor = parseCharacterSheet(fighterJson, catalog)

/** Другой герой: копия Ратибора с другим id, именем и классом. */
function otherHero(id = 'hero-2', name = 'Ингрид'): CharacterSheet {
  return { ...structuredClone(ratibor), character: { ...structuredClone(ratibor.character), id, name } }
}

let storySeq = 0
/** Новая история с отрядом из этих героев. */
function storyFor(...party: CharacterSheet[]): StoryState {
  return newStorySeed({ id: `story-${++storySeq}`, title: 'Вечер в «Пьяном грифоне»', tone: 'light-adventure', adventure, locations, party, now: 1000 })
}

/** Реплика героя в истории (через действие). */
function say(state: StoryState, heroId: string, text: string): StoryState {
  return applyAction(state, makeAction(state.id, 1, { type: 'playerSpoke', heroId, messageId: crypto.randomUUID(), text }, player(heroId), 2000))
}

/** Успешный результат — список героев; при отказе тест падает. */
function ok(result: RosterResult): HeroRoster {
  if (!result.ok) throw new Error(result.reason)
  return result.roster
}
const reason = (result: RosterResult) => (result.ok ? null : result.reason)

const withRatibor = () => ok(addHero(EMPTY_ROSTER, createHeroRecord(ratibor, 1000)))

describe('список героев', () => {
  it('новый герой: портрет по классу, свободен, лист — копия', () => {
    const hero = createHeroRecord(ratibor, 1000)
    expect(hero).toMatchObject({ id: 'ratibor', portrait: '⚔️', createdAt: 1000, storyId: null })
    expect(hero.sheet).toEqual(ratibor)
    expect(hero.sheet).not.toBe(ratibor)
  })

  it('не добавляет героя с тем же id дважды', () => {
    expect(reason(addHero(withRatibor(), createHeroRecord(ratibor)))).toBe('Герой с id «ratibor» уже есть.')
  })

  it('переименовывает с обрезкой пробелов; пустое и слишком длинное имя — отказ', () => {
    const roster = ok(renameHero(withRatibor(), 'ratibor', '  Ратибор Смелый  '))
    expect(roster.heroes[0].sheet.character.name).toBe('Ратибор Смелый')
    expect(reason(renameHero(roster, 'ratibor', '   '))).toBe('Введите имя героя.')
    expect(reason(renameHero(roster, 'ratibor', 'Я'.repeat(41)))).toBe('Имя не длиннее 40 символов.')
    expect(reason(renameHero(roster, 'nobody', 'Имя'))).toBe('Такого героя нет в списке.')
  })

  it('удаляет свободного героя, а героя из незавершённой истории — нет', () => {
    expect(ok(deleteHero(withRatibor(), 'ratibor')).heroes).toEqual([])
    const inStory = ok(joinStory(withRatibor(), 'ratibor', 'run-1'))
    expect(reason(deleteHero(inStory, 'ratibor', 'Вечер в «Пьяном грифоне»'))).toBe(
      'Ратибор сейчас в истории «Вечер в «Пьяном грифоне»». Удалить можно только героя вне истории.',
    )
  })

  it('один герой — только в одной незавершённой истории', () => {
    const inStory = ok(joinStory(withRatibor(), 'ratibor', 'run-1'))
    expect(reason(joinStory(inStory, 'ratibor', 'run-2'))).toBe('Ратибор уже участвует в другой незавершённой истории.')
    expect(ok(joinStory(inStory, 'ratibor', 'run-1'))).toEqual(inStory)
    // Выйдя из истории, герой снова свободен.
    const free = ok(leaveStory(inStory, 'ratibor'))
    expect(ok(joinStory(free, 'ratibor', 'run-2')).heroes[0].storyId).toBe('run-2')
  })

  it('выходя из прерванной истории, герой сохраняет то, что получил в ней', () => {
    const inStory = ok(joinStory(withRatibor(), 'ratibor', 'run-1'))
    const changed = { ...ratibor, inventory: { ...ratibor.inventory, gold: 999 } }
    const free = ok(leaveStory(inStory, 'ratibor', changed))
    expect(free.heroes[0]).toMatchObject({ storyId: null, sheet: { inventory: { gold: 999 } } })
  })
})

describe('Зал славы', () => {
  /** Ратибор в идущей истории с N репликами. */
  function playing(turns: number) {
    let story = storyFor(ratibor)
    for (let i = 0; i < turns; i++) story = say(story, 'ratibor', `ход ${i}`)
    return { story, roster: ok(joinStory(withRatibor(), 'ratibor', story.id)) }
  }

  it('завершённая история: герой уходит из списка в «Зал славы» с итогом пути', () => {
    const { story, roster } = playing(3)
    const result = ok(retireHero(roster, story, 'ratibor', 'completed', 5000))
    expect(result.heroes).toEqual([])
    expect(result.hallOfFame).toEqual([
      {
        id: expect.any(String),
        heroId: 'ratibor',
        name: 'Ратибор',
        species: 'Человек',
        className: 'Воин',
        level: 1,
        portrait: '⚔️',
        fate: 'completed',
        storyTitle: 'Вечер в «Пьяном грифоне»',
        summary: 'История «Вечер в «Пьяном грифоне»» завершена на 1-м уровне. 3 хода, 0 бросков кубиков.',
        endedAt: 5000,
      },
    ])
  })

  it('гибель героя — тоже в «Зал славы», новые записи — первыми', () => {
    const { story, roster } = playing(1)
    const first = ok(retireHero(roster, story, 'ratibor', 'fallen'))
    expect(first.hallOfFame[0]).toMatchObject({ fate: 'fallen', summary: expect.stringMatching(/^Гибель в истории «Вечер в «Пьяном грифоне»» на 1-м уровне\. 1 ход,/) })

    const second = storyFor(otherHero())
    const withSecond = ok(joinStory(ok(addHero(first, createHeroRecord(otherHero()))), 'hero-2', second.id))
    expect(ok(retireHero(withSecond, second, 'hero-2', 'completed')).hallOfFame.map((e) => e.name)).toEqual(['Ингрид', 'Ратибор'])
  })

  it('в отряде из двух героев ходы считаются каждому свои', () => {
    let story = storyFor(ratibor, otherHero())
    story = say(say(say(story, 'ratibor', 'раз'), 'hero-2', 'два'), 'hero-2', 'три')
    expect(heroSummary('completed', story, story.party[0])).toContain('1 ход,')
    expect(heroSummary('completed', story, story.party[1])).toContain('2 хода,')
  })

  it('уйти в «Зал славы» может только герой этой истории', () => {
    const { story } = playing(0)
    expect(reason(retireHero(withRatibor(), story, 'ratibor', 'completed'))).toBe('Ратибор не участвует в этой истории.')
  })

  it.each([
    [1, '1 ход'],
    [2, '2 хода'],
    [5, '5 ходов'],
    [11, '11 ходов'],
    [21, '21 ход'],
    [24, '24 хода'],
  ])('итог пути: %i → «%s»', (turns, text) => {
    const { story } = playing(turns)
    expect(heroSummary('completed', story, story.party[0])).toContain(text)
  })
})

describe('согласование списка героев с историями', () => {
  it('освобождает героев историй, которых больше нет или которые завершены', () => {
    const roster = ok(joinStory(withRatibor(), 'ratibor', 'lost-run'))
    expect(reconcileRoster(roster, []).heroes[0].storyId).toBeNull()
    const done = { ...storyMeta(storyFor(ratibor), 1), id: 'lost-run', status: 'completed' as const }
    expect(reconcileRoster(roster, [done]).heroes[0].storyId).toBeNull()
  })

  it('отмечает героя в незавершённой истории, в отряде которой он есть', () => {
    const story = storyFor(ratibor)
    expect(reconcileRoster(withRatibor(), [storyMeta(story, 1)]).heroes[0].storyId).toBe(story.id)
  })

  it('ничего не меняет, если всё согласовано', () => {
    const story = storyFor(ratibor)
    const roster = ok(joinStory(withRatibor(), 'ratibor', story.id))
    expect(reconcileRoster(roster, [storyMeta(story, 1)])).toBe(roster)
  })
})

describe('parseRoster', () => {
  it('принимает корректный список', () => {
    const roster = ok(joinStory(withRatibor(), 'ratibor', 'run-1'))
    expect(parseRoster(JSON.parse(JSON.stringify(roster)), catalog)).toEqual(roster)
  })

  it('отклоняет повреждённый лист, несовпадающий id и неверную запись «Зала славы»', () => {
    const hero = createHeroRecord(ratibor)
    const broken = {
      heroes: [
        { ...hero, id: 'other' },
        { ...hero, id: 'bad-sheet', sheet: { ...hero.sheet, character: { ...hero.sheet.character, id: 'bad-sheet', level: 99 } } },
      ],
      hallOfFame: [{ id: 'x', fate: 'vanished' }],
    }
    expect(() => parseRoster(broken, catalog)).toThrow(/heroes\[0\]: id героя не совпадает[\s\S]*heroes\[1\]\.sheet: character\.level[\s\S]*hallOfFame\[0\]/)
  })
})
