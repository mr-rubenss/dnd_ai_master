// Награды не из ниоткуда: у каждого предмета и дохода героя — источник (лежит в локации, у НПС, куплено, награда
// за задание, добыча), а ценность ограничена таблицей по уровню отряда. Так игрок не может «написать» себе
// непробиваемый доспех или всё золото трактирщика, а ведущий — раздать их словами. Чистые функции.
// Цены редкостей — SRD 5.2.1 («Magic Item Rarities and Values»); пороги по уровням — наша таблица (в SRD её нет).
import { ITEM_RARITIES, type ItemDefinition, type ItemRarity } from '../types/items'
import type { Npc, MapObject } from '../types/location'
import type { Quest, StoryState } from '../types/story'

/** Откуда у героя предмет или деньги. */
export const REWARD_SOURCES = ['location', 'npc', 'purchase', 'quest', 'loot'] as const
export type RewardSource = (typeof REWARD_SOURCES)[number]

export const SOURCE_NAMES: Record<RewardSource, string> = {
  location: 'лежало в локации',
  npc: 'от НПС',
  purchase: 'куплено',
  quest: 'награда за задание',
  loot: 'добыча',
}

export const RARITY_NAMES: Record<ItemRarity, string> = {
  common: 'обычный',
  uncommon: 'необычный',
  rare: 'редкий',
  'very-rare': 'очень редкий',
  legendary: 'легендарный',
  artifact: 'артефакт',
}

/** Цена волшебного предмета по редкости, зм (SRD 5.2.1); артефакт бесценен. */
export const RARITY_VALUE_GP: Record<ItemRarity, number> = {
  common: 100,
  uncommon: 400,
  rare: 4_000,
  'very-rare': 40_000,
  legendary: 200_000,
  artifact: Infinity,
}

export interface RewardTier {
  /** Уровни отряда (уровень самого опытного живого героя). */
  minLevel: number
  maxLevel: number
  /** Самая высокая редкость, которую можно получить. */
  maxRarity: ItemRarity
  /** Предела стоимости предметов за один вызов, зм (покупка не ограничена — герой платит сам). */
  maxItemValueGp: number
  /** Предел дохода за один вызов change_gold, зм. */
  maxGoldGp: number
}

/** Пределы наград по уровню отряда. */
export const REWARD_TIERS: RewardTier[] = [
  { minLevel: 1, maxLevel: 4, maxRarity: 'uncommon', maxItemValueGp: 100, maxGoldGp: 100 },
  { minLevel: 5, maxLevel: 10, maxRarity: 'rare', maxItemValueGp: 1_000, maxGoldGp: 1_000 },
  { minLevel: 11, maxLevel: 16, maxRarity: 'very-rare', maxItemValueGp: 10_000, maxGoldGp: 10_000 },
  { minLevel: 17, maxLevel: 20, maxRarity: 'legendary', maxItemValueGp: 100_000, maxGoldGp: 100_000 },
]

/** Уровень отряда — уровень самого опытного живого героя. */
export const partyLevel = (state: Pick<StoryState, 'party'>) => Math.max(1, ...state.party.filter((m) => !m.fallen).map((m) => m.character.level))

export const rewardTier = (level: number): RewardTier => REWARD_TIERS.find((t) => level <= t.maxLevel) ?? REWARD_TIERS[REWARD_TIERS.length - 1]

/** Ценность одной штуки, зм: цена из справочника, у волшебного без цены — по редкости. */
export const itemValueGp = (item: ItemDefinition) => item.cost ?? (item.rarity ? RARITY_VALUE_GP[item.rarity] : 0)

const rank = (r: ItemRarity) => ITEM_RARITIES.indexOf(r)

/** Почему такой предмет не может достаться отряду этого уровня (или null). */
export function itemRewardProblem(item: ItemDefinition, quantity: number, level: number, source: RewardSource): string | null {
  const tier = rewardTier(level)
  if (item.rarity && rank(item.rarity) > rank(tier.maxRarity))
    return `«${item.name}» — ${RARITY_NAMES[item.rarity]} предмет, а отряду ${level}-го уровня доступно не выше «${RARITY_NAMES[tier.maxRarity]}». Такого здесь нет — обыграй это в рассказе.`
  if (source === 'purchase') return null
  const value = itemValueGp(item) * quantity
  if (value > tier.maxItemValueGp)
    return `«${item.name}»${quantity > 1 ? ` ×${quantity}` : ''} стоит ${value} зм — для отряда ${level}-го уровня награда за раз не больше ${tier.maxItemValueGp} зм. Найти такое просто так нельзя: его можно купить, заработать заданием или найти поскромнее — обыграй это в рассказе.`
  return null
}

/** Почему такой доход не может достаться отряду этого уровня (или null). */
export function goldRewardProblem(cp: number, level: number): string | null {
  const tier = rewardTier(level)
  return cp > tier.maxGoldGp * 100
    ? `${cp / 100} зм за раз — слишком много для отряда ${level}-го уровня (не больше ${tier.maxGoldGp} зм). Столько денег здесь нет — обыграй это в рассказе.`
    : null
}

/** Найденный источник: подпись для рассказа. */
export interface ResolvedSource {
  source: RewardSource
  label: string
  npc?: Npc
  object?: MapObject
  quest?: Quest
}

const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е')
const byName = <T extends { id: string; name: string }>(list: readonly T[], q: string) => list.find((x) => x.id === q) ?? list.find((x) => norm(x.name) === norm(q))

/**
 * Проверить источник: НПС и объекты — в текущей локации, задание — в журнале заданий (не проваленное).
 * Возвращает источник или текст отказа.
 */
export function resolveSource(state: StoryState, source: RewardSource, from: string | undefined): ResolvedSource | string {
  const location = state.world.locations[state.world.currentLocationId]
  const npcs = location?.npcs ?? []
  const objects = location?.objects ?? []
  const list = (xs: { id: string; name: string }[]) => xs.map((x) => `${x.name} (${x.id})`).join(', ') || 'нет'
  switch (source) {
    case 'npc': {
      if (!from) return 'Укажи «from»: id или имя НПС, от которого это.'
      const npc = byName(npcs, from)
      return npc ? { source, npc, label: `от НПС ${npc.name}` } : `НПС «${from}» здесь нет — получить от него нельзя. НПС рядом: ${list(npcs)}.`
    }
    case 'location': {
      if (!from) return 'Укажи «from»: id или название объекта локации, где это лежало (сундук, стол…).'
      const object = byName(objects, from)
      return object ? { source, object, label: `из «${object.name}»` } : `Объекта «${from}» в локации нет. Объекты: ${list(objects)}. Нужно новое место — сначала add_object.`
    }
    case 'loot': {
      if (!from) return 'Укажи «from»: у кого или откуда добыча (НПС или объект в локации).'
      const npc = byName(npcs, from)
      if (npc) return { source, npc, label: `добыча: ${npc.name}` }
      const object = byName(objects, from)
      return object ? { source, object, label: `добыча: ${object.name}` } : `«${from}» в локации нет — добыче неоткуда взяться. НПС: ${list(npcs)}; объекты: ${list(objects)}.`
    }
    case 'quest': {
      if (!from) return 'Укажи «from»: id или название задания, за которое награда.'
      const quest = state.world.quests.find((q) => q.id === from || norm(q.title) === norm(from))
      if (!quest) return `Задания «${from}» нет в журнале заданий${state.world.quests.length ? `: ${state.world.quests.map((q) => `${q.title} (${q.id})`).join(', ')}` : ''}. Награда бывает только за задание.`
      if (quest.status === 'failed') return `Задание «${quest.title}» провалено — награды за него нет.`
      return { source, quest, label: `награда за «${quest.title}»` }
    }
    case 'purchase': {
      if (!from) return { source, label: 'куплено' }
      const npc = byName(npcs, from)
      return npc ? { source, npc, label: `куплено у ${npc.name}` } : `Продавца «${from}» здесь нет. НПС рядом: ${list(npcs)}.`
    }
  }
}
