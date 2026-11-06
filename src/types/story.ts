// История (кампания) — всё, что принадлежит одной игре: отряд, мир, журнал, лог сообщений и бросков.
// Состояние истории не меняют напрямую: оно получается применением действий (StoryAction) по порядку
// (src/game/storyActions.ts). Журнал действий хранится вместе с историей (src/game/repository.ts).

import type { ActiveCondition } from '../engine/conditions'
import type { Character, Equipment, Inventory } from './character'
import type { Coins } from '../game/coins'
import type { CharacterMagic } from './spells'
import type { ArmorType } from './items'
import type { ChatMessage, CheckCard, RollRecord, TurnChange } from './game'
import type { CellPosition, DoorState, LocationData, MapObject, Npc } from './location'

export const STORY_TONES = ['dark-fantasy', 'light-adventure', 'detective', 'horror'] as const
/** Тон истории — попадёт в системный промт ведущего. */
export type StoryTone = (typeof STORY_TONES)[number]

/** Герой в отряде: его состояние в этой истории (лист, инвентарь, место на карте). */
export interface PartyMember {
  /** id героя из «Моих героев» (совпадает с character.id). */
  heroId: string
  character: Character
  inventory: Inventory
  position: CellPosition
  /** Уровень героя в начале истории (нет — история создана до появления поля). */
  startLevel?: number
  /** Герой погиб в этой истории. */
  fallen?: boolean
}

/** Находка: что и кому досталось в истории. */
export interface StoryFind {
  heroId: string
  itemId: string
  quantity: number
  at: number
}

/** Итог завершённой истории (черновик собирает код, игрок может его поправить). */
export interface StoryEpilogue {
  /** Краткое содержание, 3–6 предложений. */
  summary: string
  /** Чем всё кончилось. */
  outcome: string
  /** Когда история завершена. */
  endedAt: number
}

/** Факт о мире, который установлен в этой истории. */
export interface WorldFact {
  id: string
  text: string
  at: number
}

export const QUEST_STATUSES = ['active', 'completed', 'failed'] as const
export type QuestStatus = (typeof QUEST_STATUSES)[number]

export interface Quest {
  id: string
  title: string
  status: QuestStatus
  notes: string
}

/** Запись журнала приключения. */
export interface JournalEntry {
  id: string
  at: number
  text: string
}

/** Мир истории. Локации — собственные копии истории: НПС в них двигаются только в этой истории. */
export interface World {
  locations: Record<string, LocationData>
  currentLocationId: string
  /** Состояния дверей: id локации → id двери → состояние. */
  doors: Record<string, Record<string, DoorState>>
  facts: WorldFact[]
  quests: Quest[]
}

export type StoryStatus = 'active' | 'completed'

export interface StoryState {
  id: string
  title: string
  tone: StoryTone
  /** Приключение, с которого началась история (src/data/adventures/). */
  adventureId: string
  status: StoryStatus
  createdAt: number
  /** Время последнего действия. */
  updatedAt: number
  /** Отряд. Пока в нём один герой, но код не должен на это рассчитывать. */
  party: PartyMember[]
  world: World
  journal: JournalEntry[]
  messages: ChatMessage[]
  /** Журнал бросков, новые в конце. */
  rolls: RollRecord[]
  /** Находки героев (предметы, полученные в истории). Нет поля — находок ещё не было. */
  finds?: StoryFind[]
  /** Итог — у завершённой истории. */
  epilogue?: StoryEpilogue
  /** Отдых, который попросил игрок: ждёт решения ведущего (прервать или дать отдохнуть). */
  pendingRest?: PendingRest
  /** Память ведущего (сводка старой части ленты). Нет поля — сжатий ещё не было. */
  memory?: StoryMemory
}

export type RestKind = 'short' | 'long'

export interface PendingRest {
  kind: RestKind
  /** Сколько костей хитов тратит каждый герой (короткий отдых). */
  hitDice: Record<string, number>
  requestedAt: number
}

/** Что дал отдых одному герою — всё посчитано движком заранее, применение детерминировано. */
export interface RestHeroResult {
  heroId: string
  /** Хиты: прибавка (не выше максимума). */
  hpGained: number
  /** Короткий отдых: броски костей хитов (итог каждой, с модификатором Тел). */
  hitDiceRolls: number[]
  /** Долгий отдых: возвращено костей хитов. */
  hitDiceRegained: number
  /** Ячейки: все (долгий) или магии договора (короткий у Колдуна). */
  restoreSlots: boolean
  /** Бесплатные сотворения врождённых заклинаний (долгий). */
  restoreFreeCasts: boolean
  /** Возвращено применений умений: id → сколько. */
  resources: Record<string, number>
  /** Снят уровень Истощения (долгий). */
  exhaustionRemoved: boolean
}

/**
 * Память ведущего: сводка «Что было раньше» — сжатая старая часть ленты. В запрос к модели идут сводка и сообщения
 * после `covered`; полная лента остаётся в истории для игрока.
 */
export interface StoryMemory {
  summary: string
  /** Сколько первых сообщений ленты уже вошло в сводку. */
  covered: number
  /** Сколько раз сжимали. */
  compactions: number
  updatedAt: number
}

/** Кто совершил действие. */
export type ActionAuthor =
  | { kind: 'player'; heroId: string }
  | { kind: 'engine' }
  | { kind: 'master' }
  | { kind: 'system' }

/** Что произошло. Всё случайное (id, броски) уже внутри — применение действия детерминировано. */
export type StoryEvent =
  /** История создана: начальное состояние целиком. */
  | { type: 'storyCreated'; seed: StoryState }
  | { type: 'storyRenamed'; title: string }
  /** История завершена с итогом; дальше она только для чтения. */
  | { type: 'storyCompleted'; epilogue?: StoryEpilogue }
  /** Игрок поправил итог завершённой истории (единственное, что можно сделать после завершения). */
  | { type: 'epilogueEdited'; epilogue: StoryEpilogue }
  /** Герой погиб. */
  | { type: 'heroDied'; heroId: string }
  | { type: 'playerSpoke'; heroId: string; messageId: string; text: string }
  /** Ответ ведущего; suggestions — 2–3 подсказки действий для игрока (кнопки под полем ввода). */
  | { type: 'masterNarrated'; messageId: string; text: string; suggestions?: string[] }
  /** Игрок попросил переписать последний ответ ведущего: новый текст на месте старого (что случилось — не меняется). */
  | { type: 'masterRewritten'; messageId: string; text: string; suggestions?: string[] }
  | { type: 'diceRolled'; roll: RollRecord }
  | { type: 'equipmentChanged'; heroId: string; equipped: Equipment }
  | { type: 'heroRenamed'; heroId: string; name: string }
  | { type: 'conditionsChanged'; heroId: string; conditions: ActiveCondition[] }
  | { type: 'itemsGranted'; heroId: string; items: { itemId: string; quantity: number }[] }
  /** Предметы забрали (потрачены, отняты, сломаны). Если предмета не осталось — он снимается с экипировки. */
  | { type: 'itemsRemoved'; heroId: string; items: { itemId: string; quantity: number }[] }
  /** Устарело (старые журналы): золото числом в зм. Новые изменения денег — moneyChanged. */
  | { type: 'goldChanged'; heroId: string; delta: number }
  /** Деньги: delta в медных (плюс — получил, минус — заплатил), coins — кошелёк после (со сдачей). */
  | { type: 'moneyChanged'; heroId: string; delta: number; coins: Coins }
  /** Потрачены применения предмета с зарядами (набор целителя); закончились — предмет уходит. */
  | { type: 'itemChargesUsed'; heroId: string; itemId: string; uses: number; perItem: number }
  /** Игрок выбрал «Божественный порядок» жреца или «Изначальный порядок» друида (старое сохранение). */
  | { type: 'classOrderChosen'; heroId: string; order: string; armor: ArmorType[] }
  /** Герой применил умение класса из запаса («Наложение рук»): потрачено amount. */
  /** Игрок выбрал заклинания (старое сохранение заклинателя или «Посвящённый в магию» без выбора). */
  | { type: 'spellsChosen'; heroId: string; magic: CharacterMagic }
  /** Игрок изменил подготовленные заклинания (в пределах лимита класса; у Волшебника — из книги). */
  | { type: 'preparedSpellsChanged'; heroId: string; prepared: string[] }
  /** Герой сотворил заклинание: потрачена ячейка (slotLevel), бесплатное сотворение (freeKey) или ритуал; у заговора — ничего. */
  | { type: 'spellCast'; heroId: string; spellId: string; slotLevel: number | null; freeKey: string | null; ritual: boolean }
  /** Игрок попросил отдых; ведущий решает, безопасно ли (interrupt_rest — прервать). */
  | { type: 'restRequested'; kind: RestKind; hitDice: Record<string, number> }
  /** Отдых прерван ведущим (засада, шум, стража) — ничего не восстановлено. */
  | { type: 'restInterrupted'; messageId: string; reason: string }
  /** Отдых окончен: что восстановилось у каждого героя (броски — в diceRolled перед этим). */
  | { type: 'restCompleted'; messageId: string; kind: RestKind; heroes: RestHeroResult[] }
  /** Герой применил умение класса («Второе дыхание»). */
  | { type: 'featureUsed'; heroId: string; featureId: string; amount?: number }
  /** Строка изменений за ход ведущего — системное сообщение в ленте. */
  | { type: 'turnSummarized'; messageId: string; changes: TurnChange[] }
  /** Урон (с типом) или лечение; хиты не уходят ниже 0 и выше максимума. */
  | { type: 'hpChanged'; heroId: string; kind: 'damage' | 'healing'; amount: number; damageType?: string }
  /** Проверка, которую запросил ведущий: бросок движка и карточка в ленте. */
  | { type: 'checkRolled'; messageId: string; check: CheckCard; roll?: RollRecord }
  | { type: 'npcAdded'; locationId: string; npc: Npc }
  | { type: 'npcRemoved'; locationId: string; npcId: string }
  | { type: 'objectAdded'; locationId: string; object: MapObject }
  | { type: 'objectRemoved'; locationId: string; objectId: string }
  /** Изменение объекта: название, описание, вид, положение, размер. */
  | { type: 'objectUpdated'; locationId: string; objectId: string; changes: Partial<Omit<MapObject, 'id'>> }
  | { type: 'npcMoved'; locationId: string; npcId: string; to: CellPosition }
  | { type: 'doorChanged'; locationId: string; doorId: string; state: DoorState }
  | { type: 'factRecorded'; fact: WorldFact }
  /** Факт повторял уже записанный — старая запись обновлена новым текстом. */
  | { type: 'factUpdated'; factId: string; text: string; at: number }
  /** Журнал фактов разросся — ведущий объединил повторы и устаревшее (ни одно имя не потеряно). */
  | { type: 'factsMerged'; facts: WorldFact[] }
  /** Сжатие памяти ведущего: первые `covered` сообщений ленты сведены в сводку «Что было раньше» (лента не меняется). */
  | { type: 'memoryCompacted'; summary: string; covered: number; at: number }
  | { type: 'questUpdated'; quest: Quest }
  | { type: 'journalWritten'; entry: JournalEntry }

export type StoryEventType = StoryEvent['type']

/** Действие: тип, автор и время. По порядку действий однозначно восстанавливается состояние истории. */
export type StoryAction = StoryEvent & {
  id: string
  storyId: string
  /** Порядковый номер действия в истории, с 0. */
  seq: number
  at: number
  author: ActionAuthor
}

/** Краткие сведения об истории — для экрана «Мои истории». */
export interface StoryMeta {
  id: string
  title: string
  tone: StoryTone
  status: StoryStatus
  adventureId: string
  createdAt: number
  /** Когда в последний раз играли (время последнего действия). */
  lastPlayedAt: number
  party: { heroId: string; name: string; className: string; level: number }[]
  locationName: string
  /** Сколько действий в журнале. */
  actionCount: number
}
