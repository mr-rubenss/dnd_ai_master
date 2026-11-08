// Метки игрока на карте: правый щелчок (мышь) или долгое нажатие (палец) по клетке → «Поставить метку» с текстом
// и значком; метку можно изменить и удалить, она переживает перезагрузку и уходит ведущему в состоянии игры.
// API поставщика подменяется (page.route).
import type { Page, Route } from '@playwright/test'
import { expect, test } from './fixtures'
import { collectPageErrors, expectNoHorizontalScroll, reloadAndContinue, startQuickGame, withEndTurn } from './helpers'

const KEY = 'sk-e2e-fake-key-marks'
const API = 'https://api.deepseek.com/chat/completions'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'POST' }
const sse = (text: string) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
type Body = { messages: { role: string; content: string | null }[] }

async function mockMaster(page: Page) {
  const bodies: Body[] = []
  await page.route(API, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    bodies.push(route.request().postDataJSON() as Body)
    await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: withEndTurn(route, sse('Таверна шумит.')) })
  })
  return bodies
}

async function cellPoint(page: Page, x: number, y: number) {
  return page.locator('.map-svg').evaluate(
    (svg, [cx, cy]) => {
      const p = new DOMPoint(cx + 0.5, cy + 0.5).matrixTransform((svg as SVGSVGElement).getScreenCTM()!)
      return { x: p.x, y: p.y }
    },
    [x, y],
  )
}

/** Долгое нажатие пальцем в точке (касание через протокол браузера: палец стоит на месте дольше LONG_PRESS_MS). */
async function longPress(page: Page, p: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] })
  await page.waitForTimeout(800)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

const hero = (page: Page) => page.getByTestId('player-token')
const marks = (page: Page) => page.locator('[data-testid^="mark-"][data-icon]')

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem('ai-master:api-key', key), KEY)
})

test('мышь: правый щелчок → поставить метку, изменить, она у ведущего в состоянии игры, удалить', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'только для мыши')
  const errors = collectPageErrors(page)
  const bodies = await mockMaster(page)
  await page.goto('./')
  await startQuickGame(page)

  const p = await cellPoint(page, 6, 10)
  await page.mouse.click(p.x, p.y, { button: 'right' })
  const panel = page.getByTestId('mark-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('Клетка (6, 10)')
  // Правый щелчок — не шаг героя.
  await expect(hero(page)).toHaveAttribute('data-x', '10')
  await panel.getByTestId('mark-place').click()
  await panel.getByTestId('mark-icon-cache').click()
  await panel.getByTestId('mark-text').fill('тайник?')
  await testInfo.attach('новая метка', { body: await page.locator('.map-board').screenshot(), contentType: 'image/png' })
  await panel.getByTestId('mark-save').click()
  await expect(panel).toHaveCount(0)
  await expect(marks(page)).toHaveCount(1)
  await expect(marks(page)).toHaveAttribute('data-icon', 'cache')
  await expect(marks(page)).toHaveAttribute('data-x', '6')
  await expect(marks(page)).toHaveAttribute('data-y', '10')
  await expect(hero(page)).toHaveAttribute('data-x', '10')

  // Изменить: нажатие на метку → «Изменить».
  await marks(page).click()
  await expect(panel.getByTestId('mark-panel-text')).toHaveText('тайник?')
  await panel.getByTestId('mark-edit').click()
  await panel.getByTestId('mark-icon-danger').click()
  await panel.getByTestId('mark-text').fill('опасно')
  await panel.getByTestId('mark-save').click()
  await expect(marks(page)).toHaveAttribute('data-icon', 'danger')

  // Метка хранится в истории — после перезагрузки на месте.
  await reloadAndContinue(page)
  await expect(marks(page)).toHaveCount(1)
  await expect(marks(page)).toHaveAttribute('data-icon', 'danger')

  // Ведущий видит метку в состоянии игры.
  await page.locator('.player-input textarea').fill('Оглядываюсь.')
  await page.locator('.player-input textarea').press('Enter')
  await expect(page.locator('.message--master').last()).toContainText('Таверна шумит')
  const system = bodies[0].messages.find((m) => m.role === 'system')?.content ?? ''
  expect(system).toContain('## Метки игрока на карте')
  expect(system).toContain('игрок отметил: «опасно» (значок «опасность») — клетка (6, 10)')

  // Удалить.
  await marks(page).click()
  await panel.getByTestId('mark-remove').click()
  await expect(marks(page)).toHaveCount(0)
  expect(errors).toEqual([])
})

test('палец: долгое нажатие → поставить метку; короткое нажатие — по-прежнему шаг героя', async ({ page, isMobile }, testInfo) => {
  test.skip(!isMobile, 'только касание')
  const errors = collectPageErrors(page)
  await mockMaster(page)
  await page.goto('./')
  await startQuickGame(page)

  await longPress(page, await cellPoint(page, 6, 10))
  const panel = page.getByTestId('mark-panel')
  await expect(panel).toBeVisible()
  await expect(hero(page)).toHaveAttribute('data-x', '10')
  await panel.getByTestId('mark-place').tap()
  await panel.getByTestId('mark-text').fill('спросить Гуннара')
  await expectNoHorizontalScroll(page)
  await testInfo.attach('метка на телефоне', { body: await page.screenshot(), contentType: 'image/png' })
  await panel.getByTestId('mark-save').tap()
  await expect(marks(page)).toHaveCount(1)
  await expect(marks(page)).toHaveAttribute('data-icon', 'question')

  // Обычное нажатие по пустой клетке — шаг героя, а не метка.
  const step = await cellPoint(page, 8, 12)
  await page.touchscreen.tap(step.x, step.y)
  await expect(hero(page)).toHaveAttribute('data-x', '8')
  await expect(hero(page)).toHaveAttribute('data-y', '12')
  await expect(panel).toHaveCount(0)
  await expectNoHorizontalScroll(page)
  expect(errors).toEqual([])
})
