// Переход на карту, которую создаёт ведущий, при разных его ответах (подменённый API): карта должна смениться или
// игра должна честно сказать, что не сменилась, и предложить «Повторить». Улицу у таверны строит движок (каркас),
// поэтому создание карты ведущим проверяется на выходе с улицы «Дорога на восток» (край карты, не дверь здания).
// Варианты: создание + переход; только текст; невалидная карта (исправлена со второй попытки — отдельным раундом
// и в одном ответе с end_turn; не исправлена совсем); travel в несуществующую локацию; возврат и повторный выход;
// ход из живого отчёта 2026-11-09.
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

const OUTSIDE = 'Снаружи: Таверна «Пьяный грифон»'
/** Ответ ведущего на выход из таверны (каркас улицы построил движок). */
const ARRIVAL = say('Ты на улице у таверны.')

/** Место за «Дорогой на восток»: создаёт ведущий; выход назад ведёт к концу дороги у таверны. */
const village = {
  id: 'east-village',
  name: 'Восточный тракт',
  description: 'Пыльный тракт между полями.',
  cellFeet: 5,
  width: 16,
  height: 10,
  floor: 'dirt',
  wallMaterial: 'stone',
  rooms: [{ id: 'road', name: 'Тракт', x: 0, y: 0, w: 16, h: 10 }],
  objects: [{ id: 'cart', type: 'debris', name: 'Сломанная телега', x: 6, y: 4, w: 2 }],
  npcs: [{ id: 'peddler', name: 'Коробейник', x: 10, y: 3 }],
  exits: [{ id: 'to-outside', kind: 'edge', name: 'Дорога к таверне', x: 0, y: 5, to: 'drunken-griffin-outside', toExit: 'road-b' }],
  playerStart: { x: 1, y: 5 },
}
/** Невалидная карта: телега за границей, наложение бочек, нет выхода. */
const broken = {
  ...village,
  exits: [],
  objects: [
    { id: 'cart', type: 'debris', name: 'Телега', x: 15, y: 4, w: 2 },
    { id: 'b1', type: 'barrel', name: 'Бочка', x: 2, y: 2 },
    { id: 'b2', type: 'barrel', name: 'Бочка', x: 2, y: 2 },
  ],
}
const END = ['end_turn', { changes: [] }] as [string, unknown]

const heading = (page: Page) => page.locator('.map-panel h2')
/** Ошибки движка, которые получила модель (поле error результатов инструментов). */
const errorsOf = (bodies: Body[]) =>
  bodies
    .flatMap((b) => b.messages)
    .filter((m) => m.role === 'tool')
    .map((m) => String((JSON.parse(m.content ?? '{}') as { error?: string }).error ?? ''))
    .join('\n')
const lastUser = (b: Body) => [...b.messages].reverse().find((m) => m.role === 'user')?.content ?? ''

async function pressExit(page: Page, isMobile: boolean, testId: string) {
  if (isMobile) await page.getByTestId(testId).tap()
  else await page.getByTestId(testId).click()
  await page.getByTestId('map-actions').getByRole('button', { name: 'Выйти' }).click()
}
async function send(page: Page, text: string) {
  await page.locator('.player-input textarea').fill(text)
  await page.locator('.player-input textarea').press('Enter')
}
/** Выйти из таверны на улицу (каркас — движок) и дождаться ответа ведущего на прибытие. */
async function goOutside(page: Page, isMobile: boolean) {
  await page.goto('./')
  await startQuickGame(page)
  await pressExit(page, isMobile, 'door-entrance')
  await expect(heading(page)).toHaveText(OUTSIDE)
  await expect(page.locator('.message--master').last()).toContainText('Ты на улице у таверны')
  await expect(page.locator('.player-input textarea')).toBeEnabled()
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem('ai-master:api-key', key), KEY)
})

test('создание карты и переход — в одном ответе с end_turn: карта сменилась', async ({ page, isMobile }) => {
  const errors = collectPageErrors(page)
  await mockMaster(page, [ARRIVAL, tools(['create_location', { location: village }], ['travel', { exit: 'road-b', to: 'east-village' }], END), say('Тракт.')])
  await goOutside(page, isMobile)
  await pressExit(page, isMobile, 'exit-road-b')
  await expect(heading(page)).toHaveText('Восточный тракт')
  // Вход новой карты — выход, ведущий обратно (к концу дороги у таверны).
  await expect(page.getByTestId('player-token')).toHaveAttribute('data-x', '0')
  await expect(page.getByTestId('player-token')).toHaveAttribute('data-y', '5')
  expect(errors).toEqual([])
})

test('ведущий ответил только текстом — сверка просит create_location и travel, карта сменилась', async ({ page, isMobile }) => {
  const bodies = await mockMaster(page, [
    ARRIVAL,
    say('Ты идёшь по дороге и выходишь на площадь у колодца.'),
    tools(['create_location', { location: village }]),
    tools(['travel', { exit: 'road-b', to: 'east-village' }]),
    say('Тракт перед тобой.'),
  ])
  await goOutside(page, isMobile)
  await pressExit(page, isMobile, 'exit-road-b')
  await expect(heading(page)).toHaveText('Восточный тракт')
  expect(lastUser(bodies[2])).toContain('create_location')
  expect(lastUser(bodies[2])).toContain('travel')
})

test('невалидная карта в одном ответе с end_turn: ведущий видит ошибки и исправляет со второй попытки', async ({ page, isMobile }) => {
  const bodies = await mockMaster(page, [
    ARRIVAL,
    tools(['create_location', { location: broken }], END),
    tools(['create_location', { location: village }], ['travel', { exit: 'road-b', to: 'east-village' }], END),
    say('Тракт.'),
  ])
  await goOutside(page, isMobile)
  await pressExit(page, isMobile, 'exit-road-b')
  await expect(heading(page)).toHaveText('Восточный тракт')
  const sent = errorsOf(bodies)
  expect(sent).toContain('exits: нужно хотя бы 1')
  // К ошибкам схемы — короткий пример верной минимальной локации.
  expect(sent).toContain('Пример минимальной локации')
})

test('невалидная карта отдельным раундом: ошибки списком с объектом за границей и наложением, исправлено со второй попытки', async ({ page, isMobile }) => {
  const bodies = await mockMaster(page, [
    ARRIVAL,
    tools(['create_location', { location: { ...broken, exits: village.exits } }]),
    tools(['create_location', { location: village }]),
    tools(['travel', { exit: 'road-b', to: 'east-village' }]),
    say('Тракт.'),
  ])
  await goOutside(page, isMobile)
  await pressExit(page, isMobile, 'exit-road-b')
  await expect(heading(page)).toHaveText('Восточный тракт')
  const sent = errorsOf(bodies)
  expect(sent).toContain('выходит за пределы карты')
  expect(sent).toContain('Пример минимальной локации')
})

test('ведущий так и не создал карту — через 2 хода сообщение и «Повторить», повтор доводит до перехода', async ({ page, isMobile }) => {
  const bodies = await mockMaster(page, [ARRIVAL], tools(['create_location', { location: broken }], END))
  await goOutside(page, isMobile)
  const before = bodies.length
  await pressExit(page, isMobile, 'exit-road-b')
  await expect.poll(() => bodies.length).toBeGreaterThan(before)
  await expect(page.locator('.player-input textarea')).toBeEnabled()
  // Первый ход — без перехода, сообщения ещё нет.
  await expect(page.getByTestId('travel-stuck')).toHaveCount(0)
  await send(page, 'Жду.')
  // Второй ход — карта так и не сменилась: понятное сообщение и «Повторить».
  const stuck = page.getByTestId('travel-stuck')
  await expect(stuck).toBeVisible()
  await expect(stuck).toContainText('Карта не сменилась')
  await expect(stuck).toContainText('«Дорога на восток»')
  await expect(heading(page)).toHaveText(OUTSIDE)
  // «Повторить» — новый запрос ведущему на создание карты; теперь он справляется.
  await page.unroute(API)
  await mockMaster(page, [tools(['create_location', { location: village }], ['travel', { exit: 'road-b', to: 'east-village' }], END), say('Тракт.')])
  await stuck.getByRole('button', { name: 'Повторить' }).click()
  await expect(heading(page)).toHaveText('Восточный тракт')
  await expect(page.getByTestId('travel-stuck')).toHaveCount(0)
})

test('travel в несуществующую локацию — отказ с подсказкой, ведущий создаёт и переходит', async ({ page, isMobile }) => {
  const bodies = await mockMaster(page, [
    ARRIVAL,
    tools(['travel', { exit: 'road-b', to: 'market-square' }]),
    tools(['create_location', { location: village }]),
    tools(['travel', { exit: 'road-b', to: 'east-village' }]),
    say('Тракт.'),
  ])
  await goOutside(page, isMobile)
  await pressExit(page, isMobile, 'exit-road-b')
  await expect(heading(page)).toHaveText('Восточный тракт')
  expect(errorsOf(bodies)).toContain('[market-square] не создана')
  expect(errorsOf(bodies)).toContain('create_location')
})

test('возврат и повторный выход — то же место, без нового создания', async ({ page, isMobile }) => {
  const bodies = await mockMaster(page, [
    ARRIVAL,
    tools(['create_location', { location: village }], ['travel', { exit: 'road-b', to: 'east-village' }], END),
    say('Тракт.'),
    say('Снова у таверны.'),
    say('Снова тракт.'),
  ])
  await goOutside(page, isMobile)
  await pressExit(page, isMobile, 'exit-road-b')
  await expect(heading(page)).toHaveText('Восточный тракт')
  await page.getByTestId('npc-peddler').waitFor()
  await pressExit(page, isMobile, 'exit-to-outside')
  await expect(heading(page)).toHaveText(OUTSIDE)
  await expect(page.locator('.message--master').last()).toContainText('Снова у таверны.')
  await pressExit(page, isMobile, 'exit-road-b')
  await expect(heading(page)).toHaveText('Восточный тракт')
  await expect(page.locator('.message--master').last()).toContainText('Снова тракт.')
  // Обратный и повторный переход — движком, без create_location.
  const created = bodies.flatMap((b) => b.messages).filter((m) => m.role === 'tool' && (m.content ?? '').includes('создана')).length
  expect(created).toBe(1)
  const ids = await page.evaluate(() =>
    Object.keys((window as unknown as { __aiMaster: { getState(): { active: { world: { locations: object } } } } }).__aiMaster.getState().active.world.locations),
  )
  expect(ids).toEqual(['drunken-griffin', 'drunken-griffin-outside', 'east-village'])
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

/** Карта из живого отчёта (deepseek-chat-v3.1, 2026-11-09): 15×10, лужи как объекты type "puddle", дверь без двери. */
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
  ],
  npcs: [],
  exits: [{ id: 'tavern-entrance', kind: 'door', name: 'Дверь в таверну', x: 7, y: 9, door: 'entrance', to: 'drunken-griffin', toExit: 'tavern-door' }],
  playerStart: { x: 7, y: 8 },
}

test('ход из живого отчёта: «Выйти из таверны» текстом → travel сразу строит каркас; маленькая улица модели — отказ с подсказкой', async ({ page }) => {
  const bodies = await mockMaster(page, [
    tools(['travel', { exit: 'tavern-door' }]),
    tools(['create_location', { location: reportStreet }]),
    say('Холодный дождь обдаёт лицо; впереди грязная дорога.'),
  ])
  await page.goto('./')
  await startQuickGame(page)
  await send(page, 'Выйти из таверны')
  // Первый же travel (без to, как в отчёте) — успех: окрестности построил движок.
  await expect(heading(page)).toHaveText(OUTSIDE)
  await expect(page.locator('.message--master').last()).toContainText('Холодный дождь')
  // Своя маленькая улица модели — отказ: окрестности здания не меньше 60×42, и подсказка, что строить их не нужно.
  const sent = errorsOf(bodies)
  expect(sent).toContain('не меньше 60×42 клеток')
  expect(sent).toContain('travel через «Входная дверь» сам построит каркас')
})

test('рассказ «выходите обратно на улицу» без travel — сверка просит переход; travel строит каркас', async ({ page }) => {
  const bodies = await mockMaster(page, [
    say('Вы разворачиваетесь и выходите обратно на улицу. Холодный дождь обдаёт лицо.'),
    tools(['travel', { exit: 'tavern-door' }], END),
    say('Улица.'),
  ])
  await page.goto('./')
  await startQuickGame(page)
  await send(page, 'Выйти из таверны')
  await expect(heading(page)).toHaveText(OUTSIDE)
  expect(lastUser(bodies[1])).toContain('travel')
  await expect(page.locator('.message--master').last()).toContainText('Улица.')
})
