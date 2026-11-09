// Переходы между картами: «Выйти» через входную дверь таверны → движок строит каркас окрестностей и переводит отряд,
// ведущий дополняет карту (объекты, эффекты, НПС, выходы) → новая карта, герой у нарисованной двери, путь над картой;
// обратно — через нарисованную дверь (карта есть — переходит движок, ведущий только описывает). Ответы ИИ подменены.
import type { Page, Route } from '@playwright/test'
import { expect, test } from './fixtures'
import { collectPageErrors, expectNoHorizontalScroll, reloadAndContinue, startQuickGame, withEndTurn } from './helpers'

const KEY = 'sk-e2e-fake-key-travel'
const API = 'https://api.deepseek.com/chat/completions'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'POST' }
const sse = (events: unknown[]) => events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('')
const delta = (d: Record<string, unknown>, finish: string | null = null) => ({ choices: [{ index: 0, delta: d, finish_reason: finish }] })
const tool = (name: string, args: unknown) =>
  sse([delta({ tool_calls: [{ index: 0, id: `c-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }), delta({}, 'tool_calls'), '[DONE]'])
const say = (text: string) => sse([delta({ content: text }, 'stop'), '[DONE]'])
type Body = { messages: { role: string; content: string | null }[] }

async function mockMaster(page: Page, rounds: string[]) {
  const bodies: Body[] = []
  await page.route(API, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    bodies.push(route.request().postDataJSON() as Body)
    await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: withEndTurn(route, rounds.shift() ?? say('Тихо.')) })
  })
  return bodies
}

const lastUser = (b: Body) => [...b.messages].reverse().find((m) => m.role === 'user')?.content ?? ''

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem('ai-master:api-key', key), KEY)
})

test('выход из таверны: движок строит окрестности, ведущий их дополняет; путь и туман обновляются; обратно — та же таверна', async ({ page, isMobile }, testInfo) => {
  const errors = collectPageErrors(page)
  const bodies = await mockMaster(page, [
    // Модель только дополняет каркас: повозка, лужа, прохожий, тропа.
    tool('add_object', { name: 'Повозка с сеном', type: 'debris', x: 24, y: 30, w: 2 }),
    tool('add_effect', { kind: 'puddle', x: 34, y: 29, w: 2, h: 1, name: 'Лужа' }),
    tool('add_npc', { name: 'Нищий', x: 36, y: 31, description: 'Дремлет у забора.' }),
    tool('add_exit', { kind: 'edge', name: 'Тропа к мельнице', x: 45, y: 41 }),
    say('Ты выходишь на улицу: у забора дремлет нищий, рядом блестит лужа.'),
    say('Ты снова в шумной таверне.'),
  ])
  const press = async (testId: string) => (isMobile ? page.getByTestId(testId).tap() : page.getByTestId(testId).click())
  await page.goto('./')
  await startQuickGame(page)
  await expect(page.getByTestId('map-trail')).toHaveCount(0)
  await expect(page.getByTestId('fog-hidden')).toHaveCount(1)

  // Входная дверь — выход: «Выйти». Карты снаружи нет — каркас строит движок сразу, без ведущего.
  await press('door-entrance')
  const menu = page.getByTestId('map-actions')
  await menu.getByRole('button', { name: 'Выйти' }).click()
  await expect(page.locator('.map-panel h2')).toHaveText('Снаружи: Таверна «Пьяный грифон»')
  await expect(page.locator('.map-svg')).toHaveAttribute('aria-label', 'Карта: Снаружи: Таверна «Пьяный грифон»')
  // Герой у нарисованной входной двери снаружи; дверь на месте.
  await expect(page.getByTestId('player-token')).toHaveAttribute('data-x', '30')
  await expect(page.getByTestId('player-token')).toHaveAttribute('data-y', '28')
  await expect(page.getByTestId('door-drunken-griffin-door')).toHaveCount(1)
  // Ведущему — «каркас построен, дополни».
  await expect(page.locator('.message--master').last()).toContainText('у забора дремлет нищий')
  expect(lastUser(bodies[0])).toContain('Карту окрестностей построил движок')
  // Дополнения модели на карте: прохожий, лужа (эффект), повозка, тропа (значок выхода).
  await expect(page.locator('[data-testid^="npc-"][data-x="36"][data-y="31"]')).toHaveCount(1)
  await expect(page.locator('[data-testid^="effect-"][data-kind="puddle"]')).toHaveCount(1)
  await expect(page.locator('[data-testid^="object-"][data-x="24"][data-y="30"]')).toHaveCount(1)
  await expect(page.locator('[data-testid^="exit-"][data-x="45"][data-y="41"]')).toHaveCount(1)
  // Путь вверху — по новой карте.
  await expect(page.getByTestId('map-trail').locator('li')).toHaveText(['Таверна «Пьяный грифон»', 'Снаружи: Таверна «Пьяный грифон»'])
  await expectNoHorizontalScroll(page)
  await testInfo.attach('окрестности таверны', { body: await page.locator('.map-panel').screenshot(), contentType: 'image/png' })

  // Обратно — через нарисованную дверь: «Выйти» в её меню; карта таверны есть — переходит движок.
  await press('door-drunken-griffin-door')
  await menu.getByRole('button', { name: 'Выйти' }).click()
  await expect(page.locator('.message--master').last()).toContainText('снова в шумной таверне')
  expect(lastUser(bodies.at(-1)!)).toContain('Отряд перешёл через выход «Входная дверь (Таверна «Пьяный грифон»)»')
  await expect(page.locator('.map-panel h2')).toHaveText('Таверна «Пьяный грифон»')
  await expect(page.getByTestId('player-token')).toHaveAttribute('data-x', '10')
  await expect(page.getByTestId('player-token')).toHaveAttribute('data-y', '13')
  await expect(page.getByTestId('map-trail').locator('li')).toHaveText(['Таверна «Пьяный грифон»', 'Снаружи: Таверна «Пьяный грифон»', 'Таверна «Пьяный грифон»'])
  // Та же таверна: кладовая по-прежнему под туманом, Гуннар на месте.
  await expect(page.getByTestId('fog-hidden')).toHaveCount(1)
  await expect(page.getByTestId('npc-gunnar')).toBeVisible()

  // Всё — действия истории: после перезагрузки путь и место те же.
  await reloadAndContinue(page)
  await expect(page.locator('.map-panel h2')).toHaveText('Таверна «Пьяный грифон»')
  await expect(page.getByTestId('map-trail').locator('li')).toHaveCount(3)
  expect(errors).toEqual([])
})

test('запертая входная дверь — выйти нельзя, причина на карте', async ({ page, isMobile }) => {
  await mockMaster(page, [])
  await page.goto('./')
  await startQuickGame(page)
  await page.evaluate(() =>
    (window as unknown as { __aiMaster: { dispatch(e: unknown, a: unknown): string | null } }).__aiMaster.dispatch(
      { type: 'doorChanged', locationId: 'drunken-griffin', doorId: 'entrance', state: 'locked' },
      { kind: 'master' },
    ),
  )
  if (isMobile) await page.getByTestId('door-entrance').tap()
  else await page.getByTestId('door-entrance').click()
  await page.getByTestId('map-actions').getByRole('button', { name: 'Выйти' }).click()
  await expect(page.getByTestId('map-notice')).toHaveText('«Входная дверь» заперта — сначала её нужно отпереть.')
  await expect(page.locator('.map-panel h2')).toHaveText('Таверна «Пьяный грифон»')
})
