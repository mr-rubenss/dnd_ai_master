// Действия истории: создание, проверка по правилам и применение. Чистые функции.
//
// Состояние истории = применение её действий по порядку (replay). Применение детерминировано:
// всё случайное (id, броски кубиков, время) записано в самом действии. Поэтому журнал действий
// можно сохранить, воспроизвести и (в будущем) передавать между игроками по сети.

import { CONDITIONS, MAX_EXHAUSTION } from '../engine/conditions'
import { isFloor } from '../engine/movement'
import type { CharacterSheet, Equipment } from '../types/character'
import type { ChatMessage } from '../types/game'
import type { ItemCatalog } from '../types/items'
import type { LocationData } from '../types/location'
import {
  QUEST_STATUSES,
  type ActionAuthor,
  type PartyMember,
  type StoryAction,
  type StoryEvent,
  type StoryMeta,
  type StoryState,
  type StoryTone,
} from '../types/story'
import type { AdventureData } from './adventure'
import { equipItem, unequipSlot, type EquipmentSlot } from './equipment'
import { isNonEmptyString } from './validation'

export const TONE_LABELS: Record<StoryTone, string> = {
  'dark-fantasy': 'Тёмное фэнтези',
  'light-adventure': 'Лёгкое приключение',
  detective: 'Детектив',
  horror: 'Хоррор',
}

export const MAX_STORY_TITLE_LENGTH = 60
export const MAX_EPILOGUE_LENGTH = 1500
/** Сколько последних бросков хранить в состоянии (журнал действий хранит все). */
export const MAX_ROLL_LOG = 100

export const ENGINE: ActionAuthor = { kind: 'engine' }
export const MASTER: ActionAuthor = { kind: 'master' }
export const SYSTEM: ActionAuthor = { kind: 'system' }
export const player = (heroId: string): ActionAuthor => ({ kind: 'player', heroId })

// ---------- Новая история ----------

export interface NewStoryInput {
  id: string
  title: string
  tone: StoryTone
  adventure: AdventureData
  /** Все локации игры: в мир истории копируются локации приключения. */
  locations: Record<string, LocationData>
  /** Листы героев отряда. */
  party: CharacterSheet[]
  now: number
}

export function storyTitleProblem(title: string): string | null {
  const trimmed = title.trim()
  if (trimmed === '') return 'Введите название истории.'
  if (trimmed.length > MAX_STORY_TITLE_LENGTH) return `Название не длиннее ${MAX_STORY_TITLE_LENGTH} символов.`
  return null
}

/** Начальное состояние новой истории: копии героев и локаций приключения, вступление ведущего. */
export function newStorySeed({ id, title, tone, adventure, locations, party, now }: NewStoryInput): StoryState {
  const start = locations[adventure.startLocationId]
  const worldLocations = Object.fromEntries(adventure.locationIds.map((locId) => [locId, locations[locId]]))
  return structuredClone({
    id,
    title: title.trim(),
    tone,
    adventureId: adventure.id,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    party: party.map((sheet): PartyMember => ({
      heroId: sheet.character.id,
      character: sheet.character,
      inventory: sheet.inventory,
      position: start.playerStart,
      startLevel: sheet.character.level,
    })),
    world: {
      locations: worldLocations,
      currentLocationId: start.id,
      doors: Object.fromEntries(
        Object.values(worldLocations).map((loc) => [loc.id, Object.fromEntries(loc.doors.map((d) => [d.id, d.state]))]),
      ),
      facts: [],
      quests: [],
    },
    journal: [],
    messages: adventure.intro,
    rolls: [],
  })
}

/** Оформляет событие как действие истории: номер, автор, время, id. */
export function makeAction(
  storyId: string,
  seq: number,
  event: StoryEvent,
  author: ActionAuthor,
  at: number = Date.now(),
  id: string = crypto.randomUUID(),
): StoryAction {
  return { ...event, id, storyId, seq, at, author }
}

// ---------- Применение ----------

const updateMember = (state: StoryState, heroId: string, change: (m: PartyMember) => PartyMember): StoryState => ({
  ...state,
  party: state.party.map((m) => (m.heroId === heroId ? change(m) : m)),
})

/** Применяет действие к состоянию. Действие должно быть проверено (checkAction) до записи в журнал. */
export function applyAction(state: StoryState | null, action: StoryAction): StoryState {
  if (action.type === 'storyCreated') return { ...structuredClone(action.seed), updatedAt: action.at }
  if (!state) throw new Error(`Действие «${action.type}» до создания истории`)
  const next = applyEvent(state, action)
  return { ...next, updatedAt: action.at }
}

function applyEvent(state: StoryState, action: StoryAction): StoryState {
  switch (action.type) {
    case 'storyCreated':
      return structuredClone(action.seed)
    case 'storyRenamed':
      return { ...state, title: action.title }
    case 'storyCompleted':
      return { ...state, status: 'completed', ...(action.epilogue ? { epilogue: action.epilogue } : {}) }
    case 'epilogueEdited':
      return { ...state, epilogue: action.epilogue }
    case 'heroDied':
      return updateMember(state, action.heroId, (m) => ({ ...m, fallen: true, character: { ...m.character, hp: 0 } }))
    case 'playerSpoke': {
      const message: ChatMessage = { id: action.messageId, author: 'player', text: action.text, heroId: action.heroId }
      return { ...state, messages: [...state.messages, message] }
    }
    case 'masterNarrated':
      return { ...state, messages: [...state.messages, { id: action.messageId, author: 'master', text: action.text }] }
    case 'diceRolled':
      return { ...state, rolls: [...state.rolls, action.roll].slice(-MAX_ROLL_LOG) }
    case 'equipmentChanged':
      return updateMember(state, action.heroId, (m) => ({ ...m, inventory: { ...m.inventory, equipped: action.equipped } }))
    case 'heroRenamed':
      return updateMember(state, action.heroId, (m) => ({ ...m, character: { ...m.character, name: action.name } }))
    case 'conditionsChanged':
      return updateMember(state, action.heroId, (m) => ({ ...m, character: { ...m.character, conditions: action.conditions } }))
    case 'itemsGranted': {
      const finds = [...(state.finds ?? []), ...action.items.map((e) => ({ heroId: action.heroId, itemId: e.itemId, quantity: e.quantity, at: action.at }))]
      return updateMember({ ...state, finds }, action.heroId, (m) => {
        const items = [...m.inventory.items]
        for (const { itemId, quantity } of action.items) {
          const index = items.findIndex((e) => e.itemId === itemId)
          if (index >= 0) items[index] = { ...items[index], quantity: items[index].quantity + quantity }
          else items.push({ itemId, quantity })
        }
        return { ...m, inventory: { ...m.inventory, items } }
      })
    }
    case 'npcMoved': {
      const location = state.world.locations[action.locationId]
      const npcs = location.npcs.map((n) => (n.id === action.npcId ? { ...n, x: action.to.x, y: action.to.y } : n))
      return { ...state, world: { ...state.world, locations: { ...state.world.locations, [location.id]: { ...location, npcs } } } }
    }
    case 'doorChanged': {
      const doors = { ...state.world.doors, [action.locationId]: { ...state.world.doors[action.locationId], [action.doorId]: action.state } }
      return { ...state, world: { ...state.world, doors } }
    }
    case 'factRecorded':
      return { ...state, world: { ...state.world, facts: [...state.world.facts, action.fact] } }
    case 'questUpdated': {
      const exists = state.world.quests.some((q) => q.id === action.quest.id)
      const quests = exists ? state.world.quests.map((q) => (q.id === action.quest.id ? action.quest : q)) : [...state.world.quests, action.quest]
      return { ...state, world: { ...state.world, quests } }
    }
    case 'journalWritten':
      return { ...state, journal: [...state.journal, action.entry] }
  }
}

/** Восстанавливает состояние истории по журналу действий. */
export function replay(actions: readonly StoryAction[], from: StoryState | null = null): StoryState {
  const state = actions.reduce<StoryState | null>(applyAction, from)
  if (!state) throw new Error('В журнале нет действия создания истории')
  return state
}

// ---------- Проверка ----------

export interface ActionContext {
  catalog: ItemCatalog
}

/**
 * Проверяет действие по правилам и текущему состоянию истории. Возвращает причину отказа или null.
 * Так проверяются и действия игрока, и предложения ведущего, и (в будущем) действия, пришедшие по сети.
 */
export function checkAction(state: StoryState | null, action: StoryAction, { catalog }: ActionContext): string | null {
  if (action.type === 'storyCreated') {
    if (state) return 'История уже создана.'
    if (action.seed.id !== action.storyId) return 'id истории в действии и в состоянии не совпадают.'
    if (action.seed.party.length === 0) return 'В отряде нет ни одного героя.'
    return null
  }
  if (!state) return 'История ещё не создана.'
  if (action.storyId !== state.id) return 'Действие относится к другой истории.'
  if (action.type === 'epilogueEdited') {
    if (state.status !== 'completed') return 'Итог есть только у завершённой истории.'
    return epilogueProblem(action.epilogue)
  }
  if (state.status === 'completed') return 'История завершена — в ней больше ничего не происходит.'

  const member = (heroId: string) => state.party.find((m) => m.heroId === heroId)
  if (action.author.kind === 'player' && !member(action.author.heroId)) return 'Этого героя нет в отряде истории.'
  const needMember = (heroId: string) => (member(heroId) ? null : 'Этого героя нет в отряде истории.')

  switch (action.type) {
    case 'storyRenamed':
      return storyTitleProblem(action.title)
    case 'storyCompleted':
      return action.epilogue ? epilogueProblem(action.epilogue) : null
    case 'heroDied':
      return needMember(action.heroId) ?? (action.author.kind === 'engine' ? null : 'Гибель героя определяет движок по правилам.')
    case 'playerSpoke':
      if (action.author.kind !== 'player' || action.author.heroId !== action.heroId) return 'Говорить за героя может только его игрок.'
      return isNonEmptyString(action.text) ? null : 'Пустая реплика.'
    case 'masterNarrated':
      return isNonEmptyString(action.text) ? null : 'Пустой текст ведущего.'
    case 'diceRolled':
      return action.author.kind === 'engine' ? null : 'Кубики бросает только движок.'
    case 'equipmentChanged':
      return needMember(action.heroId)
    case 'heroRenamed':
      return needMember(action.heroId) ?? (isNonEmptyString(action.name) ? null : 'Пустое имя.')
    case 'conditionsChanged': {
      const problem = needMember(action.heroId)
      if (problem) return problem
      for (const c of action.conditions) {
        if (!(CONDITIONS as readonly string[]).includes(c.id)) return `Неизвестное состояние «${c.id}».`
        if (c.id === 'exhaustion' && (!Number.isInteger(c.level) || c.level! < 1 || c.level! > MAX_EXHAUSTION)) return 'Уровень Истощения — от 1 до 6.'
      }
      return null
    }
    case 'itemsGranted': {
      const problem = needMember(action.heroId)
      if (problem) return problem
      const bad = action.items.find((e) => !catalog[e.itemId] || !Number.isInteger(e.quantity) || e.quantity < 1)
      return bad ? `Нельзя выдать «${bad.itemId}» × ${bad.quantity}.` : null
    }
    case 'npcMoved': {
      const location = state.world.locations[action.locationId]
      if (!location) return 'В мире этой истории нет такой локации.'
      if (!location.npcs.some((n) => n.id === action.npcId)) return 'В этой локации нет такого НПС.'
      return isFloor(location, action.to.x, action.to.y) ? null : 'НПС может стоять только на полу.'
    }
    case 'doorChanged': {
      const location = state.world.locations[action.locationId]
      if (!location) return 'В мире этой истории нет такой локации.'
      return location.doors.some((d) => d.id === action.doorId) ? null : 'В этой локации нет такой двери.'
    }
    case 'factRecorded':
      return isNonEmptyString(action.fact.text) ? null : 'Пустой факт.'
    case 'questUpdated':
      return isNonEmptyString(action.quest.title) && (QUEST_STATUSES as readonly string[]).includes(action.quest.status) ? null : 'Квест: нужно название и статус.'
    case 'journalWritten':
      return isNonEmptyString(action.entry.text) ? null : 'Пустая запись журнала.'
  }
}

/** Проверка итога истории. */
export function epilogueProblem(epilogue: { summary: string; outcome: string }): string | null {
  if (!isNonEmptyString(epilogue.summary)) return 'Краткое содержание не может быть пустым.'
  if (epilogue.summary.length > MAX_EPILOGUE_LENGTH) return `Краткое содержание — не длиннее ${MAX_EPILOGUE_LENGTH} символов.`
  if (!isNonEmptyString(epilogue.outcome)) return 'Напишите, чем всё кончилось.'
  if (epilogue.outcome.length > MAX_EPILOGUE_LENGTH) return `«Чем всё кончилось» — не длиннее ${MAX_EPILOGUE_LENGTH} символов.`
  return null
}

// ---------- Выборки ----------

/** Герой, за которого сейчас играет этот игрок: первый в отряде (пока игрок один). */
export function leadMember(state: StoryState): PartyMember {
  return state.party[0]
}

export function currentLocation(state: StoryState): LocationData {
  return state.world.locations[state.world.currentLocationId]
}

export function memberSheet(member: PartyMember): CharacterSheet {
  return { character: member.character, inventory: member.inventory }
}

/** Краткие сведения для списка историй. */
export function storyMeta(state: StoryState, actionCount: number): StoryMeta {
  return {
    id: state.id,
    title: state.title,
    tone: state.tone,
    status: state.status,
    adventureId: state.adventureId,
    createdAt: state.createdAt,
    lastPlayedAt: state.updatedAt,
    party: state.party.map((m) => ({ heroId: m.heroId, name: m.character.name, className: m.character.className, level: m.character.level })),
    locationName: currentLocation(state).name,
    actionCount,
  }
}

// ---------- Экипировка ----------

export type EquipmentChange = { kind: 'equip'; itemId: string; slot: EquipmentSlot } | { kind: 'unequip'; slot: EquipmentSlot }

/** Проверяет смену экипировки героя по правилам и возвращает событие или причину отказа. */
export function equipmentEvent(
  member: PartyMember,
  catalog: ItemCatalog,
  change: EquipmentChange,
): { ok: true; event: StoryEvent } | { ok: false; reason: string } {
  let equipped: Equipment
  if (change.kind === 'unequip') equipped = unequipSlot(member.inventory.equipped, change.slot)
  else {
    const result = equipItem(member.inventory, catalog, change.itemId, change.slot)
    if (!result.ok) return result
    equipped = result.equipped
  }
  return { ok: true, event: { type: 'equipmentChanged', heroId: member.heroId, equipped } }
}
