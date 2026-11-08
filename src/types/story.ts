// История (кампания) — всё, что принадлежит одной игре: отряд, мир, журнал, лог сообщений и бросков.
// Состояние истории не меняют напрямую: оно получается применением действий (StoryAction) по порядку
// (src/game/storyActions.ts). Журнал действий хранится вместе с историей (src/game/repository.ts).

import type { AreaTemplate } from '../engine/areas'
import type { ActiveCondition } from '../engine/conditions'
import type { Character, Equipment, Inventory, InvocationChoice } from './character'
import type { Coins } from '../game/coins'
import type { CharacterMagic } from './spells'
import type { ArmorType } from './items'
import type { ChatMessage, CheckCard, RollRecord, TurnChange } from './game'
import type { CellPosition, DoorState, LocationData, MapEffect, MapObject, Npc, NpcAttitude, NpcPersonality } from './location'

/** Что меняет npcUpdated: поля личности, описание, отношение. Пустая строка в текстовом поле — убрать его. */
export type NpcChanges = Partial<NpcPersonality & { description: string; attitude: NpcAttitude }>

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
  /** Туман войны: исследованные клетки — id локации → строка «0»/«1» по клеткам (строка за строкой). Нет — ничего не исследовано. */
  explored?: Record<string, string>
  /**
   * Метки игрока на картах (src/game/marks.ts). Общий список мира, а не поле локации: метка привязана к локации и клетке
   * её карты, поэтому карта другого масштаба (6.2) сможет показать метки вложенных локаций без переноса данных.
   * Нет поля — меток ещё не ставили.
   */
  marks?: PlayerMark[]
}

export const MARK_ICONS = ['question', 'danger', 'cache', 'note'] as const
/** Значок метки: вопрос, опасность, тайник, заметка. */
export type MarkIcon = (typeof MARK_ICONS)[number]

/** Метка игрока: заметка на клетке карты («тайник?»). Это догадка игрока, а не факт мира. */
export interface PlayerMark {
  id: string
  /** Чей герой поставил (метки правит и удаляет только он). */
  heroId: string
  /** Локация и клетка её карты, к которой привязана метка. */
  locationId: string
  x: number
  y: number
  icon: MarkIcon
  /** Короткий текст (может быть пустым — тогда только значок). */
  text: string
  /** Когда поставлена или изменена. */
  at: number
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
  /**
   * Последняя реплика игрока — вопрос вне игры: пока так, ведущий и движок не меняют игру (никаких инструментов,
   * время не идёт). Снимается следующим действием героя (реплика в игре, просьба об отдыхе).
   */
  outOfGame?: boolean
  /** Память ведущего (сводка старой части ленты). Нет поля — сжатий ещё не было. */
  memory?: StoryMemory
  /**
   * Игровое время — минуты с полуночи Дня 1 (src/engine/time.ts). Нет поля — старая история: читать через
   * storyTime (День 1, 8:00).
   */
  time?: number
  /**
   * Перемещения героев по карте, ещё не рассказанные ведущему (мелкие подряд склеены): уходят с ближайшей репликой
   * игрока или событием «значимое перемещение». Нет поля — ничего не накоплено.
   */
  pendingMoves?: Record<string, PendingMove>
  /** Идёт бой: раунды и скорость. Нет поля — боя нет. */
  combat?: CombatState
  /** Последняя подсветка ведущего на карте (показывается несколько секунд после события). */
  ping?: MapPing
  /** Последняя область, показанная ведущим на карте (show_area). */
  shownArea?: ShownArea
  /** Когда закончился последний долгий отдых (игровое время) — для правила «16 часов до следующего». */
  lastLongRestAt?: number
}

/** Бой (заготовка боевой системы): раунд и скорость героев — сколько футов ещё можно пройти в этом раунде. */
export interface CombatState {
  round: number
  /** Скорость героя в футах (из вида). */
  speed: Record<string, number>
  /** Пройдено в этом раунде, футов. */
  moved: Record<string, number>
}

/** Подсветка ведущего на карте. */
export interface MapPing {
  id: string
  locationId: string
  x: number
  y: number
  w: number
  h: number
  label?: string
}

/** Область воздействия, показанная ведущим на карте (show_area): «вот докуда достаёт свет факела». */
export interface ShownArea {
  id: string
  locationId: string
  template: AreaTemplate
  label?: string
}

/** Накопленное перемещение героя (src/game/mapEvents.ts, mergeMove). */
export interface PendingMove {
  heroId: string
  locationId: string
  /** Где стоял до первого из склеенных перемещений. */
  from: CellPosition
  to: CellPosition
  /** Сколько футов прошёл всего. */
  feet: number
  /** Сколько перемещений склеено. */
  moves: number
  /** Комнаты по пути (id, по порядку, без повторов). */
  rooms: string[]
  /** Скрытые зоны по пути (id) — знает только ведущий. */
  zones: string[]
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
  /** Долгий отдых: можно сменить приёмы оружия (у классов с «Приёмами оружия»). */
  masterySwap?: boolean
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
  /** Реплика игрока; move — накопленные перемещения по карте (для ведущего, с обстановкой), уходят вместе с ней. */
  | { type: 'playerSpoke'; heroId: string; messageId: string; text: string; ooc?: boolean; move?: string }
  /** Ответ ведущего; suggestions — 2–3 подсказки действий для игрока (кнопки под полем ввода). */
  | { type: 'masterNarrated'; messageId: string; text: string; suggestions?: string[]; ooc?: boolean }
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
  /** Игрок выбрал приёмы оружия (старое сохранение) или сменил их после долгого отдыха. */
  | { type: 'weaponMasteriesChosen'; heroId: string; weapons: string[] }
  /** Игрок выбрал языки (старое сохранение): весь список известных языков. */
  | { type: 'languagesChosen'; heroId: string; languages: string[] }
  /** Игрок выбрал таинственные воззвания (старое сохранение колдуна). */
  | { type: 'invocationsChosen'; heroId: string; invocations: InvocationChoice[] }
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
  /** Прошло игровое время (ведущий: «час разговора», «проспали до утра»). Только вперёд. */
  | { type: 'timeAdvanced'; minutes: number; reason: string }
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
  /** Игрок передвинул своего героя по карте (путь проверяет движок: стены, двери, занятые клетки). */
  /**
   * Герой передвинулся: игрок (перетащил токен) или движок по просьбе ведущего (move_hero — к цели по пути A*).
   * forced — перемещение по сюжету без пути и без траты скорости («тебя отбросило»), с причиной; notice — строка игроку
   * в ленте («скорости хватило на 30 фт.»).
   */
  | { type: 'heroMoved'; heroId: string; to: CellPosition; forced?: string; notice?: string }
  /** Бой: начался, новый раунд (скорость восстановлена) или закончился (null). */
  | { type: 'combatChanged'; combat: CombatState | null }
  | { type: 'effectAdded'; locationId: string; effect: MapEffect }
  | { type: 'effectRemoved'; locationId: string; effectId: string }
  /** Ведущий указывает на клетку или объект («вот эта дверь») — подсветка на карте. */
  | { type: 'mapPinged'; ping: MapPing }
  | { type: 'areaShown'; area: ShownArea }
  /** Скрытый НПС или объект обнаружен (проверка героя или решение ведущего) — теперь виден на карте. */
  /** Отряд увидел новые клетки (туман войны): индексы y × ширина + x. */
  | { type: 'areaExplored'; locationId: string; cells: number[] }
  /** Метки игрока на карте: поставить, изменить текст и значок, убрать (src/game/marks.ts). */
  | { type: 'markPlaced'; mark: PlayerMark }
  | { type: 'markEdited'; markId: string; icon: MarkIcon; text: string }
  | { type: 'markRemoved'; markId: string }
  | { type: 'entityRevealed'; locationId: string; kind: 'npc' | 'object'; entityId: string }
  /**
   * Значимое перемещение (вошёл в комнату, вплотную к НПС, скрытая зона, скрылся из виду) — событие ведущему без
   * реплики игрока (движок). text — для игрока в ленте, note — для ведущего (с тем, чего герой не знает).
   */
  | { type: 'heroMoveReported'; heroId: string; messageId: string; text: string; note: string; rules: string[] }
  /** Ведущий обновил НПС: занятие, цель, отношение и т. п. (пустая строка — убрать поле). */
  | { type: 'npcUpdated'; locationId: string; npcId: string; changes: NpcChanges }
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
