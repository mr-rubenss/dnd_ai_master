import { describe, expect, it } from 'vitest'
import adventureJson from '../data/adventures/drunken-griffin.json'
import fighterJson from '../data/characters/fighter-ratibor.json'
import itemsJson from '../data/items.json'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import type { CharacterSheet } from '../types/character'
import type { ActionAuthor, StoryEvent, StoryState } from '../types/story'
import { parseAdventure } from './adventure'
import { parseCharacterSheet } from './character'
import { chronicleEntry, draftEpilogue, draftOutcome, draftSummary, findsOf, MAX_SUMMARY_SENTENCES, MIN_SUMMARY_SENTENCES, withChronicle } from './epilogue'
import { parseItemCatalog } from './items'
import { parseLocation } from './location'
import { applyAction, checkAction, ENGINE, makeAction, MASTER, newStorySeed, player, SYSTEM } from './storyActions'

const catalog = parseItemCatalog(itemsJson)
const location = parseLocation(drunkenGriffinJson)
const locations = { [location.id]: location }
const adventure = parseAdventure(adventureJson, locations)
const ratibor = parseCharacterSheet(fighterJson, catalog)
const ingrid: CharacterSheet = { ...structuredClone(ratibor), character: { ...structuredClone(ratibor.character), id: 'ingrid', name: 'Ингрид' } }

/** История и применение к ней событий (с проверкой правил). */
function story(party: CharacterSheet[] = [ratibor], events: [StoryEvent, ActionAuthor][] = []): StoryState {
  let state = newStorySeed({ id: 's1', title: 'Тень над трактом', tone: 'detective', adventure, locations, party, now: 1000 })
  events.forEach(([event, author], i) => {
    const action = makeAction('s1', i + 1, event, author, 2000 + i, `a${i}`)
    const reason = checkAction(state, action, { catalog })
    if (reason) throw new Error(reason)
    state = applyAction(state, action)
  })
  return state
}

/** Предложения текста. */
const sentences = (text: string) => text.split(/(?<=[.!?…])\s+/).filter(Boolean)

const quest = (id: string, title: string, status: 'active' | 'completed' | 'failed'): [StoryEvent, ActionAuthor] => [
  { type: 'questUpdated', quest: { id, title, status, notes: '' } },
  MASTER,
]
const fact = (id: string, text: string): [StoryEvent, ActionAuthor] => [{ type: 'factRecorded', fact: { id, text, at: 1 } }, MASTER]

describe('черновик краткого содержания', () => {
  it('собирается из выполненных и проваленных квестов и журнала фактов', () => {
    const state = story([ratibor], [
      quest('q1', 'Вернуть кошелёк', 'completed'),
      quest('q2', 'Найти пропавшего торговца', 'active'),
      quest('q3', 'Спасти лютню', 'failed'),
      fact('f1', 'Тобиас работает на гильдию воров'),
      fact('f2', 'Под таверной есть старый погреб.'),
      [{ type: 'playerSpoke', heroId: 'ratibor', messageId: 'm', text: 'ход' }, player('ratibor')],
    ])
    const summary = draftSummary(state)
    expect(summary).toContain('Детектив: история «Тень над трактом» разворачивалась в месте «Таверна «Пьяный грифон»», в отряде — Ратибор.')
    expect(summary).toContain('Выполнено задание «Вернуть кошелёк».')
    expect(summary).toContain('Провалено задание «Спасти лютню».')
    expect(summary).not.toContain('Найти пропавшего торговца')
    expect(summary).toContain('Тобиас работает на гильдию воров.')
    expect(summary).toContain('Под таверной есть старый погреб.')
    expect(summary).toContain('Сделано ходов: 1.')
  })

  it('всегда 3–6 предложений: и без событий, и при множестве фактов', () => {
    const empty = sentences(draftSummary(story()))
    expect(empty.length).toBeGreaterThanOrEqual(MIN_SUMMARY_SENTENCES)
    expect(draftSummary(story())).toContain('Заметных событий в журнале не записано.')

    const many = story([ratibor], [quest('q1', 'Раз', 'completed'), quest('q2', 'Два', 'failed'), ...Array.from({ length: 8 }, (_, i) => fact(`f${i}`, `Факт номер ${i}`))])
    const parts = sentences(draftSummary(many))
    expect(parts.length).toBe(MAX_SUMMARY_SENTENCES)
    // Помещаются самые свежие факты.
    expect(draftSummary(many)).toContain('Факт номер 7.')
    expect(draftSummary(many)).not.toContain('Факт номер 0.')
  })

  it('чем всё кончилось: живые снова в пути, погибшие названы', () => {
    expect(draftOutcome(story())).toBe('История завершена. Ратибор — снова в пути и может начать новую историю.')
    const mixed = story([ratibor, ingrid], [[{ type: 'heroDied', heroId: 'ingrid' }, ENGINE]])
    expect(draftOutcome(mixed)).toBe('История завершена. Погиб герой: Ингрид. Ратибор — снова в пути и может начать новую историю.')
    expect(draftEpilogue(mixed, 5000).endedAt).toBe(5000)
  })
})

describe('находки и летопись', () => {
  it('ключевые находки — предметы, полученные героем в истории, с количеством', () => {
    const state = story([ratibor, ingrid], [
      [{ type: 'itemsGranted', heroId: 'ratibor', items: [{ itemId: 'dagger', quantity: 1 }] }, MASTER],
      [{ type: 'itemsGranted', heroId: 'ratibor', items: [{ itemId: 'dagger', quantity: 1 }, { itemId: 'shield', quantity: 1 }] }, MASTER],
      [{ type: 'itemsGranted', heroId: 'ingrid', items: [{ itemId: 'javelin', quantity: 3 }] }, MASTER],
    ])
    expect(findsOf(state, 'ratibor', catalog)).toEqual(['Кинжал ×2', 'Щит'])
    expect(findsOf(state, 'ingrid', catalog)).toEqual(['Метательное копьё ×3'])
  })

  it('запись летописи: название, дата, итог, уровни в начале и в конце, находки, судьба', () => {
    let state = story([ratibor], [[{ type: 'itemsGranted', heroId: 'ratibor', items: [{ itemId: 'dagger', quantity: 1 }] }, MASTER]])
    // Герой вырос в истории (пока уровни поднимаются только так — повышение уровня появится позже).
    state = { ...state, party: state.party.map((m) => ({ ...m, character: { ...m.character, level: 2 } })) }
    const entry = chronicleEntry(state, state.party[0], { summary: ' Итог. ', outcome: 'Жив.', endedAt: 9000 }, catalog)
    expect(entry).toEqual({
      storyId: 's1',
      storyTitle: 'Тень над трактом',
      endedAt: 9000,
      summary: 'Итог.',
      outcome: 'Жив.',
      startLevel: 1,
      endLevel: 2,
      finds: ['Кинжал'],
      fate: 'survived',
    })
  })

  it('летопись дописывается по порядку, правка итога заменяет запись той же истории', () => {
    const base = { storyTitle: 'T', summary: 'S', outcome: 'O', startLevel: 1, endLevel: 1, finds: [], fate: 'survived' as const }
    let sheet = withChronicle(ratibor, { ...base, storyId: 'b', endedAt: 200 })
    sheet = withChronicle(sheet, { ...base, storyId: 'a', endedAt: 100 })
    expect(sheet.character.chronicle!.map((e) => e.storyId)).toEqual(['a', 'b'])
    sheet = withChronicle(sheet, { ...base, storyId: 'a', endedAt: 100, summary: 'Поправлено' })
    expect(sheet.character.chronicle!.map((e) => [e.storyId, e.summary])).toEqual([
      ['a', 'Поправлено'],
      ['b', 'S'],
    ])
    expect(ratibor.character.chronicle).toBeUndefined()
  })
})

describe('завершённая история — только для чтения', () => {
  it('после завершения нельзя ничего, кроме правки итога', () => {
    const epilogue = { summary: 'Кратко.', outcome: 'Конец.', endedAt: 1 }
    const done = story([ratibor], [[{ type: 'storyCompleted', epilogue }, SYSTEM]])
    expect(done.status).toBe('completed')
    expect(done.epilogue).toEqual(epilogue)
    const say = makeAction('s1', 2, { type: 'playerSpoke', heroId: 'ratibor', messageId: 'm', text: 'Ещё' }, player('ratibor'), 3)
    expect(checkAction(done, say, { catalog })).toBe('История завершена — в ней больше ничего не происходит.')
    const edit = makeAction('s1', 2, { type: 'epilogueEdited', epilogue: { ...epilogue, summary: 'Иначе.' } }, SYSTEM, 3)
    expect(checkAction(done, edit, { catalog })).toBeNull()
    expect(applyAction(done, edit).epilogue?.summary).toBe('Иначе.')
    const empty = makeAction('s1', 2, { type: 'epilogueEdited', epilogue: { ...epilogue, summary: '  ' } }, SYSTEM, 3)
    expect(checkAction(done, empty, { catalog })).toBe('Краткое содержание не может быть пустым.')
  })

  it('править итог незавершённой истории нельзя; гибель героя определяет только движок', () => {
    const state = story()
    const edit = makeAction('s1', 1, { type: 'epilogueEdited', epilogue: { summary: 'a', outcome: 'b', endedAt: 1 } }, SYSTEM, 2)
    expect(checkAction(state, edit, { catalog })).toBe('Итог есть только у завершённой истории.')
    const death = makeAction('s1', 1, { type: 'heroDied', heroId: 'ratibor' }, MASTER, 2)
    expect(checkAction(state, death, { catalog })).toBe('Гибель героя определяет движок по правилам.')
  })
})
