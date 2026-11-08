// Видимость на карте (SRD 5.2.1): что герой видит сейчас. Линия видимости — src/engine/movement.ts (стены и закрытые
// двери перекрывают, окна и открытые двери — нет). Освещённость клетки — общий свет карты и источники (яркий
// и тусклый радиус, свет тоже не проходит сквозь стены). В темноте (Heavily Obscured) герой не видит; в тусклом свете
// видит. Тёмное зрение (Darkvision) в пределах дальности: тусклый свет — как яркий, темнота — как тусклый (только
// оттенки серого). Магическая тьма (эффект darkness) не освещается обычным светом, и тёмное зрение сквозь неё не видит;
// дым (smoke) — сильно заслоняет. Туман войны: исследованные клетки (`world.explored`) копятся действием
// `areaExplored`. Чистые функции.
import { hasLineOfSight, isFloor } from '../engine/movement'
import type { CellPosition, LocationData } from '../types/location'
import type { RulesData } from '../types/rules'
import type { PartyMember, StoryState } from '../types/story'
import { ambientOf, lightSources, profileOf } from './mapView'

export type LightLevel = 'bright' | 'dim' | 'dark' | 'magic-dark'
export const LIGHT_LEVEL_NAMES: Record<LightLevel, string> = { bright: 'яркий свет', dim: 'полумрак', dark: 'темнота', 'magic-dark': 'магическая тьма' }

const RANK: Record<'bright' | 'dim' | 'dark', number> = { dark: 0, dim: 1, bright: 2 }
export const cellKey = (c: CellPosition) => `${c.x},${c.y}`
const inArea = (c: CellPosition, a: { x: number; y: number; w: number; h: number }) => c.x >= a.x && c.x < a.x + a.w && c.y >= a.y && c.y < a.y + a.h

type Doors = StoryState['world']['doors'][string]

/** Освещённость каждой клетки пола (ключ «x,y»). */
export function lightMap(location: LocationData, doors: Doors = {}): Map<string, LightLevel> {
  const ambient = profileOf(location).lighting ? ambientOf(location) : 'bright'
  const lights = lightSources(location).map((l) => ({
    ...l,
    // Клетка, из которой светит источник (центр объекта), — для линии видимости света.
    cell: { x: Math.min(location.width - 1, Math.max(0, Math.floor(l.x))), y: Math.min(location.height - 1, Math.max(0, Math.floor(l.y))) },
  }))
  const magicDark = (location.effects ?? []).filter((e) => e.kind === 'darkness')
  const levels = new Map<string, LightLevel>()
  for (let y = 0; y < location.height; y++)
    for (let x = 0; x < location.width; x++) {
      if (!isFloor(location, x, y)) continue
      const c = { x, y }
      if (magicDark.some((e) => inArea(c, e))) {
        levels.set(cellKey(c), 'magic-dark')
        continue
      }
      let level: 'bright' | 'dim' | 'dark' = ambient
      for (const l of lights) {
        if (level === 'bright') break
        const d = Math.hypot(x + 0.5 - l.x, y + 0.5 - l.y)
        if (d > l.radius || !hasLineOfSight(location, l.cell, c, doors)) continue
        const lit = d <= l.bright ? 'bright' : 'dim'
        if (RANK[lit] > RANK[level]) level = lit
      }
      // Огонь на карте (эффект fire) тоже светит своей областью.
      if (level !== 'bright' && (location.effects ?? []).some((e) => e.kind === 'fire' && inArea(c, e))) level = 'bright'
      levels.set(cellKey(c), level)
    }
  return levels
}

/** Дальность тёмного зрения героя в футах (вид и его ветвь, SRD 5.2.1); 0 — нет. */
export function darkvisionOf(character: PartyMember['character'], rules: Pick<RulesData, 'species'> | undefined): number {
  const species = rules?.species?.[character.speciesId]
  if (!species) return 0
  const option = character.speciesOption ? species.choice?.options.find((o) => o.id === character.speciesOption) : undefined
  return option?.darkvision ?? species.darkvision ?? 0
}

export interface HeroVision {
  heroId: string
  /** Видимые клетки (ключ «x,y»). */
  visible: Set<string>
  /** Свет в клетке героя. */
  here: LightLevel
  darkvision: number
}

/** Что видит герой: линия видимости + свет (или тёмное зрение в пределах дальности); дым и магическая тьма заслоняют. */
export function heroVision(location: LocationData, state: Pick<StoryState, 'world'>, member: PartyMember, rules?: Pick<RulesData, 'species'>, light?: Map<string, LightLevel>): HeroVision {
  const doors = state.world.doors[location.id] ?? {}
  const levels = light ?? lightMap(location, doors)
  const darkvision = darkvisionOf(member.character, rules)
  const at = member.position
  const smoke = (location.effects ?? []).filter((e) => e.kind === 'smoke')
  const visible = new Set<string>([cellKey(at)])
  for (let y = 0; y < location.height; y++)
    for (let x = 0; x < location.width; x++) {
      const c = { x, y }
      const level = levels.get(cellKey(c))
      if (!level || (x === at.x && y === at.y)) continue
      if (smoke.some((e) => inArea(c, e)) && Math.max(Math.abs(x - at.x), Math.abs(y - at.y)) > 0) continue
      if (level === 'magic-dark') continue
      if (level === 'dark') {
        const feet = Math.max(Math.abs(x - at.x), Math.abs(y - at.y)) * location.cellFeet
        if (feet > darkvision) continue
      }
      if (hasLineOfSight(location, at, c, doors)) visible.add(cellKey(c))
    }
  return { heroId: member.heroId, visible, here: levels.get(cellKey(at)) ?? 'bright', darkvision }
}

/** Что видит отряд (живые герои вместе). */
export function partyVision(location: LocationData, state: Pick<StoryState, 'world' | 'party'>, rules?: Pick<RulesData, 'species'>): Set<string> {
  const levels = lightMap(location, state.world.doors[location.id] ?? {})
  const all = new Set<string>()
  for (const m of state.party.filter((p) => !p.fallen)) for (const k of heroVision(location, state, m, rules, levels).visible) all.add(k)
  return all
}

// ---------- Туман войны ----------

/** Исследованные клетки локации: строка из «0»/«1» по клеткам (строка за строкой). */
export function exploredCells(state: Pick<StoryState, 'world'>, location: LocationData): Set<string> {
  const bits = state.world.explored?.[location.id] ?? ''
  const out = new Set<string>()
  for (let i = 0; i < bits.length; i++) if (bits[i] === '1') out.add(`${i % location.width},${Math.floor(i / location.width)}`)
  return out
}

/** Новые клетки (индексы y × ширина + x), которых ещё нет среди исследованных; пусто — нечего записывать. */
export function newlyExplored(state: Pick<StoryState, 'world'>, location: LocationData, visible: ReadonlySet<string>): number[] {
  const known = exploredCells(state, location)
  return [...visible]
    .filter((k) => !known.has(k))
    .map((k) => {
      const [x, y] = k.split(',').map(Number)
      return y * location.width + x
    })
    .sort((a, b) => a - b)
}

/** Добавить исследованные клетки к строке локации. */
export function mergeExplored(bits: string | undefined, size: number, cells: readonly number[]): string {
  const arr = (bits ?? '').padEnd(size, '0').slice(0, size).split('')
  for (const i of cells) if (i >= 0 && i < size) arr[i] = '1'
  return arr.join('')
}

// ---------- Ведущему: что видит герой ----------

/** Раздел состояния игры «Что видит герой сейчас»: свет, тёмное зрение, кого и что видно, кого — нет. */
export function visionText(story: StoryState, location: LocationData, rules?: Pick<RulesData, 'species'>): string {
  const levels = lightMap(location, story.world.doors[location.id] ?? {})
  const seen = (v: HeroVision, area: { x: number; y: number; w?: number; h?: number }) => {
    for (let y = area.y; y < area.y + (area.h ?? 1); y++) for (let x = area.x; x < area.x + (area.w ?? 1); x++) if (v.visible.has(`${x},${y}`)) return true
    return false
  }
  const lines = story.party
    .filter((m) => !m.fallen)
    .map((m) => {
      const v = heroVision(location, story, m, rules, levels)
      const npcsSeen = location.npcs.filter((n) => !n.hidden && seen(v, n)).map((n) => n.name)
      const npcsUnseen = location.npcs.filter((n) => !n.hidden && !seen(v, n)).map((n) => n.name)
      const names = new Set<string>()
      for (const o of location.objects) if (!o.hidden && !['chair', 'candle', 'rug'].includes(o.type) && seen(v, o)) names.add(o.name)
      const objectsUnseen = new Set(location.objects.filter((o) => !o.hidden && !['chair', 'candle', 'rug'].includes(o.type) && !seen(v, o)).map((o) => o.name))
      const sight =
        v.darkvision > 0
          ? `тёмное зрение ${v.darkvision} фт. (в темноте в этих пределах видит как в полумраке, только оттенки серого; магическую тьму не видит)`
          : 'тёмного зрения нет (в темноте не видит ничего, кроме освещённого)'
      return [
        `- ${m.character.name}: у него ${LIGHT_LEVEL_NAMES[v.here]}; ${sight}.`,
        `  Видит НПС: ${npcsSeen.join(', ') || 'никого'}. Видит: ${[...names].join(', ') || 'ничего примечательного'}.`,
        npcsUnseen.length || objectsUnseen.size
          ? `  НЕ видит (стены, закрытые двери, темнота, дым): ${[...npcsUnseen, ...objectsUnseen].join(', ')} — не описывай их как видимые; услышать — можно.`
          : '',
      ]
        .filter(Boolean)
        .join('\n')
    })
  return lines.length ? `## Что видит герой сейчас (описывай только видимое)\n${lines.join('\n')}` : ''
}
