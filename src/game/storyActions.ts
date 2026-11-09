// Действия истории: создание, проверка по правилам и применение. Чистые функции.
//
// Состояние истории = применение её действий по порядку (replay). Применение детерминировано:
// всё случайное (id, броски кубиков, время) записано в самом действии. Поэтому журнал действий
// можно сохранить, воспроизвести и (в будущем) передавать между игроками по сети.

import { CONDITIONS, MAX_EXHAUSTION } from '../engine/conditions'
import { formatD20Test } from '../engine/checks'
import { areaTemplateProblem } from '../engine/areas'
import { isFloor } from '../engine/movement'
import type { CharacterSheet, Equipment } from '../types/character'
import type { ChatMessage } from '../types/game'
import type { ItemCatalog } from '../types/items'
import { EFFECT_KINDS, FLAT_OBJECT_TYPES, OBJECT_TYPES, type LocationData } from '../types/location'
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
import { placementProblem } from './mapPlacement'
import { heroBlocker, heroMovePlan } from './heroMove'
import { mergeMove } from './mapEvents'
import { mergeExplored } from './vision'
import { markChangeProblem, markPlaceProblem } from './marks'
import { createdLocationProblem } from './locationCreate'
import { exitAddedProblem, exitLinkedProblem, nextTrail, partyTraveledProblem, trailOf } from './travel'
import { factProblem, lostNames } from './facts'
import { rewritableMessageId, suggestionsProblem } from './masterSuggestions'
import { invocationShapeProblems, magicShapeProblems, migrateInventory } from './character'
import { invocationProblems, needsInvocationChoice } from './invocations'
import { languageProblems, needsLanguageChoice } from './languages'
import { masteryChangeProblem } from './weaponMastery'
import { needsOrderChoice, orderProblem } from './classOrder'
import { applyRestResult, featureResources, restRequestProblem, restResultProblem, restSummaryText } from './rest'
import { castProblem, emptyMagic, magicProblems, needsSpellChoice, preparedProblems, spendCast, type MagicRules } from './magic'
import { changeCoins, coinsFromCp, coinsValue, formatCoins, formatCp, gpToCp, isCoins } from './coins'
import { isNonEmptyString } from './validation'
import { applyNpcChanges, npcChangesProblem } from './npcs'
import { advanceProblem, gameTime, LONG_REST_MINUTES, SHORT_REST_MINUTES, type GameTime } from '../engine/time'

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
    time: gameTime(1, adventure.startHour ?? DEFAULT_START_HOUR),
  })
}

/** Час начала истории, если приключение его не задаёт. */
export const DEFAULT_START_HOUR = 8

/** Игровое время истории (у старых историй без поля — День 1, 8:00). */
export const storyTime = (state: Pick<StoryState, 'time'>): GameTime => state.time ?? gameTime(1, DEFAULT_START_HOUR)

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

const updateLocation = (state: StoryState, locationId: string, change: (l: LocationData) => LocationData): StoryState => {
  const location = state.world.locations[locationId]
  return { ...state, world: { ...state.world, locations: { ...state.world.locations, [locationId]: change(location) } } }
}

/** Старое состояние (золото числом) → кошельки монетами. */
export function migrateStory(state: StoryState): StoryState {
  return { ...state, party: state.party.map((m) => ({ ...m, inventory: migrateInventory(m.inventory) })) }
}

/** Применяет действие к состоянию. Действие должно быть проверено (checkAction) до записи в журнал. */
export function applyAction(state: StoryState | null, action: StoryAction): StoryState {
  // Начало истории из старого сохранения: золото числом → кошелёк монетами.
  if (action.type === 'storyCreated') return { ...migrateStory(structuredClone(action.seed)), updatedAt: action.at }
  if (!state) throw new Error(`Действие «${action.type}» до создания истории`)
  const next = applyEvent(state, action)
  return { ...next, updatedAt: action.at }
}

function applyEvent(state: StoryState, action: StoryAction): StoryState {
  switch (action.type) {
    case 'storyCreated':
      return migrateStory(structuredClone(action.seed))
    case 'storyRenamed':
      return { ...state, title: action.title }
    case 'storyCompleted':
      return { ...state, status: 'completed', ...(action.epilogue ? { epilogue: action.epilogue } : {}) }
    case 'epilogueEdited':
      return { ...state, epilogue: action.epilogue }
    case 'heroDied':
      return updateMember(state, action.heroId, (m) => ({ ...m, fallen: true, character: { ...m.character, hp: 0 } }))
    case 'playerSpoke': {
      const message: ChatMessage = {
        id: action.messageId,
        author: 'player',
        text: action.text,
        heroId: action.heroId,
        ...(action.ooc ? { ooc: true } : {}),
        ...(action.move ? { move: action.move } : {}),
      }
      const { outOfGame: _o, ...rest } = state
      // Перемещения ушли ведущему вместе с репликой.
      const next = action.move ? withoutPendingMove(rest, action.heroId) : rest
      return { ...next, ...(action.ooc ? { outOfGame: true } : {}), messages: [...state.messages, message] }
    }
    case 'heroMoveReported': {
      const message: ChatMessage = { id: action.messageId, author: 'system', text: action.text, heroId: action.heroId, mapEvent: { note: action.note } }
      return { ...withoutPendingMove(state, action.heroId), messages: [...state.messages, message] }
    }
    case 'masterNarrated': {
      const message: ChatMessage = { id: action.messageId, author: 'master', text: action.text, ...(action.ooc ? { ooc: true } : {}) }
      if (action.suggestions?.length) message.suggestions = action.suggestions
      return { ...state, messages: [...state.messages, message] }
    }
    case 'masterRewritten':
      return {
        ...state,
        messages: state.messages.map((m) => {
          if (m.id !== action.messageId) return m
          const { suggestions: _old, ...rest } = m
          return action.suggestions?.length ? { ...rest, text: action.text, suggestions: action.suggestions } : { ...rest, text: action.text }
        }),
      }
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
    case 'itemsRemoved':
      return updateMember(state, action.heroId, (m) => {
        let items = [...m.inventory.items]
        for (const { itemId, quantity } of action.items) {
          items = items.map((e) => (e.itemId === itemId ? { ...e, quantity: e.quantity - quantity } : e)).filter((e) => e.quantity > 0)
        }
        // Предмета не осталось — снимаем его с экипировки.
        const has = (id: string | null) => !id || items.some((e) => e.itemId === id)
        const eq = m.inventory.equipped
        const equipped = { mainHand: has(eq.mainHand) ? eq.mainHand : null, offHand: has(eq.offHand) ? eq.offHand : null, armor: has(eq.armor) ? eq.armor : null }
        return { ...m, inventory: { ...m.inventory, items, equipped } }
      })
    case 'goldChanged':
      // Старые журналы: золото числом — переводим в медные и меняем кошелёк со сдачей.
      return updateMember(state, action.heroId, (m) => {
        const purse = m.inventory.coins
        const coins = changeCoins(purse, gpToCp(action.delta)) ?? coinsFromCp(Math.max(0, coinsValue(purse) + gpToCp(action.delta)))
        return { ...m, inventory: { ...m.inventory, coins } }
      })
    case 'moneyChanged':
      return updateMember(state, action.heroId, (m) => ({ ...m, inventory: { ...m.inventory, coins: { ...action.coins } } }))
    case 'itemChargesUsed':
      return updateMember(state, action.heroId, (m) => {
        const max = action.perItem
        const entry = m.inventory.items.find((e) => e.itemId === action.itemId)
        if (!entry || !max) return m
        const left = (entry.quantity - 1) * max + (entry.charges ?? max) - action.uses
        const quantity = Math.max(0, Math.ceil(left / max))
        const charges = left % max === 0 ? max : left % max
        const items = m.inventory.items
          .map((e) => (e.itemId !== action.itemId ? e : charges === max ? { itemId: e.itemId, quantity } : { itemId: e.itemId, quantity, charges }))
          .filter((e) => e.quantity > 0)
        const has = (id: string | null) => !id || items.some((e) => e.itemId === id)
        const eq = m.inventory.equipped
        const equipped = { mainHand: has(eq.mainHand) ? eq.mainHand : null, offHand: has(eq.offHand) ? eq.offHand : null, armor: has(eq.armor) ? eq.armor : null }
        return { ...m, inventory: { ...m.inventory, items, equipped } }
      })
    case 'classOrderChosen':
      return updateMember(state, action.heroId, (m) => {
        const armor = [...new Set([...m.character.proficiencies.armor, ...action.armor])]
        return { ...m, character: { ...m.character, classOrder: action.order, proficiencies: { ...m.character.proficiencies, armor } } }
      })
    case 'spellsChosen':
      return updateMember(state, action.heroId, (m) => ({ ...m, character: { ...m.character, magic: structuredClone(action.magic) } }))
    case 'weaponMasteriesChosen':
      return updateMember(state, action.heroId, (m) => {
        const { masterySwapReady: _r, ...character } = m.character
        return { ...m, character: { ...character, weaponMasteries: [...action.weapons] } }
      })
    case 'languagesChosen':
      return updateMember(state, action.heroId, (m) => ({ ...m, character: { ...m.character, languages: [...action.languages] } }))
    case 'invocationsChosen':
      return updateMember(state, action.heroId, (m) => ({ ...m, character: { ...m.character, invocations: structuredClone(action.invocations) } }))
    case 'preparedSpellsChanged':
      return updateMember(state, action.heroId, (m) => ({
        ...m,
        character: { ...m.character, magic: { ...(m.character.magic ?? emptyMagic()), prepared: [...action.prepared] } },
      }))
    case 'spellCast':
      return updateMember(state, action.heroId, (m) => ({ ...m, character: { ...m.character, magic: spendCast(m.character.magic, action) } }))
    case 'restRequested': {
      // Просьба об отдыхе — действие героя в игре: вопрос вне игры закончен.
      const { outOfGame: _o, ...rest } = state
      return { ...rest, pendingRest: { kind: action.kind, hitDice: { ...action.hitDice }, requestedAt: action.at } }
    }
    case 'restInterrupted': {
      const { pendingRest: _p, ...rest } = state
      return { ...rest, messages: [...state.messages, { id: action.messageId, author: 'system', text: `Отдых прерван: ${action.reason}` }] }
    }
    case 'restCompleted': {
      const { pendingRest: _p, ...rest } = state
      const party = state.party.map((m) => {
        const r = action.heroes.find((h) => h.heroId === m.heroId)
        return r ? { ...m, character: applyRestResult(m.character, r) } : m
      })
      // Отдых занимает время: короткий — 1 час, долгий — 8 часов.
      const time = storyTime(state) + (action.kind === 'long' ? LONG_REST_MINUTES : SHORT_REST_MINUTES)
      return {
        ...rest,
        party,
        time,
        ...(action.kind === 'long' ? { lastLongRestAt: time } : {}),
        messages: [...state.messages, { id: action.messageId, author: 'system', text: restSummaryText(action.kind) }],
      }
    }
    case 'timeAdvanced':
      return { ...state, time: storyTime(state) + action.minutes }
    case 'featureUsed':
      return updateMember(state, action.heroId, (m) => ({
        ...m,
        character: { ...m.character, featureUses: { ...m.character.featureUses, [action.featureId]: (m.character.featureUses?.[action.featureId] ?? 0) + (action.amount ?? 1) } },
      }))
    case 'turnSummarized': {
      const text = `Изменения: ${action.changes.map((c) => c.text).join(', ')}`
      return { ...state, messages: [...state.messages, { id: action.messageId, author: 'system', text, changes: action.changes }] }
    }
    case 'hpChanged':
      return updateMember(state, action.heroId, (m) => {
        const c = m.character
        const hp = action.kind === 'damage' ? Math.max(0, c.hp - action.amount) : Math.min(c.maxHp, c.hp + action.amount)
        return { ...m, character: { ...c, hp } }
      })
    case 'checkRolled': {
      // Скрытая проверка: ни карточки в ленте, ни броска в журнале бросков игрока — только журнал действий.
      if (action.check.hidden) return state
      const message: ChatMessage = { id: action.messageId, author: 'system', text: formatD20Test(action.check.result), check: action.check }
      return { ...state, messages: [...state.messages, message], rolls: action.roll ? [...state.rolls, action.roll].slice(-MAX_ROLL_LOG) : state.rolls }
    }
    case 'npcAdded':
      return updateLocation(state, action.locationId, (l) => ({ ...l, npcs: [...l.npcs, action.npc] }))
    case 'npcRemoved':
      return updateLocation(state, action.locationId, (l) => ({ ...l, npcs: l.npcs.filter((n) => n.id !== action.npcId) }))
    case 'objectAdded':
      return updateLocation(state, action.locationId, (l) => ({ ...l, objects: [...l.objects, action.object] }))
    case 'objectRemoved':
      return updateLocation(state, action.locationId, (l) => ({ ...l, objects: l.objects.filter((o) => o.id !== action.objectId) }))
    case 'objectUpdated':
      return updateLocation(state, action.locationId, (l) => ({
        ...l,
        objects: l.objects.map((o) => (o.id === action.objectId ? { ...o, ...action.changes, id: o.id } : o)),
      }))
    case 'npcUpdated':
      return updateLocation(state, action.locationId, (l) => ({ ...l, npcs: l.npcs.map((n) => (n.id === action.npcId ? applyNpcChanges(n, action.changes) : n)) }))
    case 'heroMoved': {
      // Мелкие перемещения подряд склеиваются (src/game/mapEvents.ts) — уйдут ведущему со следующей репликой.
      const location = currentLocation(state)
      const move = mergeMove(state, location, action.heroId, action.to)
      let moved = updateMember(state, action.heroId, (m) => ({ ...m, position: { x: action.to.x, y: action.to.y } }))
      // Перемещение по просьбе ведущего (move_hero) он и так знает — копятся только шаги игрока.
      if (move && action.author.kind === 'player') moved = { ...moved, pendingMoves: { ...state.pendingMoves, [action.heroId]: move } }
      // В бою шаги тратят скорость героя (перемещение по сюжету — нет).
      if (state.combat && !action.forced) {
        const feet = heroMovePlan(location, state, action.heroId, action.to, { ignoreBudget: true })
        const spent = typeof feet === 'string' ? 0 : feet.feet
        moved = { ...moved, combat: { ...state.combat, moved: { ...state.combat.moved, [action.heroId]: (state.combat.moved[action.heroId] ?? 0) + spent } } }
      }
      if (action.notice) moved = { ...moved, messages: [...moved.messages, { id: `${action.id}-note`, author: 'system', text: action.notice, heroId: action.heroId, mapNote: true }] }
      return moved
    }
    case 'combatChanged': {
      const { combat: _c, ...rest } = state
      return action.combat ? { ...rest, combat: action.combat } : rest
    }
    case 'effectAdded':
      return updateLocation(state, action.locationId, (l) => ({ ...l, effects: [...(l.effects ?? []), action.effect] }))
    case 'effectRemoved':
      return updateLocation(state, action.locationId, (l) => ({ ...l, effects: (l.effects ?? []).filter((e) => e.id !== action.effectId) }))
    case 'mapPinged':
      return { ...state, ping: action.ping }
    case 'areaShown':
      return { ...state, shownArea: action.area }
    case 'areaExplored': {
      const location = state.world.locations[action.locationId]
      const bits = mergeExplored(state.world.explored?.[action.locationId], location.width * location.height, action.cells)
      return { ...state, world: { ...state.world, explored: { ...state.world.explored, [action.locationId]: bits } } }
    }
    case 'locationCreated':
      return { ...state, world: { ...state.world, locations: { ...state.world.locations, [action.location.id]: structuredClone(action.location) } } }
    case 'exitAdded':
      return updateLocation(state, action.locationId, (l) => ({ ...l, exits: [...(l.exits ?? []), action.exit] }))
    case 'exitLinked':
      return updateLocation(state, action.locationId, (l) => ({
        ...l,
        exits: (l.exits ?? []).map((e) => {
          if (e.id !== action.exitId) return e
          const { toExit: _t, ...rest } = e
          return { ...rest, to: action.to, ...(action.toExit ? { toExit: action.toExit } : {}) }
        }),
      }))
    case 'partyTraveled': {
      // Новая карта: текущая локация, герои у входа, путь отряда; перемещения по старой карте уже не рассказать.
      const { pendingMoves: _p, ...rest } = state
      return {
        ...rest,
        party: state.party.map((m) => (action.positions[m.heroId] ? { ...m, position: { ...action.positions[m.heroId] } } : m)),
        world: { ...state.world, currentLocationId: action.to, trail: nextTrail(trailOf(state), action.to) },
      }
    }
    case 'markPlaced':
      return { ...state, world: { ...state.world, marks: [...(state.world.marks ?? []), action.mark] } }
    case 'markEdited':
      return {
        ...state,
        world: { ...state.world, marks: (state.world.marks ?? []).map((m) => (m.id === action.markId ? { ...m, icon: action.icon, text: action.text, at: action.at } : m)) },
      }
    case 'markRemoved':
      return { ...state, world: { ...state.world, marks: (state.world.marks ?? []).filter((m) => m.id !== action.markId) } }
    case 'entityRevealed':
      return updateLocation(state, action.locationId, (l) =>
        action.kind === 'npc'
          ? { ...l, npcs: l.npcs.map((n) => (n.id === action.entityId ? withoutHidden(n) : n)) }
          : { ...l, objects: l.objects.map((o) => (o.id === action.entityId ? withoutHidden(o) : o)) },
      )
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
    case 'factUpdated': {
      const facts = state.world.facts.map((f) => (f.id === action.factId ? { ...f, text: action.text, at: action.at } : f))
      return { ...state, world: { ...state.world, facts } }
    }
    case 'factsMerged':
      return { ...state, world: { ...state.world, facts: action.facts } }
    case 'memoryCompacted':
      return {
        ...state,
        memory: { summary: action.summary, covered: action.covered, compactions: (state.memory?.compactions ?? 0) + 1, updatedAt: action.at },
      }
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
  /** Правила (классы, виды, заклинания) — для событий заклинаний, отдыха и умений; нет — такие события отклоняются. */
  rules?: MagicRules
}

/**
 * Проверяет действие по правилам и текущему состоянию истории. Возвращает причину отказа или null.
 * Так проверяются и действия игрока, и предложения ведущего, и (в будущем) действия, пришедшие по сети.
 */
/** Что ведущий и движок могут записать во время вопроса вне игры: только ответ (и его переписывание). */
/** Описание перемещений для ведущего — не длиннее (символов). */
export const MAX_MOVE_TEXT = 1500

/** Без пометки «скрыт» (раскрыт). */
function withoutHidden<T extends { hidden?: boolean }>(value: T): T {
  const { hidden: _h, ...rest } = value
  return rest as T
}

/** Убрать накопленное перемещение героя (рассказано ведущему). */
function withoutPendingMove<T extends Pick<StoryState, 'pendingMoves'>>(state: T, heroId: string): T {
  if (!state.pendingMoves?.[heroId]) return state
  const { [heroId]: _done, ...rest } = state.pendingMoves
  const { pendingMoves: _all, ...base } = state
  return (Object.keys(rest).length ? { ...base, pendingMoves: rest } : base) as T
}

const OUT_OF_GAME_ALLOWED = new Set<StoryEvent['type']>(['masterNarrated', 'masterRewritten'])
export const OUT_OF_GAME_REFUSAL =
  'Сейчас вопрос вне игры: игра не меняется — ни время, ни отдых, ни броски, ни предметы. Просто ответь игроку как мастер.'

export function checkAction(state: StoryState | null, action: StoryAction, { catalog, rules }: ActionContext): string | null {
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
  // Вопрос вне игры — не ход: ведущий и движок не меняют игру (время, отдых, броски, предметы…), только отвечают.
  if (state.outOfGame && (action.author.kind === 'master' || action.author.kind === 'engine') && !OUT_OF_GAME_ALLOWED.has(action.type))
    return OUT_OF_GAME_REFUSAL

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
      if (action.move !== undefined && (!isNonEmptyString(action.move) || action.move.length > MAX_MOVE_TEXT)) return 'Описание перемещения пустое или слишком длинное.'
      return isNonEmptyString(action.text) ? null : 'Пустая реплика.'
    case 'heroMoveReported':
      if (action.author.kind !== 'engine') return 'О перемещениях героя ведущему сообщает движок.'
      if (!member(action.heroId)) return 'Этого героя нет в отряде истории.'
      if (!isNonEmptyString(action.text) || !isNonEmptyString(action.note) || action.note.length > MAX_MOVE_TEXT) return 'Пустое или слишком длинное событие карты.'
      return null
    case 'masterNarrated':
      if (Boolean(action.ooc) !== Boolean(state.outOfGame))
        return action.ooc ? 'Ответ вне игры — только на вопрос игрока вне игры.' : 'Сейчас вопрос вне игры — ответ ведущего тоже вне игры.'
      if (action.ooc && action.suggestions?.length) return 'У ответа вне игры нет подсказок действий.'
      return isNonEmptyString(action.text) ? suggestionsProblem(action.suggestions) : 'Пустой текст ведущего.'
    case 'masterRewritten': {
      if (action.author.kind !== 'master') return 'Переписать ответ ведущего может только ведущий.'
      if (rewritableMessageId(state.messages) !== action.messageId)
        return 'Переписать можно только последний ответ ведущего.'
      return isNonEmptyString(action.text) ? suggestionsProblem(action.suggestions) : 'Пустой текст ведущего.'
    }
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
    case 'itemsRemoved': {
      const hero = member(action.heroId)
      if (!hero) return 'Этого героя нет в отряде истории.'
      const need = new Map<string, number>()
      for (const e of action.items) {
        if (!Number.isInteger(e.quantity) || e.quantity < 1) return `Нельзя забрать «${e.itemId}» × ${e.quantity}.`
        need.set(e.itemId, (need.get(e.itemId) ?? 0) + e.quantity)
      }
      for (const [itemId, quantity] of need) {
        const have = hero.inventory.items.find((e) => e.itemId === itemId)?.quantity ?? 0
        const name = catalog[itemId]?.name ?? itemId
        if (have < quantity) return have === 0 ? `У героя нет предмета «${name}».` : `У героя только ${have} шт. «${name}», а забрать нужно ${quantity}.`
      }
      return null
    }
    case 'moneyChanged': {
      const hero = member(action.heroId)
      if (!hero) return 'Этого героя нет в отряде истории.'
      if (!Number.isInteger(action.delta) || action.delta === 0) return 'Изменение денег — ненулевое целое число медных.'
      const have = coinsValue(hero.inventory.coins)
      if (have + action.delta < 0) return `Денег не хватает: в кошельке ${formatCoins(hero.inventory.coins)}, а нужно ${formatCp(action.delta)}.`
      if (!isCoins(action.coins) || coinsValue(action.coins) !== have + action.delta) return 'Кошелёк после оплаты не сходится с суммой.'
      return null
    }
    case 'itemChargesUsed': {
      const hero = member(action.heroId)
      if (!hero) return 'Этого героя нет в отряде истории.'
      const max = catalog[action.itemId]?.use?.charges
      const name = catalog[action.itemId]?.name ?? action.itemId
      if (!max) return `У «${name}» нет применений.`
      if (action.perItem !== max) return `У «${name}» ${max} применений, а не ${action.perItem}.`
      if (!Number.isInteger(action.uses) || action.uses < 1) return 'Применений — положительное целое.'
      const entry = hero.inventory.items.find((e) => e.itemId === action.itemId)
      if (!entry) return `У героя нет предмета «${name}».`
      const left = (entry.quantity - 1) * max + (entry.charges ?? max)
      return left < action.uses ? `У «${name}» осталось применений: ${left}, а нужно ${action.uses}.` : null
    }
    case 'classOrderChosen': {
      const hero = member(action.heroId)
      if (!hero) return 'Этого героя нет в отряде истории.'
      if (!rules) return 'Нет данных правил.'
      if (action.author.kind !== 'player' && action.author.kind !== 'system') return 'Порядок выбирает игрок.'
      if (!needsOrderChoice(hero.character, rules)) return 'Порядок уже выбран.'
      const problem = orderProblem(hero.character.classId, action.order, rules)
      if (problem) return problem
      const option = rules.classes[hero.character.classId]?.order?.options.find((o) => o.id === action.order)
      const expected = [...(option?.armor ?? [])].sort().join()
      return [...(action.armor ?? [])].sort().join() === expected ? null : 'Владение доспехами не совпадает с выбранным порядком.'
    }
    case 'spellsChosen': {
      const hero = member(action.heroId)
      if (!hero) return 'Этого героя нет в отряде истории.'
      if (!rules) return 'Нет данных правил магии.'
      if (action.author.kind !== 'player' && action.author.kind !== 'system') return 'Заклинания выбирает игрок.'
      if (!needsSpellChoice(hero.character, rules)) return 'Заклинания этого героя уже выбраны.'
      const shape = magicShapeProblems(action.magic)
      if (shape.length) return `Некорректная магия: ${shape[0]}.`
      return magicProblems(hero.character, action.magic, rules)[0] ?? null
    }
    case 'weaponMasteriesChosen': {
      const hero = member(action.heroId)
      if (!hero) return 'Этого героя нет в отряде истории.'
      if (!rules) return 'Нет данных правил.'
      if (action.author.kind !== 'player' && action.author.kind !== 'system') return 'Приёмы оружия выбирает игрок.'
      if (!Array.isArray(action.weapons) || !action.weapons.every((id) => typeof id === 'string')) return 'Приёмы оружия — список видов оружия.'
      return masteryChangeProblem(hero.character, action.weapons, rules)
    }
    case 'languagesChosen': {
      const hero = member(action.heroId)
      if (!hero) return 'Этого героя нет в отряде истории.'
      if (!rules) return 'Нет данных правил.'
      if (action.author.kind !== 'player' && action.author.kind !== 'system') return 'Языки выбирает игрок.'
      if (!needsLanguageChoice(hero.character, rules)) return 'Языки этого героя уже выбраны.'
      if (!Array.isArray(action.languages) || !action.languages.every((id) => typeof id === 'string')) return 'Языки — список.'
      return languageProblems(hero.character.classId, action.languages, rules)[0] ?? null
    }
    case 'invocationsChosen': {
      const hero = member(action.heroId)
      if (!hero) return 'Этого героя нет в отряде истории.'
      if (!rules) return 'Нет данных правил.'
      if (action.author.kind !== 'player' && action.author.kind !== 'system') return 'Воззвания выбирает игрок.'
      if (!needsInvocationChoice(hero.character, rules)) return 'Воззвания этого героя уже выбраны.'
      const shape = invocationShapeProblems(action.invocations)
      if (shape.length) return `Некорректные воззвания: ${shape[0]}.`
      return invocationProblems(hero.character, action.invocations, rules)[0] ?? null
    }
    case 'preparedSpellsChanged': {
      const hero = member(action.heroId)
      if (!hero) return 'Этого героя нет в отряде истории.'
      if (!rules) return 'Нет данных правил магии.'
      if (action.author.kind !== 'player') return 'Подготовленные заклинания меняет игрок.'
      const c = hero.character
      if (!c.magic) return 'Сначала выберите заклинания.'
      if (!Array.isArray(action.prepared) || !action.prepared.every((id) => typeof id === 'string')) return 'Подготовленные — список заклинаний.'
      return preparedProblems(c.classId, c.level, action.prepared, rules, c.magic.spellbook)[0] ?? null
    }
    case 'spellCast': {
      const hero = member(action.heroId)
      if (!hero) return 'Этого героя нет в отряде истории.'
      if (!rules) return 'Нет данных правил магии.'
      if (hero.fallen) return 'Герой погиб.'
      return castProblem({ ...hero.character }, action, rules)
    }
    case 'restRequested':
      if (action.author.kind !== 'player') return 'Отдых просит игрок.'
      if (!rules) return 'Нет данных правил.'
      return restRequestProblem(state, action.kind, action.hitDice ?? {}, rules)
    case 'timeAdvanced':
      if (action.author.kind !== 'master' && action.author.kind !== 'engine' && action.author.kind !== 'system') return 'Время двигает ведущий или движок.'
      return advanceProblem(action.minutes) ?? (isNonEmptyString(action.reason) ? null : 'Нужна причина, почему прошло время.')
    case 'restInterrupted':
      if (action.author.kind !== 'master' && action.author.kind !== 'system') return 'Прервать отдых может ведущий.'
      if (!state.pendingRest) return 'Сейчас никто не отдыхает.'
      return isNonEmptyString(action.reason) ? null : 'Нужна причина, почему отдых прерван.'
    case 'restCompleted': {
      if (action.author.kind !== 'engine') return 'Итог отдыха считает движок.'
      if (!rules) return 'Нет данных правил.'
      if (action.kind !== 'short' && action.kind !== 'long') return 'Отдых — короткий или долгий.'
      if (state.pendingRest && state.pendingRest.kind !== action.kind) return 'Вид отдыха не совпадает с начатым.'
      if (!Array.isArray(action.heroes) || action.heroes.length === 0) return 'Отдыхать некому.'
      for (const r of action.heroes) {
        const hero = member(r.heroId)
        if (!hero) return 'Этого героя нет в отряде истории.'
        const problem = restResultProblem(hero, action.kind, r, rules)
        if (problem) return problem
      }
      return null
    }
    case 'featureUsed': {
      const hero = member(action.heroId)
      if (!hero) return 'Этого героя нет в отряде истории.'
      if (!rules) return 'Нет данных правил.'
      if (hero.fallen) return 'Герой погиб.'
      const r = featureResources(hero.character, rules).find((x) => x.resource.id === action.featureId)
      if (!r) return `У ${hero.character.name} нет умения «${action.featureId}».`
      const amount = action.amount ?? 1
      if (!Number.isInteger(amount) || amount < 1) return 'Сколько потратить — целое не меньше 1.'
      if (amount > 1 && !r.resource.pool) return `«${r.resource.name}» тратится по одному применению.`
      return r.left >= amount ? null : r.left > 0 ? `В запасе «${r.resource.name}» осталось ${r.left}.` : `«${r.resource.name}» уже потрачено — восстанавливается отдыхом.`
    }
    case 'turnSummarized':
      if (action.author.kind !== 'engine') return 'Итог хода записывает движок.'
      if (!Array.isArray(action.changes) || action.changes.length === 0) return 'Пустой итог хода.'
      return action.changes.every((c) => isNonEmptyString(c.text) && (c.tone === 'gain' || c.tone === 'loss')) ? null : 'Некорректная строка изменений.'
    case 'goldChanged': {
      const hero = member(action.heroId)
      if (!hero) return 'Этого героя нет в отряде истории.'
      if (!Number.isFinite(action.delta) || action.delta === 0) return 'Изменение золота — ненулевое число.'
      if (coinsValue(hero.inventory.coins) + gpToCp(action.delta) < 0) return `У героя только ${formatCoins(hero.inventory.coins)} — нельзя забрать ${-action.delta} зм.`
      return null
    }
    case 'hpChanged': {
      const hero = member(action.heroId)
      if (!hero) return 'Этого героя нет в отряде истории.'
      if (hero.fallen) return 'Герой погиб.'
      if (!Number.isInteger(action.amount) || action.amount < 1) return 'Урон и лечение — целое число не меньше 1.'
      return null
    }
    case 'checkRolled':
      if (action.author.kind !== 'engine') return 'Кубики бросает только движок.'
      return needMember(action.check.heroId)
    case 'npcRemoved': {
      const location = state.world.locations[action.locationId]
      if (!location) return 'В мире этой истории нет такой локации.'
      return location.npcs.some((n) => n.id === action.npcId) ? null : 'В этой локации нет такого НПС.'
    }
    case 'objectAdded': {
      const location = state.world.locations[action.locationId]
      if (!location) return 'В мире этой истории нет такой локации.'
      const o = action.object
      if (!isNonEmptyString(o.id) || !isNonEmptyString(o.name)) return 'У объекта нужны id и название.'
      if (!(OBJECT_TYPES as readonly string[]).includes(o.type)) return `Неизвестный вид объекта «${o.type}».`
      if (location.objects.some((x) => x.id === o.id)) return `Объект с id «${o.id}» уже есть.`
      return placementProblem(location, [], o, { flat: FLAT_OBJECT_TYPES.includes(o.type) })
    }
    case 'objectRemoved': {
      const location = state.world.locations[action.locationId]
      if (!location) return 'В мире этой истории нет такой локации.'
      return location.objects.some((o) => o.id === action.objectId) ? null : 'В этой локации нет такого объекта.'
    }
    case 'objectUpdated': {
      const location = state.world.locations[action.locationId]
      if (!location) return 'В мире этой истории нет такой локации.'
      const o = location.objects.find((x) => x.id === action.objectId)
      if (!o) return 'В этой локации нет такого объекта.'
      const next = { ...o, ...action.changes }
      if (!isNonEmptyString(next.name)) return 'У объекта нужно название.'
      if (!(OBJECT_TYPES as readonly string[]).includes(next.type)) return `Неизвестный вид объекта «${next.type}».`
      return placementProblem(location, [], next, { objectId: o.id, flat: FLAT_OBJECT_TYPES.includes(next.type) })
    }
    case 'npcUpdated': {
      const location = state.world.locations[action.locationId]
      if (!location) return 'В мире этой истории нет такой локации.'
      if (!location.npcs.some((n) => n.id === action.npcId)) return 'В этой локации нет такого НПС.'
      return npcChangesProblem(action.changes)
    }
    case 'npcAdded': {
      const location = state.world.locations[action.locationId]
      if (!location) return 'В мире этой истории нет такой локации.'
      const personality = npcChangesProblem(action.npc)
      if (personality) return personality
      if (!isNonEmptyString(action.npc.id) || !isNonEmptyString(action.npc.name)) return 'У НПС нужны id и имя.'
      if (location.npcs.some((n) => n.id === action.npc.id)) return `НПС с id «${action.npc.id}» уже есть.`
      return isFloor(location, action.npc.x, action.npc.y) ? null : 'НПС может стоять только на полу.'
    }
    case 'heroMoved': {
      // Героя двигает его игрок (или движок — move_hero ведущего); путь — по правилам карты.
      if (action.author.kind === 'master') return 'Героя передвигает игрок или движок, а не ведущий напрямую (инструмент move_hero).'
      if (action.author.kind === 'player' && action.author.heroId !== action.heroId) return 'Игрок двигает только своего героя.'
      if (action.notice !== undefined && (!isNonEmptyString(action.notice) || action.notice.length > MAX_MOVE_TEXT)) return 'Пустая или слишком длинная строка о перемещении.'
      if (action.forced !== undefined) {
        // По сюжету («отбросило») — без пути и скорости, но только на свободный пол и только движком.
        if (action.author.kind !== 'engine') return 'Перемещение по сюжету делает только движок.'
        if (!isNonEmptyString(action.forced)) return 'У перемещения по сюжету нужна причина.'
        const location = currentLocation(state)
        const { x, y } = action.to
        if (!Number.isInteger(x) || !Number.isInteger(y) || !isFloor(location, x, y)) return 'Туда не встать: там нет пола.'
        const occupant = heroBlocker(location, state, action.heroId)(action.to)
        return occupant ? `Клетка занята: ${occupant}.` : needMember(action.heroId)
      }
      const plan = heroMovePlan(currentLocation(state), state, action.heroId, action.to)
      return typeof plan === 'string' ? plan : null
    }
    case 'combatChanged': {
      if (action.author.kind === 'player') return 'Бой начинает и ведёт ведущий.'
      const c = action.combat
      if (!c) return state.combat ? null : 'Боя и так нет.'
      if (!Number.isInteger(c.round) || c.round < 1) return 'Раунд — целое от 1.'
      const bad = Object.values({ ...c.speed, ...c.moved }).some((v) => !Number.isInteger(v) || v < 0)
      return bad ? 'Скорость и пройденное — целые футы не меньше 0.' : null
    }
    case 'effectAdded': {
      const location = state.world.locations[action.locationId]
      if (!location) return 'В мире этой истории нет такой локации.'
      const e = action.effect
      if (!isNonEmptyString(e.id) || (location.effects ?? []).some((x) => x.id === e.id)) return 'У эффекта нужен новый id.'
      if (!EFFECT_KINDS.includes(e.kind)) return `Вид эффекта — один из: ${EFFECT_KINDS.join(', ')}.`
      if (![e.x, e.y, e.w, e.h].every(Number.isInteger) || e.w < 1 || e.h < 1 || e.x < 0 || e.y < 0 || e.x + e.w > location.width || e.y + e.h > location.height)
        return `Область эффекта выходит за карту ${location.width}×${location.height}.`
      return null
    }
    case 'effectRemoved': {
      const location = state.world.locations[action.locationId]
      if (!location) return 'В мире этой истории нет такой локации.'
      return (location.effects ?? []).some((e) => e.id === action.effectId) ? null : 'Такого эффекта на карте нет.'
    }
    case 'mapPinged': {
      const p = action.ping
      const location = state.world.locations[p.locationId]
      if (!location) return 'В мире этой истории нет такой локации.'
      if (![p.x, p.y, p.w, p.h].every((v) => typeof v === 'number' && Number.isFinite(v)) || p.w <= 0 || p.h <= 0) return 'Неверная область подсветки.'
      return p.x < 0 || p.y < 0 || p.x + p.w > location.width + 0.5 || p.y + p.h > location.height + 0.5 ? 'Подсветка за пределами карты.' : null
    }
    case 'areaShown': {
      const a = action.area
      const location = state.world.locations[a.locationId]
      if (!location) return 'В мире этой истории нет такой локации.'
      if (a.label !== undefined && (typeof a.label !== 'string' || a.label.length > 40)) return 'Подпись области — до 40 символов.'
      if (!a.template || typeof a.template !== 'object') return 'Нет шаблона области.'
      return areaTemplateProblem(a.template, location)
    }
    case 'areaExplored': {
      if (action.author.kind === 'master') return 'Исследованное отмечает игра, а не ведущий.'
      const location = state.world.locations[action.locationId]
      if (!location) return 'В мире этой истории нет такой локации.'
      const size = location.width * location.height
      return action.cells.length > 0 && action.cells.every((i) => Number.isInteger(i) && i >= 0 && i < size) ? null : 'Клетки за пределами карты.'
    }
    case 'exitAdded':
      if (action.author.kind !== 'master') return 'Выходы на карту добавляет ведущий.'
      return exitAddedProblem(state, action)
    case 'exitLinked':
      if (action.author.kind !== 'engine') return 'Выходы связывает движок при переходе.'
      return exitLinkedProblem(state, action)
    case 'partyTraveled':
      if (action.author.kind !== 'engine') return 'Отряд переводит на другую карту движок (инструмент travel или выход на карте).'
      return partyTraveledProblem(state, action)
    case 'locationCreated':
      // Локации создаёт ведущий (create_location) или движок (каркас окрестностей здания при выходе наружу).
      if (action.author.kind !== 'master' && action.author.kind !== 'engine') return 'Новые локации создаёт ведущий.'
      return createdLocationProblem(state, action.location)
    // Метки — заметки игрока: ставит, правит и убирает только он (ведущий на них лишь откликается).
    case 'markPlaced':
      if (action.author.kind !== 'player') return 'Метки на карте ставит игрок.'
      return markPlaceProblem(state, action.mark, action.author.heroId)
    case 'markEdited':
      if (action.author.kind !== 'player') return 'Метки на карте правит игрок.'
      return markChangeProblem(state, action.markId, action.author.heroId, { icon: action.icon, text: action.text })
    case 'markRemoved':
      if (action.author.kind !== 'player') return 'Метки на карте убирает игрок.'
      return markChangeProblem(state, action.markId, action.author.heroId)
    case 'entityRevealed': {
      const location = state.world.locations[action.locationId]
      if (!location) return 'В мире этой истории нет такой локации.'
      const target = action.kind === 'npc' ? location.npcs.find((n) => n.id === action.entityId) : location.objects.find((o) => o.id === action.entityId)
      if (!target) return action.kind === 'npc' ? 'В этой локации нет такого НПС.' : 'В этой локации нет такого объекта.'
      return target.hidden ? null : `«${target.name}» и так на виду.`
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
      return factProblem(action.fact.text)
    case 'questUpdated':
      return isNonEmptyString(action.quest.title) && (QUEST_STATUSES as readonly string[]).includes(action.quest.status) ? null : 'Квест: нужно название и статус.'
    case 'journalWritten':
      return isNonEmptyString(action.entry.text) ? null : 'Пустая запись журнала.'
    case 'factUpdated':
      if (!state.world.facts.some((f) => f.id === action.factId)) return 'Такого факта нет в журнале.'
      return factProblem(action.text)
    case 'factsMerged': {
      if (action.author.kind !== 'master') return 'Объединяет факты только ведущий.'
      if (action.facts.length === 0 && state.world.facts.length > 0) return 'Нельзя стереть весь журнал фактов.'
      if (new Set(action.facts.map((f) => f.id)).size !== action.facts.length) return 'Повторяются id фактов.'
      for (const f of action.facts) {
        const problem = factProblem(f.text)
        if (problem) return problem
      }
      const lost = lostNames(
        state.world.facts.map((f) => f.text),
        action.facts.map((f) => f.text),
      )
      return lost.length ? `При объединении потеряны имена: ${lost.join(', ')}.` : null
    }
    case 'memoryCompacted': {
      if (action.author.kind !== 'master') return 'Сжимает память только ведущий.'
      const from = state.memory?.covered ?? 0
      if (!Number.isInteger(action.covered) || action.covered < from || action.covered > state.messages.length)
        return 'Сводка должна охватывать начало ленты и не больше, чем в ней есть.'
      if (!isNonEmptyString(action.summary)) return 'Пустая сводка.'
      return action.summary.length > MAX_SUMMARY_CHARS ? `Сводка — не длиннее ${MAX_SUMMARY_CHARS} символов.` : null
    }
  }
}

/** Жёсткий предел длины сводки «Что было раньше» (сжатие держит её заметно короче — см. memory.ts). */
export const MAX_SUMMARY_CHARS = 8_000

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
