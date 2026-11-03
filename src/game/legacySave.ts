// Старый формат сохранения (одна игра в localStorage, версии 1–8). Нужен только для переноса в истории
// (src/game/legacyImport.ts): загрузка с последовательной миграцией до версии 8.

import type { Character } from '../types/character'
import type { GameState, StoryProgress } from '../types/game'
import type { ArmorType } from '../types/items'
import type { LocationData } from '../types/location'
import { initialDoorStates } from './legacyState'

export const SAVE_KEY = 'ai-master:save'
export const SAVE_VERSION = 8

/** Минимальный интерфейс хранилища (совместим с window.localStorage). */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * Переносит сохранение старой версии на текущую. Каждый шаг — переход на одну версию.
 * Возвращает null, если версия неизвестна.
 */
export function migrateSave(save: unknown, context: MigrationContext = {}): unknown | null {
  if (typeof save !== 'object' || save === null) return null
  let { version, state } = save as { version?: unknown; state?: unknown }
  if (version === 1) {
    // v2: добавлен журнал бросков.
    state = { ...(state as object), rolls: [] }
    version = 2
  }
  if (version === 2) {
    // v3: у персонажа появились владения и состояния. Владения берём из стартового шаблона персонажа.
    const s = state as { character?: { id?: unknown } }
    const id = typeof s.character?.id === 'string' ? s.character.id : ''
    const proficiencies = context.characterTemplate?.(id)?.proficiencies ?? { savingThrows: [], skills: {} }
    state = { ...s, character: { ...s.character, proficiencies: structuredClone(proficiencies), conditions: [] } }
    version = 3
  }
  if (version === 3) {
    // v4: вид, предыстория, черты и внешность (появились вместе с созданием персонажа).
    const s = state as { character?: { id?: unknown } }
    const id = typeof s.character?.id === 'string' ? s.character.id : ''
    const template = context.characterTemplate?.(id)
    state = {
      ...s,
      character: {
        ...s.character,
        speciesId: template?.speciesId ?? 'unknown',
        backgroundId: template?.backgroundId ?? 'unknown',
        speciesOption: template?.speciesOption ?? null,
        feats: structuredClone(template?.feats ?? []),
        appearance: template?.appearance ?? '',
      },
    }
    version = 4
  }
  if (version === 4) {
    // v5: руки вместо слотов «оружие/щит», владение инструментами. Ратибор (по шаблону) получает
    // новые черты шаблона (боевой стиль); остальные персонажи — только переименование слотов.
    const s = state as { character?: { id?: unknown; proficiencies?: object; feats?: unknown }; inventory?: { equipped?: Record<string, unknown> } }
    const id = typeof s.character?.id === 'string' ? s.character.id : ''
    const template = context.characterTemplate?.(id)
    const old = s.inventory?.equipped ?? {}
    const feats = Array.isArray(s.character?.feats) ? (s.character.feats as string[]) : []
    state = {
      ...s,
      character: {
        ...s.character,
        proficiencies: { ...s.character?.proficiencies, tools: structuredClone(template?.proficiencies.tools ?? []) },
        feats: [...new Set([...feats, ...(template?.feats ?? [])])],
      },
      inventory: { ...s.inventory, equipped: { mainHand: old.weapon ?? null, offHand: old.shield ?? null, armor: old.armor ?? null } },
    }
    version = 5
  }
  if (version === 5) {
    // v6: тонкие стены по границам клеток вместо стен-клеток. Карты перерисованы, старые координаты
    // больше ничего не значат — игрок возвращается на стартовую клетку локации. Появились двери с состоянием.
    const s = state as { location?: { id?: unknown } }
    const id = typeof s.location?.id === 'string' ? s.location.id : ''
    const location = context.location?.(id)
    if (!location) return null
    state = {
      ...s,
      location: {
        id,
        player: { ...location.playerStart },
        doors: initialDoorStates(location),
      },
    }
    version = 6
  }
  if (version === 6) {
    // v7: владение доспехами в листе персонажа (без владения щитами щит не даёт КД). Берём из данных класса.
    const s = state as { character?: { classId?: unknown; proficiencies?: object } }
    const classId = typeof s.character?.classId === 'string' ? s.character.classId : ''
    const armor = context.armorTraining?.(classId)
    if (!armor) return null
    state = { ...s, character: { ...s.character, proficiencies: { ...s.character?.proficiencies, armor: [...armor] } } }
    version = 7
  }
  if (version === 7) {
    // v8: у игры появилось прохождение истории (для «Моих героев»). Старая игра — прохождение стартовой истории.
    const s = state as { character?: { id?: unknown } }
    const heroId = typeof s.character?.id === 'string' ? s.character.id : ''
    const story = context.newStory?.(heroId)
    if (!story) return null
    state = { ...s, story }
    version = 8
  }
  return version === SAVE_VERSION ? state : null
}

export interface MigrationContext {
  /** Стартовый шаблон персонажа по id — источник полей, которых не было в старых сохранениях. */
  characterTemplate?: (characterId: string) => Character | undefined
  /** Локация по id — для переноса позиции и дверей на новый формат карт. */
  location?: (locationId: string) => LocationData | undefined
  /** Владение доспехами класса по id — для сохранений без него. */
  armorTraining?: (classId: string) => readonly ArmorType[] | undefined
  /** Новое прохождение стартовой истории за героя — для сохранений без истории. */
  newStory?: (heroId: string) => StoryProgress
}

export function loadSavedGame(
  storage: KeyValueStorage | null,
  parseState: (raw: unknown) => GameState,
  migration: MigrationContext = {},
): GameState | null {
  if (!storage) return null
  try {
    const text = storage.getItem(SAVE_KEY)
    if (!text) return null
    const state = migrateSave(JSON.parse(text), migration)
    if (state === null) throw new Error('неподдерживаемая версия сохранения')
    return parseState(state)
  } catch (error) {
    console.warn('Сохранение повреждено или устарело, начинаем новую игру.', error)
    return null
  }
}
