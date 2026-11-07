// Богатая карта: слои, обстановка с тенями, свет и тьма, масштаб и сдвиг (колесо, перетаскивание, два пальца),
// «К герою», плавный шаг фишек. Скорость: в SVG — не сотни узлов на клетки.
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { act, collectPageErrors, expectNoHorizontalScroll, MASTER, startQuickGame } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('./')
  await startQuickGame(page)
})

const zoom = async (page: Page) => Number(await page.getByTestId('map-viewport').getAttribute('data-zoom'))

/** Центр фишки героя на экране — внутри окна карты? */
async function heroInView(page: Page) {
  const box = (await page.getByTestId('map-viewport').boundingBox())!
  const hero = (await page.getByTestId('player-token').locator('.player-core').boundingBox())!
  const cx = hero.x + hero.width / 2
  const cy = hero.y + hero.height / 2
  return cx > box.x && cx < box.x + box.width && cy > box.y && cy < box.y + box.height
}

test('слои по порядку: пол → стены → обстановка → фишки → эффекты → интерфейс; узлов немного', async ({ page }) => {
  const layers = await page.locator('.map-svg > g.map-layer').evaluateAll((gs) => gs.map((g) => [...g.classList].find((c) => c.startsWith('map-layer--'))))
  expect(layers).toEqual(['map-layer--floor', 'map-layer--walls', 'map-layer--objects', 'map-layer--tokens', 'map-layer--effects', 'map-layer--ui'])
  // Подписи НПС — в слое интерфейса, поверх тьмы.
  await expect(page.locator('.map-layer--ui .npc-label')).toHaveCount(4)
  // На телефоне не тормозит: пол одной фигурой на тип, а не по клетке.
  const nodes = await page.locator('.map-svg *').count()
  expect(nodes).toBeLessThan(1500)
})

test('обстановка: кровать, сундук, полка, ковёр, факелы, свечи — с мягкими тенями; подсказка по ним работает', async ({ page, isMobile }, testInfo) => {
  for (const [id, type] of [
    ['storage-cot', 'bed'],
    ['storage-chest', 'chest'],
    ['storage-shelf', 'shelf'],
    ['rug-hall', 'rug'],
    ['torch-bar', 'torch'],
    ['candle-1', 'candle'],
    ['fireplace', 'fireplace'],
  ])
    await expect(page.getByTestId(`object-${id}`)).toHaveAttribute('data-type', type)
  expect(await page.locator('.map-layer--objects .obj-shadow').count()).toBeGreaterThan(20)
  await expect(page.locator('.map-layer--tokens .token-shadow')).toHaveCount(5)
  // Ковёр под столом: рисуется раньше стола (ниже по слою).
  const order = await page.locator('.map-layer--objects > g').evaluateAll((gs) => gs.map((g) => g.getAttribute('data-testid')))
  expect(order.indexOf('object-rug-hall')).toBeLessThan(order.indexOf('object-table-2'))
  expect(order.indexOf('object-candle-3')).toBeGreaterThan(order.indexOf('object-table-2'))

  const chest = page.getByTestId('object-storage-chest')
  if (isMobile) await chest.tap()
  else await chest.hover()
  await expect(page.locator('.map-tooltip')).toContainText('Окованный сундук')
  await testInfo.attach('обстановка и свет', { body: await page.locator('.map-board').screenshot(), contentType: 'image/png' })
})

test('свет: источники с радиусом и тёплым свечением, тёмные углы вдали от света', async ({ page }) => {
  const lighting = page.getByTestId('map-lighting')
  await expect(lighting).toHaveAttribute('data-darkness', '0.5')
  // Камин, два факела, три свечи.
  await expect(lighting).toHaveAttribute('data-lights', '6')
  await expect(page.getByTestId('light-fireplace')).toBeVisible()
  await expect(page.locator('#light-mask circle')).toHaveCount(6)
  await expect(page.locator('rect.map-darkness')).toHaveAttribute('mask', 'url(#light-mask)')
})

test('масштаб: кнопки, «К герою» и «Вся карта»', async ({ page }, testInfo) => {
  expect(await zoom(page)).toBe(1)
  await expect(page.getByTestId('map-zoom-out')).toBeDisabled()
  await page.getByTestId('map-zoom-in').click()
  await expect.poll(() => zoom(page)).toBeCloseTo(1.5, 1)
  await page.getByTestId('map-center-hero').click()
  await expect.poll(() => zoom(page)).toBeGreaterThanOrEqual(2)
  await page.waitForTimeout(350)
  expect(await heroInView(page)).toBe(true)
  await expectNoHorizontalScroll(page)
  await testInfo.attach('к герою', { body: await page.locator('.map-board').screenshot(), contentType: 'image/png' })
  await page.getByTestId('map-reset').click()
  await expect.poll(() => zoom(page)).toBe(1)
  await expect(page.getByTestId('map-reset')).toHaveCount(0)
})

test.describe('десктоп: колесо и перетаскивание', () => {
  test.skip(({ isMobile }) => isMobile, 'только для мыши')

  test('колесо мыши приближает к курсору, перетаскивание сдвигает, щелчок после перетаскивания не открывает подсказку', async ({ page }) => {
    const errors = collectPageErrors(page)
    const viewport = page.getByTestId('map-viewport')
    const box = (await viewport.boundingBox())!
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.2)
    await page.mouse.wheel(0, -400)
    await expect.poll(() => zoom(page)).toBeGreaterThan(1.5)
    const before = await page.locator('.map-zoom').evaluate((el) => (el as HTMLElement).style.transform)
    // Перетаскивание начинается с предмета — после него подсказка не открывается.
    const table = (await page.getByTestId('object-table-2').boundingBox())!
    await page.mouse.move(table.x + table.width / 2, table.y + table.height / 2)
    await page.mouse.down()
    await page.mouse.move(table.x + table.width / 2 + 120, table.y + table.height / 2 + 60, { steps: 6 })
    await page.mouse.up()
    const after = await page.locator('.map-zoom').evaluate((el) => (el as HTMLElement).style.transform)
    expect(after).not.toBe(before)
    await expect(page.locator('.map-tooltip')).toHaveCount(0)
    // Колесо назад — вся карта.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, 3000)
    await expect.poll(() => zoom(page)).toBe(1)
    expect(errors).toEqual([])
  })
})

test.describe('телефон: два пальца', () => {
  test.skip(({ isMobile }) => !isMobile, 'только для сенсорного экрана')

  test('щипок двумя пальцами приближает, страница по ширине не прокручивается', async ({ page }, testInfo) => {
    const box = (await page.getByTestId('map-viewport').boundingBox())!
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.getByTestId('map-viewport').evaluate(
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
    await expectNoHorizontalScroll(page)
    await testInfo.attach('щипок', { body: await page.locator('.map-board').screenshot(), contentType: 'image/png' })
    await page.getByTestId('map-reset').tap()
    await expect.poll(() => zoom(page)).toBe(1)
  })
})

test('фишка НПС идёт по клеткам пути, а не прыгает', async ({ page }) => {
  const gunnar = page.getByTestId('npc-gunnar')
  await expect(gunnar).toHaveAttribute('data-x', '7')
  await expect(gunnar).toHaveAttribute('data-y', '1')
  const seen: string[] = []
  await page.exposeFunction('__seenCell', (cell: string) => seen.push(cell))
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="npc-gunnar"]')!
    new MutationObserver(() => (window as unknown as { __seenCell(c: string): void }).__seenCell(`${el.getAttribute('data-x')},${el.getAttribute('data-y')}`)).observe(el, {
      attributes: true,
      attributeFilter: ['data-x', 'data-y'],
    })
  })
  const location = await page.evaluate(() => (window as unknown as { __aiMaster: { getState(): { active: { world: { currentLocationId: string } } } } }).__aiMaster.getState().active.world.currentLocationId)
  await act(page, { type: 'npcMoved', locationId: location, npcId: 'gunnar', to: { x: 13, y: 4 } }, MASTER)
  await expect(gunnar).toHaveAttribute('data-walking', 'true')
  await expect(gunnar).toHaveAttribute('data-x', '13')
  await expect(gunnar).toHaveAttribute('data-y', '4')
  await expect(gunnar).not.toHaveAttribute('data-walking', 'true')
  // Прошёл через промежуточные клетки, по одной за шаг.
  expect(new Set(seen).size).toBeGreaterThanOrEqual(5)
  let prev = [7, 1]
  for (const cell of [...new Set(seen)]) {
    const [x, y] = cell.split(',').map(Number)
    expect(Math.max(Math.abs(x - prev[0]), Math.abs(y - prev[1]))).toBeLessThanOrEqual(1)
    prev = [x, y]
  }
})
