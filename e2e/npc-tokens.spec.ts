// Токены НПС на карте после хода ведущего (ответы ИИ подменены): move_npc двигает стоящего НПС, add_npc у входа —
// новый посетитель появляется и идёт на место. Проверяем интерфейс (фишки), а не только состояние. Ведущий пишет
// «идёт к столу» / «заходит посетитель» без инструмента — сверка просит вызвать его, и фишка всё-таки на месте;
// «к столу», «у входа» — цель (target), а не клетка (клетка стола или героя занята).
import type { Page, Route } from '@playwright/test'
import { expect, test } from './fixtures'
import { act, collectPageErrors, expectNoHorizontalScroll, flushSaves, reloadAndContinue, startQuickGame, withEndTurn } from './helpers'

const KEY = 'sk-e2e-fake-key-npc-tokens'
const API = 'https://api.deepseek.com/chat/completions'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'POST' }
const sse = (events: unknown[]) => events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('')
const delta = (d: Record<string, unknown>, finish: string | null = null) => ({ choices: [{ index: 0, delta: d, finish_reason: finish }] })
const tools = (...calls: [string, unknown][]) =>
  sse([delta({ tool_calls: calls.map(([name, args], index) => ({ index, id: `c${index}-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })) }), delta({}, 'tool_calls'), '[DONE]'])
const say = (text: string) => sse([delta({ content: text }, 'stop'), '[DONE]'])

async function mockMaster(page: Page, rounds: string[]) {
  const results: string[] = []
  const reminders: string[] = []
  await page.route(API, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const body = route.request().postDataJSON() as { messages: { role: string; content: string | null }[] }
    for (const m of body.messages) if (m.role === 'tool' && m.content) results.push(m.content)
    const last = body.messages.at(-1)
    if (last?.role === 'user' && last.content?.startsWith('[Код игры]')) reminders.push(last.content)
    await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: withEndTurn(route, rounds.shift() ?? say('Таверна шумит.')) })
  })
  return Object.assign(results, { reminders })
}
const npc = (page: Page, id: string) => page.getByTestId(`npc-${id}`)
const send = async (page: Page, text: string) => {
  // Прошлый ход ведущего (с довызовом после просьбы) должен закончиться — пока он идёт, поле ввода заблокировано.
  await expect(page.locator('.player-input textarea')).toBeEnabled()
  await page.locator('.player-input textarea').fill(text)
  await page.locator('.player-input textarea').press('Enter')
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem('ai-master:api-key', key), KEY)
  await page.goto('./')
  await startQuickGame(page)
})

test('move_npc: Гуннар идёт к столу — фишка уходит с места и встаёт в новую клетку', async ({ page }) => {
  const errors = collectPageErrors(page)
  const results = await mockMaster(page, [tools(['move_npc', { npc: 'gunnar', x: 8, y: 8 }]), say('Гуннар берёт кружку и идёт к столу у ковра.')])
  await expect(npc(page, 'gunnar')).toHaveAttribute('data-x', '7')
  await expect(npc(page, 'gunnar')).toHaveAttribute('data-y', '1')
  await send(page, 'Смотрю, что делает Гуннар.')
  await expect(page.locator('.message--master').last()).toContainText('идёт к столу')
  expect(results.join('\n')).toContain('"ok":true')
  await expect(npc(page, 'gunnar')).toHaveAttribute('data-x', '8')
  await expect(npc(page, 'gunnar')).toHaveAttribute('data-y', '8')
  await expect(npc(page, 'gunnar')).not.toHaveAttribute('data-walking', 'true')
  expect(errors).toEqual([])
})

test('add_npc у входа: новый посетитель появляется на карте и идёт на место', async ({ page }) => {
  const errors = collectPageErrors(page)
  const results = await mockMaster(page, [
    tools(['add_npc', { name: 'Путник', x: 9, y: 12, attitude: 'neutral', description: 'Промокший путник в плаще.', activity: 'отряхивает плащ у двери' }]),
    say('Дверь хлопает — в таверну заходит промокший путник.'),
  ])
  await send(page, 'Оглядываю зал.')
  await expect(page.locator('.message--master').last()).toContainText('заходит')
  expect(results.join('\n')).toContain('"ok":true')
  const token = page.locator('[data-testid^="npc-"]').filter({ has: page.locator('text=П') })
  await expect(token).toHaveCount(1)
  await expect(token).toHaveAttribute('data-x', '9')
  await expect(token).toHaveAttribute('data-y', '12')
  await expectNoHorizontalScroll(page)
  expect(errors).toEqual([])
})

test('«Гуннар идёт к столу» без инструмента: сверка просит move_npc, ведущий двигает к цели — фишка у стола', async ({ page }) => {
  const errors = collectPageErrors(page)
  const results = await mockMaster(page, [
    say('Гуннар берёт кружку и пересаживается за центральный стол.'),
    tools(['move_npc', { npc: 'gunnar', target: 'table-2' }]),
  ])
  await send(page, 'Смотрю, что делает Гуннар.')
  await expect(page.locator('.message--master').last()).toContainText('пересаживается')
  await expect.poll(() => results.reminders.length).toBe(1)
  expect(results.reminders[0]).toContain('Гуннар')
  await expect(npc(page, 'gunnar')).not.toHaveAttribute('data-y', '1')
  await expect(npc(page, 'gunnar')).not.toHaveAttribute('data-walking', 'true')
  // Встал вплотную к центральному столу (9–10, 7–8).
  const x = Number(await npc(page, 'gunnar').getAttribute('data-x'))
  const y = Number(await npc(page, 'gunnar').getAttribute('data-y'))
  expect(x >= 8 && x <= 11 && y >= 6 && y <= 9).toBe(true)
  expect(errors).toEqual([])
})

test('«в таверну заходит новый посетитель» без инструмента: сверка просит add_npc, новый у входа появляется на карте', async ({ page }) => {
  const errors = collectPageErrors(page)
  const results = await mockMaster(page, [
    say('Дверь хлопает — в таверну заходит новый посетитель.'),
    tools(['add_npc', { name: 'Путник', target: 'entrance', description: 'Промокший путник в плаще.' }]),
  ])
  await send(page, 'Оглядываю зал.')
  await expect(page.locator('.message--master').last()).toContainText('заходит новый посетитель')
  await expect.poll(() => results.reminders.length).toBe(1)
  expect(results.reminders[0]).toContain('add_npc')
  const token = page.locator('[data-testid^="npc-"]').filter({ has: page.locator('text=П') })
  await expect(token).toHaveCount(1)
  // Клетка у входной двери (9–10, 13) — та, где герой, занята: путник встаёт рядом.
  const y = Number(await token.getAttribute('data-y'))
  expect(y).toBeGreaterThanOrEqual(12)
  expect(errors).toEqual([])
})

test('регрессия: герой ходил, история перезагружена (старая) — фишки НПС на месте, move_npc идёт по шагам, в запросе «Где герои»', async ({ page }) => {
  const errors = collectPageErrors(page)
  const rounds: string[] = []
  const bodies: string[] = []
  await page.route(API, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    bodies.push(JSON.stringify(route.request().postDataJSON()))
    await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: withEndTurn(route, rounds.shift() ?? say('Таверна шумит.')) })
  })
  // Герой сам прошёл по залу (5.2) — возможна короткая авто-реакция ведущего (5.3).
  await act(page, { type: 'heroMoved', heroId: 'ratibor', to: { x: 12, y: 10 } }, { kind: 'player', heroId: 'ratibor' })
  await expect(page.getByTestId('player-token')).toHaveAttribute('data-x', '12')
  await expect(page.locator('.player-input textarea')).toBeEnabled()
  await flushSaves(page)
  await reloadAndContinue(page)
  await expect(page.getByTestId('player-token')).toHaveAttribute('data-y', '10')
  await expect(npc(page, 'gunnar')).toHaveAttribute('data-x', '7')
  await expect(npc(page, 'tobias')).toHaveAttribute('data-x', '17')

  rounds.push(tools(['move_npc', { npc: 'gunnar', target: 'Ратибор' }]), say('Гуннар подходит к тебе с кружкой.'))
  await send(page, 'Жду, что будет.')
  // Идёт по клеткам (частый опрос — шаг 140 мс), а не прыгает.
  await expect.poll(() => npc(page, 'gunnar').getAttribute('data-walking'), { intervals: [30] }).toBe('true')
  await expect(npc(page, 'gunnar')).not.toHaveAttribute('data-walking', 'true')
  const x = Number(await npc(page, 'gunnar').getAttribute('data-x'))
  const y = Number(await npc(page, 'gunnar').getAttribute('data-y'))
  expect(Math.max(Math.abs(x - 12), Math.abs(y - 10))).toBe(1)
  expect(bodies.at(-1)).toContain('Где герои')
  expect(errors).toEqual([])
})

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
const nearArea = (p: { x: number; y: number }, a: { x: number; y: number; w: number; h: number }) =>
  p.x >= a.x - 1 && p.x <= a.x + a.w && p.y >= a.y - 1 && p.y <= a.y + a.h
const tokenAt = async (page: Page, testId: string) => ({
  x: Number(await page.getByTestId(testId).getAttribute('data-x')),
  y: Number(await page.getByTestId(testId).getAttribute('data-y')),
})

test('после travel на карту из create_location и обратно: «идёт к» и «заходит» без инструмента → просьба → фишки на месте', async ({ page, isMobile }) => {
  const errors = collectPageErrors(page)
  const results = await mockMaster(page, [
    // После просьбы сверки и довызова инструментов ход заканчивается без ещё одного запроса к модели.
    // Выход из таверны: карты улицы нет — ведущий создаёт и переводит отряд.
    tools(['create_location', { location: street }]),
    tools(['travel', { exit: 'tavern-door', to: 'griffin-street' }]),
    say('Ты выходишь на грязную улицу.'),
    // На созданной карте: текст без инструмента → просьба → move_npc к цели.
    say('Нищий кряхтит и бредёт к сломанной телеге.'),
    tools(['move_npc', { npc: 'beggar', target: 'cart' }]),
    // Новый на созданной карте (дверей нет — цель рядом с героем).
    say('Из-за угла на улицу заходит стражник с фонарём.'),
    tools(['add_npc', { name: 'Стражник', target: 'Ратибор', description: 'Стражник с фонарём.' }]),
    // Возврат в таверну — та же карта, правка работает и там.
    say('Ты снова в шумной таверне.'),
    say('Гуннар пересаживается за центральный стол.'),
    tools(['move_npc', { npc: 'gunnar', target: 'table-2' }]),
  ])
  const press = async (testId: string) => (isMobile ? page.getByTestId(testId).tap() : page.getByTestId(testId).click())
  const menu = page.getByTestId('map-actions')

  await press('door-entrance')
  await menu.getByRole('button', { name: 'Выйти' }).click()
  await expect(page.locator('.map-panel h2')).toHaveText('Улица у таверны')
  await expect(npc(page, 'beggar')).toHaveAttribute('data-x', '8')

  await send(page, 'Оглядываю улицу.')
  await expect.poll(() => results.reminders.length).toBe(1)
  expect(results.reminders[0]).toContain('Нищий')
  await expect(npc(page, 'beggar')).not.toHaveAttribute('data-x', '8')
  await expect(npc(page, 'beggar')).not.toHaveAttribute('data-walking', 'true')
  expect(nearArea(await tokenAt(page, 'npc-beggar'), { x: 3, y: 4, w: 2, h: 1 })).toBe(true)

  await send(page, 'Жду.')
  await expect.poll(() => results.reminders.length).toBe(2)
  expect(results.reminders[1]).toContain('add_npc')
  const guard = page.locator('[data-testid^="npc-"]').filter({ has: page.locator('text=С') })
  await expect(guard).toHaveCount(1)
  const hero = await tokenAt(page, 'player-token')
  const g = { x: Number(await guard.getAttribute('data-x')), y: Number(await guard.getAttribute('data-y')) }
  expect(Math.max(Math.abs(g.x - hero.x), Math.abs(g.y - hero.y))).toBe(1)

  await press('exit-to-tavern')
  await menu.getByRole('button', { name: 'Выйти' }).click()
  await expect(page.locator('.map-panel h2')).toHaveText('Таверна «Пьяный грифон»')
  await expect(npc(page, 'gunnar')).toHaveAttribute('data-x', '7')
  // Стражник остался на улице — в таверне его нет.
  await expect(page.locator('[data-testid^="npc-"]').filter({ has: page.locator('text=С') })).toHaveCount(0)

  await send(page, 'Смотрю на Гуннара.')
  await expect.poll(() => results.reminders.length).toBe(3)
  expect(results.reminders[2]).toContain('Гуннар')
  await expect(npc(page, 'gunnar')).not.toHaveAttribute('data-y', '1')
  await expect(npc(page, 'gunnar')).not.toHaveAttribute('data-walking', 'true')
  expect(nearArea(await tokenAt(page, 'npc-gunnar'), { x: 9, y: 7, w: 2, h: 2 })).toBe(true)
  await expectNoHorizontalScroll(page)
  expect(errors).toEqual([])
})
