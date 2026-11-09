// Метки игрока на карте: «тайник?», «опасно», «спросить трактирщика». Это заметки игрока — его догадки, а не факты
// мира: ведущий видит их в состоянии игры и может на них откликнуться, но метка ничего в мире не меняет.
// Метка хранится в общем списке мира (World.marks) с привязкой к локации и клетке её карты — так карта другого
// масштаба сможет показать метки вложенных локаций, не перенося данные. Чистые функции.
import type { CellPosition, LocationData } from '../types/location'
import { MARK_ICONS, type MarkIcon, type PlayerMark, type StoryState, type World } from '../types/story'

/** Названия значков для игрока и ведущего. */
export const MARK_ICON_NAMES: Record<MarkIcon, string> = {
  question: 'вопрос',
  danger: 'опасность',
  cache: 'тайник',
  note: 'заметка',
}

/** Длина текста метки, символов. */
export const MARK_TEXT_MAX = 40
/** Сколько меток можно поставить на одной карте. */
export const MAX_MARKS_PER_LOCATION = 50
/** Сколько меток текущей карты идёт ведущему (ближайшие к героям). */
export const MARKS_IN_PROMPT = 10

/** Метки локации. */
export function marksOf(world: Pick<World, 'marks'>, locationId: string): PlayerMark[] {
  return (world.marks ?? []).filter((m) => m.locationId === locationId)
}

/** Метка в клетке карты или null. */
export function markAt(world: Pick<World, 'marks'>, locationId: string, cell: CellPosition): PlayerMark | null {
  return (world.marks ?? []).find((m) => m.locationId === locationId && m.x === cell.x && m.y === cell.y) ?? null
}

/** Текст метки: без пробелов по краям и без переводов строк. */
export function normalizeMarkText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function contentProblem(icon: unknown, text: unknown): string | null {
  if (!(MARK_ICONS as readonly unknown[]).includes(icon)) return `Значок метки — один из: ${MARK_ICONS.join(', ')}.`
  if (typeof text !== 'string') return 'Текст метки — строка.'
  if (text !== normalizeMarkText(text)) return 'Текст метки — одной строкой, без пробелов по краям.'
  return text.length > MARK_TEXT_MAX ? `Текст метки — не длиннее ${MARK_TEXT_MAX} символов.` : null
}

/** Проверка новой метки по состоянию истории: причина отказа или null. */
export function markPlaceProblem(state: StoryState, mark: PlayerMark, heroId: string): string | null {
  if (mark.heroId !== heroId) return 'Метку ставит игрок своего героя.'
  if (typeof mark.id !== 'string' || !mark.id || (state.world.marks ?? []).some((m) => m.id === mark.id)) return 'У метки нужен новый id.'
  const location = state.world.locations[mark.locationId]
  if (!location) return 'В мире этой истории нет такой локации.'
  if (!Number.isInteger(mark.x) || !Number.isInteger(mark.y) || mark.x < 0 || mark.y < 0 || mark.x >= location.width || mark.y >= location.height)
    return `Метка за пределами карты ${location.width}×${location.height}.`
  if (markAt(state.world, mark.locationId, mark)) return 'В этой клетке уже есть метка — измените её.'
  if (marksOf(state.world, mark.locationId).length >= MAX_MARKS_PER_LOCATION) return `На карте уже ${MAX_MARKS_PER_LOCATION} меток — уберите лишние.`
  return contentProblem(mark.icon, mark.text)
}

/** Проверка правки или удаления метки: она есть и поставлена этим героем. */
export function markChangeProblem(state: StoryState, markId: string, heroId: string, change?: { icon: unknown; text: unknown }): string | null {
  const mark = (state.world.marks ?? []).find((m) => m.id === markId)
  if (!mark) return 'Такой метки нет.'
  if (mark.heroId !== heroId) return 'Метку правит и убирает тот, кто её поставил.'
  return change ? contentProblem(change.icon, change.text) : null
}

/** Расстояние в клетках (диагональ — как шаг, правила 2024) до прямоугольника. */
function cellsTo(from: CellPosition, area: { x: number; y: number; w?: number; h?: number }): number {
  const dx = Math.max(area.x - from.x, 0, from.x - (area.x + (area.w ?? 1) - 1))
  const dy = Math.max(area.y - from.y, 0, from.y - (area.y + (area.h ?? 1) - 1))
  return Math.max(dx, dy)
}

/** Подпись метки для ведущего: «тайник?» (значок «тайник») или просто «тайник». */
export function markLabel(mark: Pick<PlayerMark, 'icon' | 'text'>): string {
  const icon = MARK_ICON_NAMES[mark.icon]
  return mark.text ? `«${mark.text}» (значок «${icon}»)` : `значок «${icon}» без текста`
}

/**
 * Раздел состояния игры «Метки игрока»: метки текущей карты, ближайшие к героям — первыми, с расстоянием и тем, что
 * в клетке и рядом (ведущий знает и скрытое: может решить, как отозваться на догадку игрока).
 */
export function marksText(story: StoryState, location: LocationData): string {
  const marks = marksOf(story.world, location.id)
  if (marks.length === 0) return ''
  const heroes = story.party.filter((m) => !m.fallen)
  const feet = location.cellFeet
  const lines = marks
    .map((mark) => {
      const near = heroes.map((h) => ({ name: h.character.name, cells: cellsTo(h.position, mark) })).sort((a, b) => a.cells - b.cells)[0]
      return { mark, near }
    })
    .sort((a, b) => (a.near?.cells ?? 0) - (b.near?.cells ?? 0) || a.mark.at - b.mark.at)
    .slice(0, MARKS_IN_PROMPT)
    .map(({ mark, near }) => {
      const room = location.rooms.find((r) => mark.x >= r.x && mark.x < r.x + r.w && mark.y >= r.y && mark.y < r.y + r.h)
      const around = [...location.objects, ...location.npcs.map((n) => ({ ...n, w: 1, h: 1 }))]
        .filter((e) => cellsTo(mark, e) <= 1)
        .map((e) => `${e.name} [${e.id}]${'hidden' in e && e.hidden ? ' (скрыт)' : ''}`)
      return [
        `- игрок отметил: ${markLabel(mark)} — клетка (${mark.x}, ${mark.y})`,
        room?.name ? `«${room.name}»` : '',
        near ? (near.cells === 0 ? `${near.name} стоит на ней` : `${near.cells * feet} фт. от ${near.name}`) : '',
        around.length ? `там и рядом: ${around.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('; ')
    })
  const more = marks.length > lines.length ? `\n…и ещё ${marks.length - lines.length} дальше.` : ''
  return [
    '## Метки игрока на карте',
    'Это заметки и догадки игрока, а не факты мира: метка «тайник?» не значит, что тайник есть. Можно откликнуться в рассказе (герой вспоминает, замечает, НПС косится), но не подтверждай догадку без проверки и не выдавай тайного.',
    lines.join('\n') + more,
  ].join('\n')
}
