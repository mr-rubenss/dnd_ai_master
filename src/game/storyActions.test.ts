import { describe, expect, it } from 'vitest'
import adventureJson from '../data/adventures/drunken-griffin.json'
import fighterJson from '../data/characters/fighter-ratibor.json'
import itemsJson from '../data/items.json'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import type { CharacterSheet } from '../types/character'
import type { ActionAuthor, StoryAction, StoryEvent, StoryState } from '../types/story'
import { parseAdventure } from './adventure'
import { parseCharacterSheet } from './character'
import { parseItemCatalog } from './items'
import { parseLocation } from './location'
import {
  applyAction,
  checkAction,
  currentLocation,
  ENGINE,
  equipmentEvent,
  leadMember,
  makeAction,
  MASTER,
  newStorySeed,
  player,
  replay,
  storyMeta,
  SYSTEM,
} from './storyActions'

const catalog = parseItemCatalog(itemsJson)
const location = parseLocation(drunkenGriffinJson)
const locations = { [location.id]: location }
const adventure = parseAdventure(adventureJson, locations)
const ratibor = parseCharacterSheet(fighterJson, catalog)
const ingrid: CharacterSheet = { ...structuredClone(ratibor), character: { ...structuredClone(ratibor.character), id: 'ingrid', name: 'Ингрид' } }

/** История с журналом: создаёт, проверяет и применяет действия по порядку. */
function chronicle(id = 'story-a', party: CharacterSheet[] = [ratibor]) {
  const seed = newStorySeed({ id, title: 'Тест', tone: 'horror', adventure, locations, party, now: 1000 })
  const actions: StoryAction[] = [makeAction(id, 0, { type: 'storyCreated', seed }, SYSTEM, 1000, 'a0')]
  let state: StoryState = applyAction(null, actions[0])
  return {
    get state() {
      return state
    },
    actions,
    /** Проверить и применить; вернуть причину отказа или null. */
    act(event: StoryEvent, author: ActionAuthor, at = 1000 + actions.length): string | null {
      const action = makeAction(id, actions.length, event, author, at, `a${actions.length}`)
      const reason = checkAction(state, action, { catalog })
      if (reason) return reason
      actions.push(action)
      state = applyAction(state, action)
      return null
    },
  }
}

describe('новая история', () => {
  it('отряд, мир с копиями локаций приключения, вступление ведущего', () => {
    const { state } = chronicle()
    expect(state).toMatchObject({ id: 'story-a', title: 'Тест', tone: 'horror', adventureId: 'drunken-griffin', status: 'active' })
    expect(state.party).toHaveLength(1)
    expect(leadMember(state)).toMatchObject({ heroId: 'ratibor', position: location.playerStart })
    expect(currentLocation(state)).toEqual(location)
    expect(currentLocation(state)).not.toBe(location)
    expect(state.world.doors).toEqual({ 'drunken-griffin': { entrance: 'closed', 'storage-door': 'locked' } })
    expect(state.messages).toEqual(adventure.intro)
  })

  it('отряд — список: в истории может быть несколько героев', () => {
    const { state } = chronicle('story-b', [ratibor, ingrid])
    expect(state.party.map((m) => m.character.name)).toEqual(['Ратибор', 'Ингрид'])
    expect(storyMeta(state, 1).party.map((m) => m.name)).toEqual(['Ратибор', 'Ингрид'])
  })
})

describe('действия: тип, автор, время; состояние = действия по порядку', () => {
  it('каждое действие несёт тип, автора и время', () => {
    const story = chronicle()
    story.act({ type: 'playerSpoke', heroId: 'ratibor', messageId: 'm1', text: 'Заказываю эль' }, player('ratibor'), 5000)
    expect(story.actions[1]).toMatchObject({ type: 'playerSpoke', storyId: 'story-a', seq: 1, at: 5000, author: { kind: 'player', heroId: 'ratibor' } })
    expect(story.state.updatedAt).toBe(5000)
    expect(story.state.messages.at(-1)).toEqual({ id: 'm1', author: 'player', text: 'Заказываю эль', heroId: 'ratibor' })
  })

  it('воспроизведение журнала даёт то же состояние, сколько бы раз его ни повторять', () => {
    const story = chronicle()
    story.act({ type: 'playerSpoke', heroId: 'ratibor', messageId: 'm1', text: 'Открываю дверь' }, player('ratibor'))
    story.act({ type: 'doorChanged', locationId: 'drunken-griffin', doorId: 'entrance', state: 'open' }, MASTER)
    story.act({ type: 'npcMoved', locationId: 'drunken-griffin', npcId: 'tobias', to: { x: 12, y: 12 } }, MASTER)
    story.act({ type: 'diceRolled', roll: { id: 'r1', timestamp: 1, result: { notation: '1d20', mode: 'normal', groups: [], modifier: 0, total: 12 } as never } }, ENGINE)
    story.act({ type: 'factRecorded', fact: { id: 'f1', text: 'Тобиас — вор', at: 1 } }, MASTER)
    story.act({ type: 'questUpdated', quest: { id: 'q1', title: 'Кошелёк', status: 'active', notes: '' } }, MASTER)
    story.act({ type: 'questUpdated', quest: { id: 'q1', title: 'Кошелёк', status: 'completed', notes: 'вернул' } }, MASTER)
    story.act({ type: 'journalWritten', entry: { id: 'j1', at: 1, text: 'Вечер в таверне' } }, MASTER)
    story.act({ type: 'itemsGranted', heroId: 'ratibor', items: [{ itemId: 'dagger', quantity: 2 }] }, MASTER)

    const replayed = replay(story.actions)
    expect(replayed).toEqual(story.state)
    expect(replay(story.actions)).toEqual(replayed)
    expect(replayed.world.quests).toEqual([{ id: 'q1', title: 'Кошелёк', status: 'completed', notes: 'вернул' }])
    expect(replayed.world.locations['drunken-griffin'].npcs.find((n) => n.id === 'tobias')).toMatchObject({ x: 12, y: 12 })
    // Продолжение с середины журнала даёт то же самое.
    const middle = replay(story.actions.slice(0, 4))
    expect(replay(story.actions.slice(4), middle)).toEqual(story.state)
  })

  it('мир истории — копия: ведущий двигает НПС только в этой истории, данные локации не меняются', () => {
    const story = chronicle()
    story.act({ type: 'npcMoved', locationId: 'drunken-griffin', npcId: 'gunnar', to: { x: 3, y: 4 } }, MASTER)
    expect(currentLocation(story.state).npcs.find((n) => n.id === 'gunnar')).toMatchObject({ x: 3, y: 4 })
    expect(location.npcs.find((n) => n.id === 'gunnar')).toMatchObject({ x: 7, y: 1 })
  })

  it('выдача предметов складывает количество с уже имеющимися', () => {
    const story = chronicle()
    const before = leadMember(story.state).inventory.items.find((e) => e.itemId === 'javelin')?.quantity ?? 0
    story.act({ type: 'itemsGranted', heroId: 'ratibor', items: [{ itemId: 'javelin', quantity: 3 }] }, MASTER)
    expect(leadMember(story.state).inventory.items.find((e) => e.itemId === 'javelin')?.quantity).toBe(before + 3)
  })

  it('смена экипировки — событие по правилам, отказ — с причиной', () => {
    const story = chronicle()
    const ok = equipmentEvent(leadMember(story.state), catalog, { kind: 'unequip', slot: 'mainHand' })
    expect(ok.ok).toBe(true)
    if (ok.ok) story.act(ok.event, player('ratibor'))
    expect(leadMember(story.state).inventory.equipped.mainHand).toBeNull()
    const bad = equipmentEvent(leadMember(story.state), catalog, { kind: 'equip', itemId: 'chain-mail', slot: 'mainHand' })
    expect(bad).toEqual({ ok: false, reason: expect.stringContaining('Кольчуга') })
  })
})

describe('проверка действий', () => {
  it('игрок говорит только за своего героя; кубики бросает только движок', () => {
    const story = chronicle('story-a', [ratibor, ingrid])
    expect(story.act({ type: 'playerSpoke', heroId: 'ingrid', messageId: 'm', text: 'Привет' }, player('ratibor'))).toBe(
      'Говорить за героя может только его игрок.',
    )
    expect(story.act({ type: 'playerSpoke', heroId: 'ghost', messageId: 'm', text: 'Бу' }, player('ghost'))).toBe('Этого героя нет в отряде истории.')
    const roll = { id: 'r', timestamp: 1, result: { total: 20 } as never }
    expect(story.act({ type: 'diceRolled', roll }, MASTER)).toBe('Кубики бросает только движок.')
    expect(story.act({ type: 'diceRolled', roll }, ENGINE)).toBeNull()
  })

  it('ведущий не ставит НПС в несуществующее место и не открывает несуществующую дверь', () => {
    const story = chronicle()
    expect(story.act({ type: 'npcMoved', locationId: 'drunken-griffin', npcId: 'gunnar', to: { x: 25, y: 1 } }, MASTER)).toBe('НПС может стоять только на полу.')
    expect(story.act({ type: 'npcMoved', locationId: 'drunken-griffin', npcId: 'dragon', to: { x: 1, y: 1 } }, MASTER)).toBe('В этой локации нет такого НПС.')
    expect(story.act({ type: 'doorChanged', locationId: 'drunken-griffin', doorId: 'gate', state: 'open' }, MASTER)).toBe('В этой локации нет такой двери.')
    expect(story.act({ type: 'itemsGranted', heroId: 'ratibor', items: [{ itemId: 'excalibur', quantity: 1 }] }, MASTER)).toBe('Нельзя выдать «excalibur» × 1.')
    expect(story.act({ type: 'conditionsChanged', heroId: 'ratibor', conditions: [{ id: 'exhaustion', level: 9 }] }, ENGINE)).toBe('Уровень Истощения — от 1 до 6.')
  })

  it('действие чужой истории и действие после завершения отклоняются', () => {
    const story = chronicle()
    const foreign = makeAction('story-b', 1, { type: 'masterNarrated', messageId: 'x', text: 'Чужое' }, MASTER, 1)
    expect(checkAction(story.state, foreign, { catalog })).toBe('Действие относится к другой истории.')
    expect(story.act({ type: 'storyCompleted' }, SYSTEM)).toBeNull()
    expect(story.state.status).toBe('completed')
    expect(story.act({ type: 'masterNarrated', messageId: 'y', text: 'После конца' }, MASTER)).toBe('История завершена — в ней больше ничего не происходит.')
  })

  it('историю нельзя создать дважды, а переименовать — пустым названием', () => {
    const story = chronicle()
    expect(checkAction(story.state, story.actions[0], { catalog })).toBe('История уже создана.')
    expect(story.act({ type: 'storyRenamed', title: '  ' }, SYSTEM)).toBe('Введите название истории.')
  })
})
