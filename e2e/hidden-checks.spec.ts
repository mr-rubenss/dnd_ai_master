// Скрытые и пассивные проверки: движок бросает, но игрок не видит карточки и цифр — только рассказ ведущего;
// бросок виден в журнале разработчика. API поставщика подменяется (page.route), броски — через installRngQueue.
import type { Page, Route } from '@playwright/test'
import { expect, test } from './fixtures'
import { collectPageErrors, expectNoHorizontalScroll, face, installRngQueue, queueRolls, startQuickGame, withEndTurn } from './helpers'

const KEY = 'sk-e2e-fake-key-123456'
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

test.beforeEach(async ({ page }) => {
  await installRngQueue(page)
  await page.addInitScript((key) => localStorage.setItem('ai-master:api-key', key), KEY)
})

test('скрытая проверка: ни карточки, ни кубиков — только рассказ; бросок в журнале разработчика', async ({ page, isMobile }, testInfo) => {
  const errors = collectPageErrors(page)
  const bodies = await mockRounds(page, [
    sse([
      toolCall(0, 'h1', 'request_check', { skill: 'perception', dc: 14, reason: 'вор в капюшоне тянется к кошельку', hidden: true }),
      toolCall(1, 'p1', 'request_check', { skill: 'perception', dc: 12, reason: 'растяжка у двери погреба', passive: true }),
      delta({}, 'tool_calls'),
      '[DONE]',
    ]),
    sse([delta({ content: 'Гуннар ставит перед тобой кружку эля. Краем глаза ты замечаешь чужую руку у своего пояса.' }, 'stop'), '[DONE]']),
  ])
  await page.goto('./')
  await startQuickGame(page)
  // к20 → 15: Внимательность +3 → 18 против Сл 14.
  await queueRolls(page, [face(15, 20)])
  await page.locator('.player-input textarea').fill('Заказываю эль у стойки')
  await page.locator('.player-input textarea').press('Enter')

  await expect(page.locator('.message--master').last()).toContainText('чужую руку у своего пояса')
  await expect(page.getByTestId('check-card')).toHaveCount(0)
  await expect(page.locator('.dice-overlay')).toHaveCount(0)
  await expect(page.locator('.narration-log')).not.toContainText('Сл 14')

  // Ведущий получил результаты: скрытый бросок и пассивную проверку без броска.
  const results = bodies[1].messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content!))
  expect(results[0]).toMatchObject({ ok: true, hidden: true, total: 18, success: true })
  expect(results[1]).toMatchObject({ ok: true, passive: 13, success: true })
  await expectNoHorizontalScroll(page)
  await testInfo.attach('скрытая проверка', { body: await page.screenshot(), contentType: 'image/png' })

  // Журнал разработчика: бросок с числами виден.
  await page.getByTestId('settings-open').click()
  const panel = page.getByTestId('settings-panel')
  await panel.getByTestId('settings-tab-master').click()
  await panel.getByTestId('dev-log').locator('summary').click()
  const tools = panel.locator('[data-testid="dev-log-tool"][data-tool="request_check"]')
  await expect(tools.filter({ hasText: 'Скрытая проверка (игрок не видит): Мудрость (Внимательность), Сл 14: 18 — успех' })).toHaveCount(1)
  await expect(tools.filter({ hasText: 'пассивная Внимательность 13 против Сл 12 — успех' })).toHaveCount(1)
  if (isMobile) await expectNoHorizontalScroll(page)
  expect(errors).toEqual([])
})
