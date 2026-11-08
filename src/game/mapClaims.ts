// Сверка рассказа ведущего с картой: всё, что рассказано, должно отражаться на карте. Если в тексте НПС «уходит»,
// а на карте он стоит на месте, или «подходит к тебе», а не сдвинулся, или игрок написал «подхожу к стойке», а герой
// не двинулся и move_hero не вызывался, — ведущий получает короткую просьбу исправить инструментом (часть общей
// сверки текста в masterTurn.ts, один раз за ход). Эвристика по словам предложения; отрицания не считаются.
import type { AiToolCall } from '../ai/types'
import type { ChatMessage } from '../types/game'
import type { StoryState } from '../types/story'
import type { ToolOutcome } from './masterTools'
import { nameInText } from './spellMatch'

/** НПС покидает сцену. */
export const NPC_LEAVES =
  /(?<!не\s)(?<!\p{L})(?:уходит|уходят|ушёл|ушел|ушла|выходит\s+(?:из|за|прочь|на\s+улицу)|вышел|вышла|покидает|покинул|покинула|убегает|убежал|убежала|сбегает|сбежал|сбежала|удаляется|исчезает\s+за\s+дверью|скрывается\s+за\s+дверью)(?!\p{L})/iu
/** НПС перемещается к кому-то или чему-то. */
export const NPC_APPROACHES =
  /(?<!не\s)(?<!\p{L})(?:подходит|подошёл|подошел|подошла|подсаживается|подсел|подсела|приближается|подбегает|подбежал|подбежала|направляется\s+к|идёт\s+к|идет\s+к|садится\s+(?:рядом|напротив|к))(?!\p{L})/iu
/** Игрок заявляет перемещение героя. */
export const HERO_MOVES =
  /(?<!не\s)(?<!\p{L})(?:подхожу|подойду|иду\s+к|пойду\s+к|направляюсь|сажусь|сяду|подсаживаюсь|пересаживаюсь|отхожу|перехожу|прохожу\s+к|бегу\s+к|возвращаюсь\s+к|встаю\s+(?:у|к|рядом))(?!\p{L})/iu

const sentences = (text: string) => text.split(/(?<=[.!?…])\s+|\n+/).filter((s) => s.trim())

type Calls = readonly { call: AiToolCall; outcome: ToolOutcome }[]
const callsFor = (calls: Calls, name: string) => calls.filter((t) => t.call.name === name)

/**
 * Расхождения рассказа и карты за ход. before — история на начало хода, after — сейчас; said — реплика игрока,
 * с которой начался ход (если с неё).
 */
export function mapProblems(text: string, before: StoryState, after: StoryState, toolCalls: Calls, said?: ChatMessage): string[] {
  const problems: string[] = []
  const was = before.world.locations[before.world.currentLocationId]
  const now = after.world.locations[after.world.currentLocationId]
  if (!was || !now || was.id !== now.id) return problems
  const parts = sentences(text)
  for (const npc of was.npcs) {
    if (npc.hidden) continue
    const about = parts.filter((s) => nameInText(npc.name, s))
    const still = now.npcs.find((n) => n.id === npc.id)
    if (!still) continue
    const moved = still.x !== npc.x || still.y !== npc.y
    if (about.some((s) => NPC_LEAVES.test(s)) && !moved)
      problems.push(`в рассказе ${npc.name} уходит, а на карте стоит на месте — вызови remove_npc (npc: ${npc.id}, reason: left) или move_npc, если он ещё в зале`)
    else if (about.some((s) => NPC_APPROACHES.test(s)) && !moved)
      problems.push(`в рассказе ${npc.name} подходит или садится, а на карте не сдвинулся — вызови move_npc (npc: ${npc.id}) в свободную клетку рядом`)
  }
  if (said && said.author === 'player' && !said.ooc && !said.move && HERO_MOVES.test(said.text) && callsFor(toolCalls, 'move_hero').length === 0) {
    const hero = said.heroId ? before.party.find((m) => m.heroId === said.heroId) : before.party[0]
    const after_ = hero ? after.party.find((m) => m.heroId === hero.heroId) : undefined
    if (hero && after_ && hero.position.x === after_.position.x && hero.position.y === after_.position.y)
      problems.push(
        `игрок перемещает героя («${said.text.slice(0, 60)}»), а на карте ${hero.character.name} стоит на месте — вызови move_hero с target (id объекта или НПС из состояния игры)`,
      )
  }
  return problems
}
