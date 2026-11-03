// Герои игрока («Мои герои») и «Зал славы». Логика — src/game/heroes.ts.
import type { CharacterSheet } from './character'

/** Герой в списке игрока. */
export interface HeroRecord {
  /** Совпадает с id персонажа в листе. */
  id: string
  /** Иконка-портрет (эмодзи). */
  portrait: string
  /** Когда создан, мс с начала эпохи. */
  createdAt: number
  /**
   * Лист героя. Пока герой в истории, актуальный лист — в сохранении игры,
   * а этот обновляется, когда герой выходит из истории.
   */
  sheet: CharacterSheet
  /** Незавершённая история, в которой участвует герой (id прохождения), или null. */
  storyId: string | null
}

/** Как закончился путь героя: гибель или завершённая история. */
export type HeroFate = 'fallen' | 'completed'

/** Запись «Зала славы». */
export interface HallOfFameEntry {
  id: string
  heroId: string
  name: string
  species: string
  className: string
  level: number
  portrait: string
  fate: HeroFate
  storyTitle: string
  /** Краткий итог пути. */
  summary: string
  /** Когда путь закончился, мс с начала эпохи. */
  endedAt: number
}

export interface HeroRoster {
  heroes: HeroRecord[]
  hallOfFame: HallOfFameEntry[]
}
