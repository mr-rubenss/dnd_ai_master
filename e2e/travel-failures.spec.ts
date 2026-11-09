// Выход из таверны при разных ответах ведущего (подменённый API): карта должна смениться или игра должна честно
// сказать, что не сменилась, и предложить «Повторить». Варианты: создание + переход; только текст; невалидная карта
// (исправлена со второй попытки — отдельным раундом и в одном ответе с end_turn; не исправлена совсем); travel
// в несуществующую локацию; возврат в таверну и повторный выход.
import type { Page, Route } from '@playwright/test'
import { expect, test } from './fixtures'
import { collectPageErrors, startQuickGame, withEndTurn } from './helpers'

const KEY = 'sk-e2e-fake-key-travel-failures'
const API = 'https://api.deepseek.com/chat/completions'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'POST' }
const sse = (events: unknown[]) => events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('')
const delta = (d: Record<string, unknown>, finish: string | null = null) => ({ choices: [{ index: 0, delta: d, finish_reason: finish }] })
/** Ответ модели: несколько вызовов инструментов в одном сообщении (end_turn — тоже вызов). */
const tools = (...calls: [string, unknown][]) =>
  sse([delta({ tool_calls: calls.map(([name, args], index) => ({ index, id: `c${index}-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })) }), delta({}, 'tool_calls'), '[DONE]'])
const say = (text: string) => sse([delta({ content: text }, 'stop'), '[DONE]'])
type Body = { messages: { role: string; content: string | null }[] }

async function mockMaster(page: Page, rounds: string[], fallback = say('Тихо.')) {
  const bodies: Body[] = []
  await page.route(API, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    bodies.push(route.request().postDataJSON() as Body)
    await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: withEndTurn(route, rounds.shift() ?? fallback) })
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
  exits: [{ id: 'to-tavern', kind: 'road', name: 'Дверь таверны', x: 5, y: 7, to: 'drunken-griffin', toExit: 'tavern-door' }],
  playerStart: { x: 5, y: 6 },
}
/** Невалидная карта: телега за границей, наложение бочек, нет выхода. */
const broken = {
  ...street,
  exits: [],
  objects: [
    { id: 'cart', type: 'debris', name: 'Телега', x: 11, y: 4, w: 2 },
    { id: 'b1', type: 'barrel', name: 'Бочка', x: 2, y: 2 },
    { id: 'b2', type: 'barrel', name: 'Бочка', x: 2, y: 2 },
  ],
}
const END = ['end_turn', { changes: [] }] as [string, unknown]

const heading = (page: Page) => page.locator('.map-panel h2')
const toolText = (b: Body) => b.messages.filter((m) => m.role === 'tool').map((m) => m.content ?? '').join('\n')
const lastUser = (b: Body) => [...b.messages].reverse().find((m) => m.role === 'user')?.content ?? ''

async function pressExit(page: Page, isMobile: boolean, testId = 'door-entrance') {
  if (isMobile) await page.getByTestId(testId).tap()
  else await page.getByTestId(testId).click()
  await page.getByTestId('map-actions').getByRole('button', { name: 'Выйти' }).click()
}
async function send(page: Page, text: string) {
  await page.locator('.player-input textarea').fill(text)
  await page.locator('.player-input textarea').press('Enter')
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem('ai-master:api-key', key), KEY)
})

test('создание карты и переход — в одном ответе с end_turn: карта сменилась', async ({ page, isMobile }) => {
  const errors = collectPageErrors(page)
  await mockMaster(page, [tools(['create_location', { location: street }], ['travel', { exit: 'tavern-door', to: 'griffin-street' }], END), say('Улица.')])
  await page.goto('./')
  await startQuickGame(page)
  await pressExit(page, isMobile)
  await expect(heading(page)).toHaveText('Улица у таверны')
  await expect(page.getByTestId('player-token')).toHaveAttribute('data-y', '7')
  expect(errors).toEqual([])
})

test('ведущий ответил только текстом — сверка просит create_location и travel, карта сменилась', async ({ page, isMobile }) => {
  const bodies = await mockMaster(page, [
    say('Ты выходишь на улицу: под фонарём дремлет нищий.'),
    tools(['create_location', { location: street }]),
    tools(['travel', { exit: 'tavern-door', to: 'griffin-street' }]),
    say('Улица перед тобой.'),
  ])
  await page.goto('./')
  await startQuickGame(page)
  await pressExit(page, isMobile)
  await expect(heading(page)).toHaveText('Улица у таверны')
  expect(lastUser(bodies[1])).toContain('create_location')
  expect(lastUser(bodies[1])).toContain('travel')
})

test('невалидная карта в одном ответе с end_turn: ведущий видит ошибки и исправляет со второй попытки', async ({ page, isMobile }) => {
  const bodies = await mockMaster(page, [
    tools(['create_location', { location: broken }], END),
    tools(['create_location', { location: street }], ['travel', { exit: 'tavern-door', to: 'griffin-street' }], END),
    say('Улица.'),
  ])
  await page.goto('./')
  await startQuickGame(page)
  await pressExit(page, isMobile)
  await expect(heading(page)).toHaveText('Улица у таверны')
  const errorsSent = toolText(bodies[1])
  expect(errorsSent).toContain('exits: нужно хотя бы 1')
  // К ошибкам схемы — короткий пример верной минимальной локации.
  expect(errorsSent).toContain('Пример минимальной локации')
})

test('невалидная карта отдельным раундом: ошибки списком с объектом за границей и наложением, исправлено со второй попытки', async ({ page, isMobile }) => {
  const bodies = await mockMaster(page, [
    tools(['create_location', { location: { ...broken, exits: street.exits } }]),
    tools(['create_location', { location: street }]),
    tools(['travel', { exit: 'tavern-door', to: 'griffin-street' }]),
    say('Улица.'),
  ])
  await page.goto('./')
  await startQuickGame(page)
  await pressExit(page, isMobile)
  await expect(heading(page)).toHaveText('Улица у таверны')
  const errorsSent = toolText(bodies[1])
  expect(errorsSent).toContain('выходит за пределы карты')
  expect(errorsSent).toContain('Пример минимальной локации')
})

test('ведущий так и не создал карту — через 2 хода сообщение и «Повторить», повтор доводит до перехода', async ({ page, isMobile }) => {
  const bodies = await mockMaster(page, [], tools(['create_location', { location: broken }], END))
  await page.goto('./')
  await startQuickGame(page)
  await pressExit(page, isMobile)
  await expect.poll(() => bodies.length).toBeGreaterThan(0)
  await expect(page.locator('.player-input textarea')).toBeEnabled()
  // Первый ход — без перехода, сообщения ещё нет.
  await expect(page.getByTestId('travel-stuck')).toHaveCount(0)
  await send(page, 'Жду.')
  // Второй ход — карта так и не сменилась: понятное сообщение и «Повторить».
  const stuck = page.getByTestId('travel-stuck')
  await expect(stuck).toBeVisible()
  await expect(stuck).toContainText('Карта не сменилась')
  await expect(heading(page)).toHaveText('Таверна «Пьяный грифон»')
  // «Повторить» — новый запрос ведущему на создание карты; теперь он справляется.
  await page.unroute(API)
  await mockMaster(page, [tools(['create_location', { location: street }], ['travel', { exit: 'tavern-door', to: 'griffin-street' }], END), say('Улица.')])
  await stuck.getByRole('button', { name: 'Повторить' }).click()
  await expect(heading(page)).toHaveText('Улица у таверны')
  await expect(page.getByTestId('travel-stuck')).toHaveCount(0)
  expect(bodies.length).toBeGreaterThan(0)
})

test('travel в несуществующую локацию — отказ с подсказкой, ведущий создаёт и переходит', async ({ page, isMobile }) => {
  const bodies = await mockMaster(page, [
    tools(['travel', { exit: 'tavern-door', to: 'market-square' }]),
    tools(['create_location', { location: street }]),
    tools(['travel', { exit: 'tavern-door', to: 'griffin-street' }]),
    say('Улица.'),
  ])
  await page.goto('./')
  await startQuickGame(page)
  await pressExit(page, isMobile)
  await expect(heading(page)).toHaveText('Улица у таверны')
  expect(toolText(bodies[1])).toContain('[market-square] не создана')
  expect(toolText(bodies[1])).toContain('create_location')
})

test('возврат в таверну и повторный выход — та же улица, без нового создания', async ({ page, isMobile }) => {
  const bodies = await mockMaster(page, [
    tools(['create_location', { location: street }], ['travel', { exit: 'tavern-door', to: 'griffin-street' }], END),
    say('Улица.'),
    say('Таверна.'),
    say('Снова улица.'),
  ])
  await page.goto('./')
  await startQuickGame(page)
  await pressExit(page, isMobile)
  await expect(heading(page)).toHaveText('Улица у таверны')
  await page.getByTestId('npc-beggar').waitFor()
  await pressExit(page, isMobile, 'exit-to-tavern')
  await expect(heading(page)).toHaveText('Таверна «Пьяный грифон»')
  await expect(page.locator('.message--master').last()).toContainText('Таверна.')
  await pressExit(page, isMobile)
  await expect(heading(page)).toHaveText('Улица у таверны')
  await expect(page.locator('.message--master').last()).toContainText('Снова улица.')
  // Обратный и повторный переход — движком, без create_location.
  const created = bodies.flatMap((b) => b.messages).filter((m) => m.role === 'tool' && (m.content ?? '').includes('создана')).length
  expect(created).toBe(1)
  const ids = await page.evaluate(() =>
    Object.keys((window as unknown as { __aiMaster: { getState(): { active: { world: { locations: object } } } } }).__aiMaster.getState().active.world.locations),
  )
  expect(ids).toEqual(['drunken-griffin', 'griffin-street'])
})

test('герой дошёл до выхода пешком — подсказка, как уйти (сам шаг карту не меняет)', async ({ page, isMobile }) => {
  // На телефоне Chrome «притягивает» нажатие у двери к самой двери (известное ограничение, см. HANDOFF) — только мышь.
  test.skip(isMobile, 'только для мыши')
  await mockMaster(page, [])
  await page.goto('./')
  await startQuickGame(page)
  const cell = (x: number, y: number) =>
    page.locator('.map-svg').evaluate((svg, [cx, cy]) => {
      const p = new DOMPoint(cx + 0.5, cy + 0.5).matrixTransform((svg as SVGSVGElement).getScreenCTM()!)
      return { x: p.x, y: p.y }
    }, [x, y])
  const tap = async (x: number, y: number) => {
    const p = await cell(x, y)
    if (isMobile) await page.touchscreen.tap(p.x, p.y)
    else await page.mouse.click(p.x, p.y)
  }
  await tap(8, 12)
  await expect(page.getByTestId('player-token')).toHaveAttribute('data-x', '8')
  await expect(page.getByTestId('player-token')).not.toHaveAttribute('data-walking', 'true')
  await tap(10, 13)
  await expect(page.getByTestId('map-notice')).toHaveText('Здесь выход «Входная дверь»: нажмите на дверь → «Выйти».')
  await expect(heading(page)).toHaveText('Таверна «Пьяный грифон»')
})

/** Карта из живого отчёта (deepseek-chat-v3.1, 2026-11-09): лужи как объекты type "puddle", выход-дверь без двери на карте. */
const reportStreet = {
  id: 'outside-tavern',
  name: 'Улица у таверны',
  description: 'Грязная дорога перед трактиром «Пьяный грифон». Вечерний дождь моросит по лужам.',
  cellFeet: 5,
  width: 15,
  height: 10,
  floor: 'dirt',
  wallMaterial: 'wood',
  rooms: [{ id: 'street', name: 'Дорога', x: 0, y: 0, w: 15, h: 10 }],
  openings: [],
  doors: [],
  windows: [],
  objects: [
    { id: 'tavern-sign', type: 'building', name: 'Вывеска таверны', description: 'Деревянная вывеска с хмельным грифоном.', x: 7, y: 0, w: 1, h: 1 },
    { id: 'puddle-1', type: 'puddle', name: 'Лужа', description: 'Большая лужа от дождя.', x: 3, y: 5, w: 2, h: 2 },
    { id: 'puddle-2', type: 'puddle', name: 'Лужа', description: 'Лужа поменьше.', x: 10, y: 7, w: 1, h: 1 },
  ],
  npcs: [],
  exits: [{ id: 'tavern-entrance', kind: 'door', name: 'Дверь в таверну', x: 7, y: 9, door: 'entrance', to: 'drunken-griffin', toExit: 'tavern-door' }],
  playerStart: { x: 7, y: 8 },
}

test('ход из живого отчёта: «Выйти из таверны» текстом, лужи как объекты, дверь без двери, рассказ без travel — карта всё равно сменилась', async ({ page }) => {
  const bodies = await mockMaster(page, [
    tools(['travel', { exit: 'tavern-door' }]),
    tools(['create_location', { location: reportStreet }]),
    tools(['create_location', { location: reportStreet }]),
    tools(['create_location', { location: { ...reportStreet, exits: [{ ...reportStreet.exits[0], kind: 'road', door: undefined }] } }]),
    tools(['travel', { exit: 'tavern-door', to: 'outside-tavern' }]),
    say('Холодный дождь обдаёт лицо; впереди грязная дорога.'),
  ])
  await page.goto('./')
  await startQuickGame(page)
  await send(page, 'Выйти из таверны')
  await expect(heading(page)).toHaveText('Улица у таверны')
  // Лужи — эффекты на карте, а не отказ «type: одно из …».
  await expect(page.getByTestId('effect-puddle-1')).toHaveCount(1)
  const errorsSent = bodies
    .flatMap((b) => b.messages)
    .filter((m) => m.role === 'tool')
    .map((m) => String((JSON.parse(m.content ?? '{}') as { error?: string }).error ?? ''))
    .join('\n')
  expect(errorsSent).not.toContain('objects[1].type')
  // Выход-дверь без двери на карте — отказ с подсказкой, как исправить.
  expect(errorsSent).toContain('двери "entrance" нет в "doors"')
  expect(errorsSent).toContain('kind: "road"')
})

test('рассказ «выходите обратно на улицу» без travel — сверка просит переход', async ({ page }) => {
  const bodies = await mockMaster(page, [
    say('Вы разворачиваетесь и выходите обратно на улицу. Холодный дождь обдаёт лицо.'),
    tools(['create_location', { location: street }], ['travel', { exit: 'tavern-door', to: 'griffin-street' }], END),
    say('Улица.'),
  ])
  await page.goto('./')
  await startQuickGame(page)
  await send(page, 'Выйти из таверны')
  await expect(heading(page)).toHaveText('Улица у таверны')
  expect(lastUser(bodies[1])).toContain('create_location')
})
