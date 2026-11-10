// Три масштаба карт (6.2): ведущий создаёт частичную карту деревни (таверна — место на ней) и общую карту королевства;
// над картой — путь «Королевство → Деревня Дубки → Таверна», по нему и кнопкой «Отдалить» игрок смотрит карты выше
// (отряд на месте — у своего места), «Приблизить» — обратно; место без карты — «Подробнее» уходит ведущему, он создаёт
// карту; щипок «сжать» на телефоне — карта выше. Ведущий переводит отряд на общую карту (set_map_view); бой — снова
// клеточная карта, масштаб закреплён. Ответы ИИ подменены.
import type { Page, Route } from '@playwright/test'
import { expect, test } from './fixtures'
import { collectPageErrors, expectNoHorizontalScroll, reloadAndContinue, startQuickGame, withEndTurn } from './helpers'

const KEY = 'sk-e2e-fake-key-levels'
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
const systemText = (b: Body) => b.messages.find((m) => m.role === 'system')?.content ?? ''

const field = (w: number, h: number) => ({ floor: 'grass', wallMaterial: 'wood', width: w, height: h, rooms: [{ id: 'all', x: 0, y: 0, w, h }], objects: [], npcs: [] })
const VILLAGE = {
  id: 'oak-village',
  name: 'Деревня Дубки',
  description: 'Десяток домов у тракта.',
  scale: { kind: 'area', cell: 50, unit: 'ft' },
  ...field(24, 16),
  objects: [{ id: 'oak', type: 'tree', name: 'Старый дуб', x: 4, y: 4 }],
  places: [
    { id: 'griffin', name: 'Таверна', kind: 'building', x: 10, y: 8, map: 'drunken-griffin' },
    { id: 'mill', name: 'Мельница', kind: 'building', x: 20, y: 3 },
  ],
  playerStart: { x: 10, y: 9 },
}
const KINGDOM = {
  id: 'kingdom',
  name: 'Королевство',
  description: 'Холмы, леса и тракт.',
  scale: { kind: 'region', cell: 1, unit: 'mi' },
  ...field(30, 20),
  places: [
    { id: 'oaks', name: 'Дубки', kind: 'village', x: 12, y: 9, map: 'oak-village' },
    { id: 'ruins', name: 'Руины', kind: 'ruins', x: 25, y: 4 },
  ],
  playerStart: { x: 12, y: 10 },
}
const RUINS = { id: 'old-ruins', name: 'Старые руины', description: 'Обломки башни в чаще.', scale: { kind: 'area', cell: 50, unit: 'ft' }, parent: 'kingdom', ...field(16, 12), playerStart: { x: 8, y: 6 } }

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem('ai-master:api-key', key), KEY)
})

/** Ведущий создаёт деревню и королевство в ответ на реплику игрока. */
async function buildWorld(page: Page) {
  await page.locator('.player-input textarea').fill('Расспрашиваю о здешних краях')
  await page.locator('.player-input textarea').press('Enter')
  await expect(page.locator('.message--master').last()).toContainText('Деревня Дубки стоит у тракта')
  await expect(page.locator('.player-input textarea')).toBeEnabled()
}

test('путь по масштабам, «Отдалить» / «Приблизить», место без карты — ведущему; после перезагрузки всё на месте', async ({ page, isMobile }, testInfo) => {
  const errors = collectPageErrors(page)
  const bodies = await mockMaster(page, [
    tool('create_location', { location: VILLAGE }),
    tool('create_location', { location: KINGDOM }),
    say('Деревня Дубки стоит у тракта, а дальше — всё королевство.'),
    tool('create_location', { location: RUINS, place: 'ruins' }),
    say('Руины — обломки башни в чаще.'),
  ])
  const press = async (testId: string) => (isMobile ? page.getByTestId(testId).tap() : page.getByTestId(testId).click())
  await page.goto('./')
  await startQuickGame(page)
  // В начале карт выше нет: «Отдалить» — просьба ведущему, «Приблизить» недоступно, пути нет.
  await expect(page.getByTestId('map-trail')).toHaveCount(0)
  await expect(page.getByTestId('map-level-up')).toBeEnabled()
  await expect(page.getByTestId('map-level-down')).toBeDisabled()

  await buildWorld(page)
  // Ведущему — масштаб и путь (в состоянии игры).
  expect(systemText(bodies[0])).toContain('## Масштаб карты\nОтряд на карте «Таверна «Пьяный грифон»» [drunken-griffin] — клеточная карта')
  expect(systemText(bodies.at(-1)!)).toContain('Выше: «Деревня Дубки» [oak-village] (частичная карта) — отряд у места «Таверна» (10, 8)')
  const trail = page.getByTestId('map-trail').locator('li')
  await expect(trail).toHaveText(['Королевство', 'Деревня Дубки', 'Таверна «Пьяный грифон»'])
  await expectNoHorizontalScroll(page)

  // «Отдалить» — частичная карта деревни: отряд у места «Таверна», отряд при этом не переходит.
  await press('map-level-up')
  await expect(page.locator('.map-panel h2')).toHaveText('Деревня Дубки')
  await expect(page.getByTestId('map-scale-label')).toHaveText('Частичная карта · 1 клетка = 50 фт.')
  await expect(page.getByTestId('map-viewing')).toContainText('Отряд — на карте «Таверна «Пьяный грифон»»')
  await expect(page.getByTestId('player-token')).toHaveAttribute('data-x', '10')
  await expect(page.getByTestId('player-token')).toHaveAttribute('data-y', '8')
  await expect(page.getByTestId('place-griffin')).toHaveAttribute('data-has-map', 'true')
  await expect(trail).toHaveText(['Королевство', 'Деревня Дубки'])
  await expectNoHorizontalScroll(page)
  await testInfo.attach('частичная карта', { body: await page.locator('.map-panel').screenshot(), contentType: 'image/png' })

  // По пути — сразу на общую карту; там отряд у места «Дубки».
  await press('map-level-kingdom')
  await expect(page.locator('.map-panel h2')).toHaveText('Королевство')
  await expect(page.getByTestId('map-scale-label')).toContainText('Общая карта · 1 клетка = 1 миля')
  await expect(page.getByTestId('player-token')).toHaveAttribute('data-x', '12')
  await expect(page.getByTestId('player-token')).toHaveAttribute('data-y', '9')
  await testInfo.attach('общая карта', { body: await page.locator('.map-panel').screenshot(), contentType: 'image/png' })

  // Место без карты — «Подробнее»: просьба ведущему, он создаёт частичную карту руин (место теперь с картой).
  await press('place-ruins')
  await page.getByTestId('map-actions').getByRole('button', { name: 'Подробнее' }).click()
  await expect(page.locator('.message--master').last()).toContainText('обломки башни')
  expect(lastUser(bodies.at(-2)!)).toContain('хочет рассмотреть подробнее место «Руины» [ruins] на карте «Королевство»')
  await expect(page.getByTestId('place-ruins')).toHaveAttribute('data-has-map', 'true')
  // Отряд по-прежнему в таверне.
  await expect(page.getByTestId('map-viewing')).toContainText('«Таверна «Пьяный грифон»»')

  // «Приблизить» — на уровень ниже к отряду (деревня), затем место «Таверна» → «Приблизить» — снова карта отряда.
  await press('map-level-down')
  await expect(page.locator('.map-panel h2')).toHaveText('Деревня Дубки')
  await press('place-griffin')
  await page.getByTestId('map-actions').getByRole('button', { name: 'Приблизить' }).click()
  await expect(page.locator('.map-panel h2')).toHaveText('Таверна «Пьяный грифон»')
  await expect(page.getByTestId('map-viewing')).toHaveCount(0)
  await expect(page.getByTestId('player-token')).toHaveAttribute('data-x', '10')
  await expect(page.getByTestId('player-token')).toHaveAttribute('data-y', '13')

  // Всё — действия истории: после перезагрузки уровни те же.
  await reloadAndContinue(page)
  await expect(trail).toHaveText(['Королевство', 'Деревня Дубки', 'Таверна «Пьяный грифон»'])
  expect(errors).toEqual([])
})

test('щипок «сжать» на карте целиком — карта уровнем выше', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'только для сенсорного экрана')
  await mockMaster(page, [tool('create_location', { location: VILLAGE }), tool('create_location', { location: KINGDOM }), say('Деревня Дубки стоит у тракта.')])
  await page.goto('./')
  await startQuickGame(page)
  await buildWorld(page)
  const pinchOut = () =>
    page.getByTestId('map-viewport').evaluate((el) => {
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const touch = (id: number, x: number, y: number) => new Touch({ identifier: id, target: el, clientX: x, clientY: y })
      const fire = (type: string, a: number) => {
        const touches = [touch(1, cx - a, cy), touch(2, cx + a, cy)]
        el.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : touches, changedTouches: touches, bubbles: true, cancelable: true }))
      }
      fire('touchstart', 120)
      for (let a = 110; a >= 40; a -= 10) fire('touchmove', a)
      fire('touchend', 40)
    })
  await pinchOut()
  await expect(page.locator('.map-panel h2')).toHaveText('Деревня Дубки')
  await pinchOut()
  await expect(page.locator('.map-panel h2')).toHaveText('Королевство')
  await expectNoHorizontalScroll(page)
})

test('ведущий переводит отряд на общую карту (set_map_view); бой — снова клеточная карта, масштаб закреплён', async ({ page, isMobile }) => {
  const errors = collectPageErrors(page)
  await mockMaster(page, [
    tool('create_location', { location: VILLAGE }),
    tool('create_location', { location: KINGDOM }),
    say('Деревня Дубки стоит у тракта.'),
    tool('set_map_view', { map: 'kingdom', reason: 'отряд вышел на тракт' }),
    say('Тракт уходит за холмы.'),
    tool('set_combat', { state: 'start', map: 'drunken-griffin' }),
    say('Из-за стойки выскакивают громилы!'),
  ])
  const press = async (testId: string) => (isMobile ? page.getByTestId(testId).tap() : page.getByTestId(testId).click())
  await page.goto('./')
  await startQuickGame(page)
  await buildWorld(page)

  await page.locator('.player-input textarea').fill('Отправляемся в путь')
  await page.locator('.player-input textarea').press('Enter')
  await expect(page.locator('.message--master').last()).toContainText('Тракт уходит за холмы')
  await expect(page.locator('.map-panel h2')).toHaveText('Королевство')
  await expect(page.getByTestId('map-viewing')).toHaveCount(0)
  await expect(page.getByTestId('player-token')).toHaveAttribute('data-x', '12')
  await expect(page.getByTestId('player-token')).toHaveAttribute('data-y', '9')
  // На общей карте отряда — «Приблизить» у места под героем (Дубки, карта есть) — посмотреть деревню.
  await press('map-level-down')
  await expect(page.locator('.map-panel h2')).toHaveText('Деревня Дубки')
  await press('map-back-to-party')
  await expect(page.locator('.map-panel h2')).toHaveText('Королевство')

  await page.locator('.player-input textarea').fill('Стоим на месте')
  await page.locator('.player-input textarea').press('Enter')
  await expect(page.locator('.message--master').last()).toContainText('громилы')
  await expect(page.locator('.map-panel h2')).toHaveText('Таверна «Пьяный грифон»')
  await expect(page.getByTestId('map-level-up')).toBeDisabled()
  await expect(page.getByTestId('map-level-down')).toBeDisabled()
  await expect(page.getByTestId('map-level-up')).toHaveAttribute('title', 'Идёт бой: карта закреплена на клеточной.')
  expect(errors).toEqual([])
})
