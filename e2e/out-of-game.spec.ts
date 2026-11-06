// Режим «Вне игры»: вопрос мастеру — не ход. Ответ приглушён с пометкой «вне игры», время и лист не меняются,
// инструменты (advance_time, rest…) движок отклоняет. API поставщика подменяется (page.route).
import type { Page, Route } from '@playwright/test'
import { expect, test } from './fixtures'
import { collectPageErrors, expectNoHorizontalScroll, startQuickGame, withEndTurn } from './helpers'

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

async function ask(page: Page, text: string) {
  await page.getByTestId('input-mode').locator('[data-mode="question"]').click()
  await expect(page.getByRole('textbox', { name: 'Вопрос мастеру' })).toBeVisible()
  await page.locator('.player-input textarea').fill(text)
  await page.locator('.player-input textarea').press('Enter')
}

test('вопрос мастеру: ответ вне игры приглушён, ведущий пытается двинуть время и отдохнуть — движок отказывает', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page)
  await page.addInitScript((key) => localStorage.setItem('ai-master:api-key', key), KEY)
  const bodies = await mockRounds(page, [
    sse([
      toolCall(0, 't1', 'advance_time', { minutes: 120, reason: 'пока объясняю' }),
      toolCall(1, 't2', 'rest', { kind: 'long' }),
      delta({}, 'tool_calls'),
      '[DONE]',
    ]),
    sse([delta({ content: 'Преимущество: бросаешь два к20 и берёшь больший результат.' }, 'stop'), '[DONE]']),
  ])
  await page.goto('./')
  await startQuickGame(page)
  const clock = page.getByTestId('game-clock')
  const before = await clock.getAttribute('aria-label')

  await ask(page, 'Как работает преимущество?')
  const answer = page.locator('.message--master.message--ooc').last()
  await expect(answer).toContainText('берёшь больший результат')
  await expect(answer.getByTestId('ooc-badge')).toHaveText('вне игры')
  await expect(page.locator('.message--player.message--ooc').last()).toContainText('Как работает преимущество?')
  // Время не сдвинулось, строки изменений нет, подсказок нет; режим вернулся к «Действию героя».
  await expect(clock).toHaveAttribute('aria-label', before!)
  await expect(page.getByTestId('turn-changes')).toHaveCount(0)
  await expect(page.getByTestId('suggestions')).toHaveCount(0)
  await expect(page.getByTestId('input-mode').locator('[data-mode="action"]')).toHaveAttribute('aria-checked', 'true')

  // Ведущий получил вопрос с пометкой и отказы движка.
  expect(bodies[0].messages.at(-1)?.content).toBe('[Вопрос вне игры] Как работает преимущество?')
  const results = bodies[1].messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content!))
  expect(results.map((r) => r.ok)).toEqual([false, false])
  expect(results[0].error).toMatch(/вопрос вне игры/)
  await expectNoHorizontalScroll(page)
  await testInfo.attach('вопрос вне игры', { body: await page.screenshot(), contentType: 'image/png' })
  expect(errors).toEqual([])
})

test('без ведущего: вопрос вне игры получает заглушку с пометкой, в игре — обычный ответ', async ({ page }) => {
  await page.goto('./')
  await startQuickGame(page)
  await ask(page, 'Что мы знаем о человеке в капюшоне?')
  await expect(page.locator('.message--master').last()).toHaveAttribute('data-ooc', 'true')
  await page.locator('.player-input textarea').fill('Подхожу к стойке')
  await page.locator('.player-input textarea').press('Enter')
  await expect(page.locator('.message--player').last()).not.toHaveAttribute('data-ooc', 'true')
  await expect(page.locator('.message--master').last()).not.toHaveAttribute('data-ooc', 'true')
  await expectNoHorizontalScroll(page)
})
