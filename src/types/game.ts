import type { D20TestResult } from '../engine/checks'
import type { RollResult } from '../engine/dice'
import type { Character, Inventory } from './character'
import type { CellPosition, DoorState } from './location'

export type MessageAuthor = 'master' | 'player' | 'system'

export interface ChatMessage {
  id: string
  author: MessageAuthor
  text: string
  /** Чья реплика (для сообщений игрока в отряде из нескольких героев). */
  heroId?: string
  /** Проверка, которую запросил ведущий и бросил движок, — в ленте показывается карточкой. */
  check?: CheckCard
  /** Подсказки действий, которые ведущий предложил в конце ответа. */
  suggestions?: string[]
  /** Строка изменений за ход ведущего («−4 мм (эль)», «−1 стрела», «+5 хитов») — системное сообщение после ответа. */
  changes?: TurnChange[]
  /**
   * «Вне игры»: вопрос игрока мастеру и ответ на него (правила, что было раньше, что знает герой). Это не ход —
   * в ленте приглушено с пометкой, в сводку истории не попадает.
   */
  ooc?: boolean
}

/** Одно изменение в листе героя за ход. */
export interface TurnChange {
  heroId: string
  kind: 'money' | 'item' | 'hp' | 'condition' | 'spell' | 'rest'
  /** Коротко для игрока: «−4 мм (эль)». */
  text: string
  /** Прибыло или убыло — для цвета в ленте. */
  tone: 'gain' | 'loss'
}

/** Карточка проверки в ленте: кто, что, зачем, бросок и итог. */
export interface CheckCard {
  heroId: string
  heroName: string
  /** Зачем проверка — со слов ведущего. */
  reason: string
  result: D20TestResult
  /**
   * Скрытая проверка: бросает движок, но игрок карточку не видит (Внимательность против вора, Проницательность
   * против лжи, поиск ловушки) — только рассказ ведущего. Бросок остаётся в журнале действий и журнале разработчика.
   */
  hidden?: boolean
}

/** Запись в журнале бросков. */
export interface RollRecord {
  id: string
  /** Что бросали: «Атака», «Мудрость (Внимательность)» и т. п. */
  label?: string
  /** Время броска, мс с начала эпохи. */
  timestamp: number
  result: RollResult
}

/** Прохождение истории в старом формате сохранения (v8, localStorage) — только для переноса. */
export interface StoryProgress {
  /** id прохождения (уникален для каждой начатой игры). */
  id: string
  /** id истории из данных (src/data/story.json). */
  storyId: string
  title: string
  /** Герой истории — id персонажа. */
  heroId: string
  startedAt: number
}

/**
 * Состояние игры старого формата (одно сохранение в localStorage, до историй).
 * Нужно только для переноса старых сохранений (src/game/legacyImport.ts).
 */
export interface GameState {
  story: StoryProgress
  character: Character
  inventory: Inventory
  location: {
    id: string
    player: CellPosition
    /** Текущее состояние каждой двери локации по id (открыта/закрыта/заперта). */
    doors: Record<string, DoorState>
  }
  messages: ChatMessage[]
  /** Журнал бросков, новые в конце. */
  rolls: RollRecord[]
}
