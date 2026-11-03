import { expect, test } from './fixtures'
import { collectPageErrors, continueGame, expectNoHorizontalScroll, startQuickGame } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('./')
  await startQuickGame(page)
})

test('карта: тонкие стены по границам клеток, весь план — пол', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page)
  const map = page.locator('.map-svg')
  await expect(map).toBeVisible()

  // Стен-клеток больше нет: 20×14 клеток пола, стены — линии.
  await expect(map.locator('rect.wall')).toHaveCount(0)
  await expect(map.locator('rect.floor')).toHaveCount(20 * 14)
  const walls = map.locator('.wall-line')
  expect(await walls.count()).toBeGreaterThan(4)
  await expect(map.locator('.wall-line--wood')).not.toHaveCount(0)

  // Линия стены тонкая: толщина — малая доля клетки (1 единица карты).
  const strokeWidths = await walls.evaluateAll((lines) => lines.map((l) => parseFloat(getComputedStyle(l).strokeWidth)))
  expect(Math.max(...strokeWidths)).toBeLessThan(0.25)

  // Двери и окна — на стенах.
  await expect(page.getByTestId('door-entrance')).toHaveAttribute('data-state', 'closed')
  await expect(page.getByTestId('door-storage-door')).toHaveAttribute('data-state', 'locked')
  await expect(page.getByTestId('door-storage-door').locator('.door-lock')).toHaveCount(1)
  await expect(map.locator('[data-testid^="window-"]')).toHaveCount(3)

  await expectNoHorizontalScroll(page)
  await testInfo.attach('карта', { body: await page.locator('.map-board').screenshot(), contentType: 'image/png' })
  expect(errors).toEqual([])
})

test('подсказка двери показывает её состояние', async ({ page, isMobile }) => {
  const door = page.getByTestId('door-storage-door')
  if (isMobile) await door.tap()
  else await door.hover()
  const tooltip = page.locator('.map-tooltip')
  await expect(tooltip).toContainText('Дверь в кладовую')
  await expect(tooltip).toContainText('Заперта')
})

test('открытая дверь выглядит иначе, чем закрытая', async ({ page }, testInfo) => {
  const entrance = page.getByTestId('door-entrance')
  await expect(entrance.locator('.door-leaf')).toHaveCount(1)
  await expect(entrance.locator('.door-leaf-open')).toHaveCount(0)
  const closedShot = await entrance.screenshot()

  // Состояние двери — в состоянии игры; открываем её в сохранении и продолжаем игру.
  await page.evaluate(() => {
    const save = JSON.parse(localStorage.getItem('ai-master:save')!)
    save.state.location.doors.entrance = 'open'
    localStorage.setItem('ai-master:save', JSON.stringify(save))
  })
  await page.reload()
  await continueGame(page)

  await expect(entrance).toHaveAttribute('data-state', 'open')
  await expect(entrance.locator('.door-leaf')).toHaveCount(0)
  // Двустворчатая входная дверь: две распахнутые створки с дугами хода.
  await expect(entrance.locator('.door-leaf-open')).toHaveCount(2)
  await expect(entrance.locator('.door-swing')).toHaveCount(2)
  const openShot = await entrance.screenshot()
  expect(openShot.equals(closedShot)).toBe(false)
  await testInfo.attach('открытая дверь', { body: openShot, contentType: 'image/png' })
})
