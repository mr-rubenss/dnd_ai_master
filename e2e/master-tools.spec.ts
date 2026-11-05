// Инструменты ведущего: модель предлагает вызовы, движок проверяет и исполняет, результаты уходят модели,
// затем — финальный текст. API поставщика подменяется (page.route), броски — через installRngQueue.
import type { Page, Route } from '@playwright/test'
import { expect, test } from './fixtures'
import { collectPageErrors, expectNoHorizontalScroll, face, installRngQueue, queueRolls, startQuickGame } from './helpers'

const KEY = 'sk-e2e-fake-key-123456'
const API = 'https://api.deepseek.com/chat/completions'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'POST' }

const sse = (events: unknown[]) => events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('')
const delta = (d: Record<string, unknown>, finish: string | null = null) => ({ choices: [{ index: 0, delta: d, finish_reason: finish }] })
const toolCall = (index: number, id: string, name: string, args: unknown) =>
  delta({ tool_calls: [{ index, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })

type Body = { messages: { role: string; content: string | null; tool_call_id?: string }[]; tools?: { function: { name: string } }[]; tool_choice?: string }

/** Подменённый API: ответы по очереди; возвращает тела запросов. */
async function mockRounds(page: Page, rounds: string[]) {
  const bodies: Body[] = []
  await page.route(API, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    bodies.push(route.request().postDataJSON() as Body)
    await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: rounds.shift() ?? sse([delta({ content: '…' }, 'stop')]) })
  })
  return bodies
}

test.beforeEach(async ({ page }) => {
  await installRngQueue(page)
  await page.addInitScript((key) => localStorage.setItem('ai-master:api-key', key), KEY)
})

test('ход с инструментами: проверка — карточкой в ленте, обстановка на карте, недопустимый вызов отклонён, финальный текст', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page)
  const bodies = await mockRounds(page, [
    sse([
      delta({ content: 'Ты разбегаешься и бьёшь плечом в дверь кладовой.' }),
      toolCall(0, 'c1', 'request_check', { skill: 'athletics', dc: 15, reason: 'выбить дверь кладовой' }),
      toolCall(1, 'c2', 'remove_item', { item: 'dagger' }),
      delta({}, 'tool_calls'),
      '[DONE]',
    ]),
    sse([
      toolCall(0, 'c3', 'set_door', { door: 'storage-door', state: 'open' }),
      toolCall(1, 'c4', 'add_object', { name: 'Щепки от двери', type: 'debris', x: 14, y: 2, description: 'Обломки двери кладовой.' }),
      toolCall(2, 'c5', 'note_fact', { text: 'Ратибор выломал дверь кладовой.' }),
      delta({}, 'tool_calls'),
      '[DONE]',
    ]),
    sse([delta({ content: 'Замок с треском вылетает. ' }), delta({ content: 'Гуннар роняет кружку: — Ты что творишь?!' }, 'stop'), '[DONE]']),
  ])
  await page.goto('./')
  await startQuickGame(page)
  await expect(page.getByTestId('door-storage-door')).toHaveAttribute('data-state', 'locked')

  await queueRolls(page, [face(14, 20)])
  await page.locator('.player-input textarea').fill('Выбиваю дверь кладовой')
  await page.locator('.player-input textarea').press('Enter')

  // Финальный текст ведущего.
  await expect(page.locator('.message--master').last()).toHaveText(/Гуннар роняет кружку: — Ты что творишь\?!/)
  // Рассказ перед броском, карточка проверки, финал — по порядку.
  const card = page.getByTestId('check-card')
  await expect(card).toHaveCount(1)
  await expect(card).toContainText('Ратибор: Сила (Атлетика)')
  await expect(card).toContainText('Сл 15')
  await expect(card).toContainText('выбить дверь кладовой')
  await expect(card.getByTestId('check-total')).toHaveText('= 19')
  await expect(card).toContainText('Успех')
  const feed = await page.locator('.narration-log > article').evaluateAll((els) => els.slice(-3).map((e) => e.className))
  expect(feed[0]).toContain('message--master')
  expect(feed[1]).toContain('check-card')
  expect(feed[2]).toContain('message--master')

  // Изменения на карте — через инструменты.
  await expect(page.getByTestId('door-storage-door')).toHaveAttribute('data-state', 'open')
  await expect(page.locator('[data-testid^="object-obj-"]')).toHaveAttribute('data-type', 'debris')

  // Модель получила результаты: бросок и отказ «нет кинжала»; инструменты описаны в запросе.
  expect(bodies).toHaveLength(3)
  expect(bodies[0].tools?.map((t) => t.function.name)).toEqual(expect.arrayContaining(['request_check', 'remove_item', 'add_object', 'note_fact']))
  const results = bodies[1].messages.filter((m) => m.role === 'tool')
  expect(JSON.parse(results[0].content!)).toMatchObject({ ok: true, success: true, total: 19, natural: 14 })
  expect(JSON.parse(results[1].content!)).toEqual({ ok: false, error: 'У героя нет предмета «Кинжал».' })
  expect(bodies[2].messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content!).ok)).toEqual([true, false, true, true, true])
  await expectNoHorizontalScroll(page)
  await testInfo.attach('ход с инструментами', { body: await page.screenshot(), contentType: 'image/png' })

  // После перезагрузки всё на месте: история — из журнала действий.
  await page.evaluate(() => (window as unknown as { __aiMaster: { flush(): Promise<void> } }).__aiMaster.flush())
  await page.reload()
  await page.getByTestId('menu-continue').click()
  await expect(page.getByTestId('check-card')).toHaveCount(1)
  await expect(page.getByTestId('door-storage-door')).toHaveAttribute('data-state', 'open')
  expect(errors).toEqual([])
})

test('урон и состояние — в листе героя; провал проверки — карточкой', async ({ page, isMobile }) => {
  await mockRounds(page, [
    sse([
      toolCall(0, 'a', 'request_check', { ability: 'dex', saving_throw: true, dc: 18, reason: 'увернуться от падающей люстры' }),
      delta({}, 'tool_calls'),
      '[DONE]',
    ]),
    sse([
      toolCall(0, 'b', 'change_hp', { kind: 'damage', amount: 5, damage_type: 'bludgeoning', source: 'люстра' }),
      toolCall(1, 'c', 'add_condition', { condition: 'prone' }),
      delta({}, 'tool_calls'),
      '[DONE]',
    ]),
    sse([delta({ content: 'Люстра обрушивается тебе на плечи и сбивает с ног.' }, 'stop'), '[DONE]']),
  ])
  await page.goto('./')
  await startQuickGame(page)
  await queueRolls(page, [face(4, 20)])
  await page.locator('.player-input textarea').fill('Стою под люстрой')
  await page.locator('.player-input textarea').press('Enter')
  await expect(page.locator('.message--master').last()).toHaveText(/сбивает с ног/)
  const card = page.getByTestId('check-card')
  await expect(card).toHaveAttribute('data-success', 'false')
  await expect(card).toContainText('Спасбросок Ловкости')
  await expect(card).toContainText('Провал')
  if (isMobile) await page.locator('.inventory-toggle').click()
  await expect(page.locator('.inventory-panel')).toContainText('7 / 12')
})
