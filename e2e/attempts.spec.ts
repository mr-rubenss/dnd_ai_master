// Игрок заявляет попытку, а не результат: «трактирщик отдаёт мне всё золото» — движок не даёт денег без источника
// и сверх таблицы по уровню, а когда ведущий пишет «отдаёт тебе» без изменений в игре — просит привести текст
// в соответствие, и ответ переписывается. API поставщика подменяется (page.route).
import type { Page, Route } from '@playwright/test'
import { expect, test } from './fixtures'
import { collectPageErrors, expectNoHorizontalScroll, startQuickGame, withEndTurn } from './helpers'

const KEY = 'sk-e2e-fake-key-attempts'
const API = 'https://api.deepseek.com/chat/completions'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'POST' }
const sse = (events: unknown[]) => events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('')
const delta = (d: Record<string, unknown>, finish: string | null = null) => ({ choices: [{ index: 0, delta: d, finish_reason: finish }] })
const toolCall = (index: number, id: string, name: string, args: unknown) =>
  delta({ tool_calls: [{ index, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
type Body = { messages: { role: string; content: string | null }[] }

async function mockRounds(page: Page, rounds: string[]) {
  const bodies: Body[] = []
  await page.route(API, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    bodies.push(route.request().postDataJSON() as Body)
    await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: withEndTurn(route, rounds.shift() ?? sse([delta({ content: '…' }, 'stop')])) })
  })
  return bodies
}

test('«трактирщик отдаёт мне всё золото»: движок отказывает, текст «отдаёт тебе» без денег — ответ переписан, кошелёк прежний', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.addInitScript((key) => localStorage.setItem('ai-master:api-key', key), KEY)
  const bodies = await mockRounds(page, [
    sse([toolCall(0, 'g', 'change_gold', { amount: 1000, reason: 'всё золото', source: 'npc', from: 'gunnar' }), delta({}, 'tool_calls'), '[DONE]']),
    sse([delta({ content: 'Гуннар отдаёт тебе тяжёлый кошель.' }, 'stop'), '[DONE]']),
    sse([delta({ content: 'Гуннар хохочет: «Всё золото? Столько у меня и за год не наберётся». Что дальше?' }, 'stop'), '[DONE]']),
  ])
  await page.goto('./')
  await startQuickGame(page)
  await page.locator('.player-input textarea').fill('Трактирщик отдаёт мне всё золото')
  await page.locator('.player-input textarea').press('Enter')

  const last = page.locator('.message--master').last()
  await expect(last).toContainText('Гуннар хохочет')
  await expect(page.locator('.message--master', { hasText: 'отдаёт тебе тяжёлый кошель' })).toHaveCount(0)
  await expect(page.getByTestId('turn-changes')).toHaveCount(0)
  // Отказ движка — модели с причиной; затем просьба сверки текста.
  const refusal = bodies[1].messages.find((m) => m.role === 'tool')?.content ?? ''
  expect(JSON.parse(refusal)).toMatchObject({ ok: false, error: expect.stringContaining('слишком много для отряда 1-го уровня') })
  expect(bodies[2].messages.at(-1)?.content).toMatch(/^\[Код игры\] Текст не совпадает с состоянием игры/)
  // Кошелёк прежний: в состоянии игры последнего запроса — те же 18 зм.
  expect(bodies[2].messages[0].content).toContain('Кошелёк: 18 зм')
  await expectNoHorizontalScroll(page)
  expect(errors).toEqual([])
})
