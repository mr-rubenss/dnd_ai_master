// «Мои герои» и «Зал славы»: чистые функции над списком героев игрока.
// Герой (его исходный лист) принадлежит игроку; его состояние в игре — отряду конкретной истории.
// За согласованность (какой герой в какой истории) отвечает reconcileRoster.

import type { CharacterSheet } from '../types/character'
import type { HallOfFameEntry, HeroFate, HeroRecord, HeroRoster } from '../types/heroes'
import type { ItemCatalog } from '../types/items'
import type { PartyMember, StoryMeta, StoryState } from '../types/story'
import { parseCharacterSheet } from './character'
import { isNonEmptyString, isNumber, isObject, isOneOf, ValidationError } from './validation'

export const EMPTY_ROSTER: HeroRoster = { heroes: [], hallOfFame: [] }
export const MAX_HERO_NAME_LENGTH = 40
export const HERO_FATES: readonly HeroFate[] = ['fallen', 'completed']

/** Иконка-портрет по классу. */
const CLASS_PORTRAITS: Record<string, string> = {
  barbarian: '🪓',
  bard: '🎻',
  cleric: '✨',
  druid: '🌿',
  fighter: '⚔️',
  monk: '👊',
  paladin: '🛡️',
  ranger: '🏹',
  rogue: '🗡️',
  sorcerer: '🔥',
  warlock: '👁️',
  wizard: '📜',
}
export const DEFAULT_PORTRAIT = '🧙'

export function portraitFor(classId: string): string {
  return CLASS_PORTRAITS[classId] ?? DEFAULT_PORTRAIT
}

export type RosterResult = { ok: true; roster: HeroRoster } | { ok: false; reason: string }

const findHero = (roster: HeroRoster, heroId: string) => roster.heroes.find((h) => h.id === heroId)
const replaceHero = (roster: HeroRoster, hero: HeroRecord): HeroRoster => ({
  ...roster,
  heroes: roster.heroes.map((h) => (h.id === hero.id ? hero : h)),
})
const notFound = (): RosterResult => ({ ok: false, reason: 'Такого героя нет в списке.' })

/** Новый герой из готового листа (после создания персонажа). */
export function createHeroRecord(sheet: CharacterSheet, now: number = Date.now()): HeroRecord {
  return { id: sheet.character.id, portrait: portraitFor(sheet.character.classId), createdAt: now, sheet: structuredClone(sheet), storyId: null }
}

export function addHero(roster: HeroRoster, hero: HeroRecord): RosterResult {
  if (findHero(roster, hero.id)) return { ok: false, reason: `Герой с id «${hero.id}» уже есть.` }
  return { ok: true, roster: { ...roster, heroes: [...roster.heroes, hero] } }
}

/** Проверяет новое имя героя; возвращает причину отказа или null. */
export function heroNameProblem(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return 'Введите имя героя.'
  if (trimmed.length > MAX_HERO_NAME_LENGTH) return `Имя не длиннее ${MAX_HERO_NAME_LENGTH} символов.`
  return null
}

export function renameHero(roster: HeroRoster, heroId: string, name: string): RosterResult {
  const hero = findHero(roster, heroId)
  if (!hero) return notFound()
  const problem = heroNameProblem(name)
  if (problem) return { ok: false, reason: problem }
  const sheet = { ...hero.sheet, character: { ...hero.sheet.character, name: name.trim() } }
  return { ok: true, roster: replaceHero(roster, { ...hero, sheet }) }
}

/** Удалить героя. Героя из незавершённой истории удалить нельзя — сначала история должна закончиться. */
export function deleteHero(roster: HeroRoster, heroId: string, storyTitle?: string): RosterResult {
  const hero = findHero(roster, heroId)
  if (!hero) return notFound()
  if (hero.storyId) {
    const where = storyTitle ? `в истории «${storyTitle}»` : 'в незавершённой истории'
    return { ok: false, reason: `${hero.sheet.character.name} сейчас ${where}. Удалить можно только героя вне истории.` }
  }
  return { ok: true, roster: { ...roster, heroes: roster.heroes.filter((h) => h.id !== heroId) } }
}

/** Герой вступает в историю. Один герой — только в одной незавершённой истории. */
export function joinStory(roster: HeroRoster, heroId: string, storyId: string): RosterResult {
  const hero = findHero(roster, heroId)
  if (!hero) return notFound()
  if (hero.storyId && hero.storyId !== storyId) {
    return { ok: false, reason: `${hero.sheet.character.name} уже участвует в другой незавершённой истории.` }
  }
  return { ok: true, roster: replaceHero(roster, { ...hero, storyId }) }
}

/**
 * Герой выходит из прерванной истории и снова свободен. Если передан лист из игры —
 * герой сохраняет то, что получил в истории (снаряжение, состояние).
 */
export function leaveStory(roster: HeroRoster, heroId: string, sheet?: CharacterSheet): RosterResult {
  const hero = findHero(roster, heroId)
  if (!hero) return notFound()
  return { ok: true, roster: replaceHero(roster, { ...hero, storyId: null, sheet: sheet ? structuredClone(sheet) : hero.sheet }) }
}

/** Число реплик героя в истории (старые сообщения без героя считаются репликами единственного героя). */
export function playerTurns(state: StoryState, heroId: string): number {
  return state.messages.filter((m) => m.author === 'player' && (m.heroId === heroId || (m.heroId === undefined && state.party.length === 1))).length
}

const plural = (n: number, one: string, few: string, many: string) => {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

/** Краткий итог пути героя в истории. */
export function heroSummary(fate: HeroFate, state: StoryState, member: PartyMember): string {
  const turns = playerTurns(state, member.heroId)
  const rolls = state.rolls.length
  const outcome = fate === 'fallen' ? `Гибель в истории «${state.title}»` : `История «${state.title}» завершена`
  return (
    `${outcome} на ${member.character.level}-м уровне. ` +
    `${turns} ${plural(turns, 'ход', 'хода', 'ходов')}, ${rolls} ${plural(rolls, 'бросок', 'броска', 'бросков')} кубиков.`
  )
}

/**
 * Путь героя закончен (гибель или завершённая история): герой уходит из списка в «Зал славы».
 * `state` — состояние истории, в которой он был.
 */
export function retireHero(roster: HeroRoster, state: StoryState, heroId: string, fate: HeroFate, now: number = Date.now()): RosterResult {
  const hero = findHero(roster, heroId)
  const member = state.party.find((m) => m.heroId === heroId)
  if (!hero || !member) return notFound()
  if (hero.storyId !== state.id) return { ok: false, reason: `${member.character.name} не участвует в этой истории.` }
  const { character } = member
  const entry: HallOfFameEntry = {
    id: crypto.randomUUID(),
    heroId: hero.id,
    name: character.name,
    species: character.species,
    className: character.className,
    level: character.level,
    portrait: hero.portrait,
    fate,
    storyTitle: state.title,
    summary: heroSummary(fate, state, member),
    endedAt: now,
  }
  return {
    ok: true,
    roster: { heroes: roster.heroes.filter((h) => h.id !== hero.id), hallOfFame: [entry, ...roster.hallOfFame] },
  }
}

/**
 * Согласует список героев с историями: герой числится в истории, только если она не завершена
 * и он в её отряде; герой из отряда незавершённой истории отмечен в ней.
 */
export function reconcileRoster(roster: HeroRoster, stories: readonly StoryMeta[]): HeroRoster {
  const storyOf = new Map<string, string>()
  for (const story of stories) {
    if (story.status !== 'active') continue
    for (const member of story.party) storyOf.set(member.heroId, story.id)
  }
  const heroes = roster.heroes.map((h) => {
    const storyId = storyOf.get(h.id) ?? null
    return h.storyId === storyId ? h : { ...h, storyId }
  })
  return heroes.some((h, i) => h !== roster.heroes[i]) ? { ...roster, heroes } : roster
}

/** Проверяет список героев (например, загруженный из localStorage). */
export function parseRoster(raw: unknown, catalog: ItemCatalog): HeroRoster {
  const title = 'Некорректный список героев'
  if (!isObject(raw) || !Array.isArray(raw.heroes) || !Array.isArray(raw.hallOfFame)) {
    throw new ValidationError(title, ['ожидается { heroes: [], hallOfFame: [] }'])
  }
  const problems: string[] = []
  const ids = new Set<string>()
  raw.heroes.forEach((hero: unknown, i) => {
    const where = `heroes[${i}]`
    if (!isObject(hero) || !isNonEmptyString(hero.id) || !isNonEmptyString(hero.portrait) || !isNumber(hero.createdAt)) {
      return problems.push(`${where}: ожидается { id, portrait, createdAt, sheet, storyId }`)
    }
    if (ids.has(hero.id)) problems.push(`${where}: повторяющийся id "${hero.id}"`)
    ids.add(hero.id)
    if (hero.storyId !== null && !isNonEmptyString(hero.storyId)) problems.push(`${where}.storyId: строка или null`)
    try {
      const sheet = parseCharacterSheet(hero.sheet, catalog)
      if (sheet.character.id !== hero.id) problems.push(`${where}: id героя не совпадает с id персонажа`)
    } catch (error) {
      if (error instanceof ValidationError) problems.push(...error.problems.map((p) => `${where}.sheet: ${p}`))
      else throw error
    }
  })
  raw.hallOfFame.forEach((entry: unknown, i) => {
    const ok =
      isObject(entry) &&
      ['id', 'heroId', 'name', 'species', 'className', 'portrait', 'storyTitle', 'summary'].every((k) => isNonEmptyString(entry[k])) &&
      Number.isInteger(entry.level) &&
      isOneOf(HERO_FATES, entry.fate) &&
      isNumber(entry.endedAt)
    if (!ok) problems.push(`hallOfFame[${i}]: ожидается { id, heroId, name, species, className, level, portrait, fate, storyTitle, summary, endedAt }`)
  })
  if (problems.length > 0) throw new ValidationError(title, problems)
  return raw as unknown as HeroRoster
}
