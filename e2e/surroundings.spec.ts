// Окрестности таверны: при выходе через дверь движок строит каркас 60×42 (контур здания с дверью на месте, двор,
// дорога, забор); при открытии карта видна целиком (авто-подгонка), дальше — масштаб и сдвиг: колесо и перетаскивание
// мышью, щипок и (когда увеличено) перетаскивание одним пальцем на телефоне и планшете. Ответы ИИ подменены.
import type { Page, Route } from '@playwright/test'
import { expect, test } from './fixtures'
import { collectPageErrors, expectNoHorizontalScroll, startQuickGame, withEndTurn } from './helpers'

const KEY = 'sk-e2e-fake-key-surroundings'
const API = 'https://api.deepseek.com/chat/completions'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'POST' }
const say = (text: string) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`

const zoom = async (page: Page) => Number(await page.getByTestId('map-viewport').getAttribute('data-zoom'))
const transform = (page: Page) => page.locator('.map-zoom').evaluate((el) => (el as HTMLElement).style.transform)

async function goOutside(page: Page, isMobile: boolean) {
  await page.addInitScript((key) => localStorage.setItem('ai-master:api-key', key), KEY)
  await page.route(API, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: withEndTurn(route, say('Ты на улице.')) })
  })
  await page.goto('./')
  await startQuickGame(page)
  if (isMobile) await page.getByTestId('door-entrance').tap()
  else await page.getByTestId('door-entrance').click()
  await page.getByTestId('map-actions').getByRole('button', { name: 'Выйти' }).click()
  await expect(page.locator('.map-panel h2')).toHaveText('Снаружи: Таверна «Пьяный грифон»')
  await expect(page.locator('.player-input textarea')).toBeEnabled()
}

test('каркас: 60×42, контур таверны с дверью на месте, герой у двери, видно всю карту целиком', async ({ page, isMobile }, testInfo) => {
  const errors = collectPageErrors(page)
  await goOutside(page, isMobile)
  // Размер карты и дверь здания: двустворчатая, на южной стене контура (как изнутри).
  const board = page.getByTestId('map-board')
  await expect(page.getByTestId('door-drunken-griffin-door')).toHaveCount(1)
  await expect(page.getByTestId('player-token')).toHaveAttribute('data-x', '30')
  await expect(page.getByTestId('player-token')).toHaveAttribute('data-y', '28')
  // 60×42 клеток плюс поле в четверть клетки по краям.
  await expect(page.locator('.map-svg')).toHaveAttribute('viewBox', '-0.25 -0.25 60.5 42.5')
  // Дороги за край карты — выходы со значками.
  await expect(page.getByTestId('exit-road-a')).toHaveCount(1)
  await expect(page.getByTestId('exit-road-b')).toHaveCount(1)
  // Авто-подгонка: масштаб 1, вся карта внутри окна карты.
  expect(await zoom(page)).toBe(1)
  const vp = (await page.getByTestId('map-viewport').boundingBox())!
  const svg = (await page.locator('.map-svg').boundingBox())!
  expect(svg.x).toBeGreaterThanOrEqual(vp.x - 1)
  expect(svg.x + svg.width).toBeLessThanOrEqual(vp.x + vp.width + 1)
  expect(svg.y + svg.height).toBeLessThanOrEqual(vp.y + vp.height + 1)
  await expectNoHorizontalScroll(page)
  await testInfo.attach('окрестности таверны целиком', { body: await board.screenshot(), contentType: 'image/png' })
  expect(errors).toEqual([])
})

test.describe('десктоп: колесо и перетаскивание на большой карте', () => {
  test.skip(({ isMobile }) => isMobile, 'только для мыши')

  test('колесо приближает, перетаскивание сдвигает, «Вся карта» — снова целиком', async ({ page }) => {
    await goOutside(page, false)
    const box = (await page.getByTestId('map-viewport').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, -600)
    await expect.poll(() => zoom(page)).toBeGreaterThan(2)
    const before = await transform(page)
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 8 })
    await page.mouse.up()
    expect(await transform(page)).not.toBe(before)
    await page.getByTestId('map-reset').click()
    await expect.poll(() => zoom(page)).toBe(1)
  })
})

test.describe('телефон и планшет: щипок и сдвиг одним пальцем', () => {
  test.skip(({ isMobile }) => !isMobile, 'только для сенсорного экрана')

  test('щипок приближает; увеличенную карту одним пальцем можно сдвинуть, страница при этом не прокручивается', async ({ page }, testInfo) => {
    await goOutside(page, true)
    const viewport = page.getByTestId('map-viewport')
    const box = (await viewport.boundingBox())!
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    // Щипок двумя пальцами.
    await viewport.evaluate(
      (el, { cx, cy }) => {
        const touch = (id: number, x: number, y: number) => new Touch({ identifier: id, target: el, clientX: x, clientY: y })
        const fire = (type: string, a: number) => {
          const touches = [touch(1, cx - a, cy), touch(2, cx + a, cy)]
          el.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : touches, changedTouches: touches, bubbles: true, cancelable: true }))
        }
        fire('touchstart', 20)
        for (let a = 30; a <= 90; a += 10) fire('touchmove', a)
        fire('touchend', 90)
      },
      { cx, cy },
    )
    await expect.poll(() => zoom(page)).toBeGreaterThan(2)
    await expect(viewport).toHaveClass(/is-zoomed/)
    // Увеличенная карта: браузер отдаёт палец карте (touch-action: none), страница не прокручивается.
    expect(await viewport.evaluate((el) => getComputedStyle(el).touchAction)).toBe('none')
    // Один палец по увеличенной карте — сдвиг карты (события касания, как от пальца).
    const before = await transform(page)
    await viewport.evaluate(
      (el, { cx, cy }) => {
        const fire = (type: string, x: number, y: number) =>
          el.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }))
        fire('pointerdown', cx, cy)
        for (let i = 1; i <= 6; i++) fire('pointermove', cx + i * 12, cy + i * 8)
        fire('pointerup', cx + 72, cy + 48)
      },
      { cx, cy },
    )
    await expect.poll(() => transform(page)).not.toBe(before)
    // Сдвиг пальцем — не нажатие: меню и шаг героя не срабатывают.
    await expect(page.getByTestId('map-actions')).toHaveCount(0)
    await expect(page.getByTestId('player-token')).toHaveAttribute('data-x', '30')
    await expectNoHorizontalScroll(page)
    await testInfo.attach('увеличенные окрестности', { body: await page.locator('.map-board').screenshot(), contentType: 'image/png' })
    await page.getByTestId('map-reset').tap()
    await expect.poll(() => zoom(page)).toBe(1)
    await expect(viewport).not.toHaveClass(/is-zoomed/)
  })
})
