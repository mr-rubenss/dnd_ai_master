// Переходы между картами: «Выйти» через входную дверь таверны → ведущий получает событие, создаёт улицу
// (create_location) и переводит отряд (travel) → новая карта, герой у входа, путь над картой и туман обновлены;
// обратно — через выход улицы (карта есть — переходит движок, ведущий только описывает). Ответы ИИ подменены.
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

const street = {
  id: 'griffin-street',
  name: 'Улица у таверны',
  description: 'Грязная улица под фонарём.',
  cellFeet: 5,
  width: 12,
  height: 8,
  floor: 'dirt',
  wallMaterial: 'stone',
  rooms: [{ id: 'street', name: 'Улица', x: 0, y: 0, w: 12, h: 8 }],
  objects: [{ id: 'cart', type: 'debris', name: 'Сломанная телега', x: 3, y: 4, w: 2 }],
  npcs: [{ id: 'beggar', name: 'Нищий', x: 8, y: 2 }],
  exits: [
    { id: 'to-tavern', kind: 'road', name: 'Дверь таверны', x: 5, y: 7, to: 'drunken-griffin', toExit: 'tavern-door' },
    { id: 'east-road', kind: 'edge', name: 'Дорога на восток', x: 11, y: 4 },
  ],
  playerStart: { x: 5, y: 6 },
}

const hero = (page: Page) => page.getByTestId('player-token')
const lastUser = (b: Body) => [...b.messages].reverse().find((m) => m.role === 'user')?.content ?? ''

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem('ai-master:api-key', key), KEY)
})

test('выход из таверны: ведущий создаёт улицу и переводит отряд; путь и туман обновляются; обратно — та же таверна', async ({ page, isMobile }, testInfo) => {
  const errors = collectPageErrors(page)
  const bodies = await mockMaster(page, [
    tool('create_location', { location: street }),
    tool('travel', { exit: 'tavern-door', to: 'griffin-street' }),
    say('Ты выходишь на грязную улицу; у стены дремлет нищий.'),
    say('Ты снова в шумной таверне.'),
  ])
  const press = async (testId: string) => (isMobile ? page.getByTestId(testId).tap() : page.getByTestId(testId).click())
  await page.goto('./')
  await startQuickGame(page)
  await expect(page.getByTestId('map-trail')).toHaveCount(0)
  await expect(page.getByTestId('fog-hidden')).toHaveCount(1)

  // Входная дверь — выход: в меню «Выйти».
  await press('door-entrance')
  const menu = page.getByTestId('map-actions')
  await menu.getByRole('button', { name: 'Выйти' }).click()

  // Ведущий получил событие «карты нет» → создал улицу и перевёл отряд → описал.
  await expect(page.locator('.message--master').last()).toContainText('у стены дремлет нищий')
  expect(lastUser(bodies[0])).toContain('Карты места за ним ещё нет')
  expect(lastUser(bodies[0])).toContain('toExit: "tavern-door"')
  await expect(page.locator('.map-panel h2')).toHaveText('Улица у таверны')
  await expect(page.locator('.map-svg')).toHaveAttribute('aria-label', 'Карта: Улица у таверны')
  // Герой у входа новой карты — у выхода, ведущего обратно.
  await expect(hero(page)).toHaveAttribute('data-x', '5')
  await expect(hero(page)).toHaveAttribute('data-y', '7')
  // Путь вверху и туман — по новой карте.
  await expect(page.getByTestId('map-trail').locator('li')).toHaveText(['Таверна «Пьяный грифон»', 'Улица у таверны'])
  await expect(page.getByTestId('fog-hidden')).toHaveCount(0)
  await expect(page.getByTestId('npc-beggar')).toBeVisible()
  await expect(page.getByTestId('exit-east-road')).toHaveAttribute('data-kind', 'edge')
  await expectNoHorizontalScroll(page)
  await testInfo.attach('улица', { body: await page.locator('.map-panel').screenshot(), contentType: 'image/png' })

  // Обратно: карта таверны есть — переходит движок, ведущему — событие «опиши новое место».
  await press('exit-to-tavern')
  await menu.getByRole('button', { name: 'Выйти' }).click()
  await expect(page.locator('.message--master').last()).toContainText('снова в шумной таверне')
  expect(lastUser(bodies.at(-1)!)).toContain('Отряд перешёл через выход «Дверь таверны»')
  await expect(page.locator('.map-panel h2')).toHaveText('Таверна «Пьяный грифон»')
  await expect(hero(page)).toHaveAttribute('data-x', '10')
  await expect(hero(page)).toHaveAttribute('data-y', '13')
  await expect(page.getByTestId('map-trail').locator('li')).toHaveText(['Таверна «Пьяный грифон»', 'Улица у таверны', 'Таверна «Пьяный грифон»'])
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
