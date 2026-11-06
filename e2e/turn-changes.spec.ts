// Всё, что ведущий рассказал, отражается в листе: оплата эля (сдача с золотого), забытый инструмент — довызов
// после end_turn, нехватка денег — отказ движка. После ответа — строка изменений, в листе значение подсвечивается.
// API подменяется (page.route).
import type { Page, Route } from '@playwright/test'
import { expect, test } from './fixtures'
import { collectPageErrors, expectNoHorizontalScroll, startQuickGame } from './helpers'

const KEY = 'sk-e2e-fake-key-123456'
const DEEPSEEK = 'https://api.deepseek.com/chat/completions'
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'POST',
}

type Body = { messages: { role: string; content: string | null }[]; tools?: { function: { name: string } }[] }
type Call = [name: string, args: unknown]

const sse = (events: unknown[]) => events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('')
/** Ответ модели: текст и вызовы инструментов (в том числе end_turn). */
const reply = (text: string, calls: Call[] = []) =>
  sse([
    ...(text ? [{ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }] : []),
    ...calls.map(([name, args], index) => ({
      choices: [{ index: 0, delta: { tool_calls: [{ index, id: `c${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: null }],
    })),
    { choices: [{ index: 0, delta: {}, finish_reason: calls.length ? 'tool_calls' : 'stop' }] },
    '[DONE]',
  ])

async function mockApi(page: Page, replies: string[]) {
  const bodies: Body[] = []
  await page.route(DEEPSEEK, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    bodies.push(route.request().postDataJSON() as Body)
    await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: replies.shift() ?? reply('…', [['end_turn', { changes: [] }]]) })
  })
  return bodies
}

async function send(page: Page, text: string) {
  await page.locator('.player-input textarea').fill(text)
  await page.locator('.player-input textarea').press('Enter')
}

async function openSheet(page: Page, isMobile: boolean) {
  if (isMobile && (await page.locator('.inventory-toggle').getAttribute('aria-expanded')) !== 'true') await page.locator('.inventory-toggle').tap()
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem('ai-master:api-key', key), KEY)
})

test('оплата эля: строка изменений «−4 мм (эль)», кошелёк со сдачей подсвечивается', async ({ page, isMobile }, testInfo) => {
  const errors = collectPageErrors(page)
  await mockApi(page, [
    reply('Ты кладёшь на стойку монету, Гуннар отсчитывает сдачу и наливает пенный эль.', [
      ['change_gold', { price: 'ale-mug', reason: 'эль' }],
      ['end_turn', { changes: [{ kind: 'money', amount: -4, currency: 'cp' }] }],
    ]),
  ])
  await page.goto('./')
  await startQuickGame(page)
  await openSheet(page, isMobile)
  await expect(page.getByTestId('purse')).toHaveText('18 зм')
  await send(page, 'Заказываю кружку эля и плачу.')

  const line = page.getByTestId('turn-changes').last()
  await expect(line).toHaveText('−4 мм (эль)')
  await expect(line.locator('.turn-change')).toHaveClass(/is-loss/)
  await expect(page.locator('.message--master').last()).toContainText('наливает пенный эль')
  await expect(page.getByTestId('purse')).toHaveText('17 зм 9 см 6 мм')
  await expect(page.getByTestId('purse')).toHaveClass(/value-flash/)
  if (isMobile) await expectNoHorizontalScroll(page)
  await line.scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
  await testInfo.attach('строка изменений', { body: await page.screenshot(), contentType: 'image/png' })
  expect(errors).toEqual([])
})

test('ведущий забыл инструмент: заявил выстрел в end_turn — довызов use_item, «−1 стрела»; в журнале разработчика — сверка', async ({ page, isMobile }) => {
  const bodies = await mockApi(page, [
    reply('Ты натягиваешь тетиву и пускаешь стрелу точно в центр мишени.', [['end_turn', { changes: [{ kind: 'item', item: 'arrow', amount: -1 }] }]]),
    reply('', [
      ['use_item', { item: 'arrow', reason: 'выстрел' }],
      ['end_turn', { changes: [{ kind: 'item', item: 'arrow', amount: -1 }] }],
    ]),
  ])
  await page.goto('./')
  await startQuickGame(page)
  await send(page, 'Стреляю из лука в мишень.')
  await expect(page.getByTestId('turn-changes').last()).toHaveText('−1 стрела')
  // Рассказ один — довызов текста не добавил.
  await expect(page.locator('.message--master', { hasText: 'пускаешь стрелу' })).toHaveCount(1)
  const retry = bodies[1].messages.at(-1)!
  expect(retry.role).toBe('tool')
  expect(retry.content).toContain('вызови use_item')
  await openSheet(page, isMobile)
  await page.getByRole('tab', { name: 'Снаряжение' }).click()
  await expect(page.locator('[data-item="arrow"] .item-qty, li:has-text("Стрела") .item-qty').first()).toContainText('×19')

  if (isMobile) await page.locator('.inventory-toggle').tap()
  await page.getByTestId('settings-open').click()
  const panel = page.getByTestId('settings-panel')
  await panel.getByTestId('settings-tab-master').click()
  await panel.getByTestId('dev-log').locator('summary').click()
  await expect(panel.getByTestId('dev-log-verify').first()).toHaveAttribute('data-status', 'fixed')
  await expect(panel.locator('[data-testid="dev-log-tool"][data-tool="use_item"]')).toContainText('выполнен')
})

test('денег не хватает: движок отказывает, ведущий обыгрывает — кошелёк прежний, строки изменений нет', async ({ page, isMobile }) => {
  const bodies = await mockApi(page, [
    reply('Ты просишь у Гуннара лучшие покои на неделю.', [
      ['change_gold', { price: 'inn-aristocratic', quantity: 7, reason: 'покои' }],
      ['end_turn', { changes: [{ kind: 'money', amount: -28, currency: 'gp' }] }],
    ]),
    reply('Гуннар пересчитывает твои монеты и качает головой: — Не хватает, приятель. Могу предложить чердак.', [['end_turn', { changes: [] }]]),
  ])
  await page.goto('./')
  await startQuickGame(page)
  await send(page, 'Снимаю лучшие покои на неделю.')
  await expect(page.locator('.message--master').last()).toContainText('Не хватает, приятель')
  expect(bodies[1].messages.some((m) => m.role === 'tool' && (m.content ?? '').includes('Денег не хватает'))).toBe(true)
  await expect(page.getByTestId('turn-changes')).toHaveCount(0)
  await openSheet(page, isMobile)
  await expect(page.getByTestId('purse')).toHaveText('18 зм')
})
