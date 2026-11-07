import { expect, test } from './fixtures'
import { act, collectPageErrors, expectNoHorizontalScroll, MASTER, reloadAndContinue, startQuickGame } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('./')
  await startQuickGame(page)
})

test('карта: узоры пола по областям, тонкие стены по границам клеток, весь план — пол', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page)
  const map = page.locator('.map-svg')
  await expect(map).toBeVisible()

  // Пол — не сотни клеток, а по одной фигуре с узором на тип: доски зала и камень кладовой, вместе — весь план 20×14.
  await expect(map.locator('rect.floor')).toHaveCount(0)
  const areas = map.locator('path.floor-area')
  await expect(areas).toHaveCount(2)
  await expect(map.locator('path.floor-area--wood')).toHaveAttribute('fill', 'url(#floor-wood)')
  await expect(map.locator('path.floor-area--stone')).toHaveAttribute('data-cells', '25')
  const cells = await areas.evaluateAll((list) => list.reduce((n, el) => n + Number(el.getAttribute('data-cells')), 0))
  expect(cells).toBe(20 * 14)
  for (const floor of ['wood', 'stone', 'tile', 'dirt', 'grass']) await expect(map.locator(`pattern#floor-${floor}`)).toHaveCount(1)

  await expect(map.locator('rect.wall')).toHaveCount(0)
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

  // Состояние двери — в состоянии истории: ведущий открывает дверь действием, после перезагрузки она открыта.
  await act(page, { type: 'doorChanged', locationId: 'drunken-griffin', doorId: 'entrance', state: 'open' }, MASTER)
  await reloadAndContinue(page)

  await expect(entrance).toHaveAttribute('data-state', 'open')
  await expect(entrance.locator('.door-leaf')).toHaveCount(0)
  // Двустворчатая входная дверь: две распахнутые створки с дугами хода.
  await expect(entrance.locator('.door-leaf-open')).toHaveCount(2)
  await expect(entrance.locator('.door-swing')).toHaveCount(2)
  const openShot = await entrance.screenshot()
  expect(openShot.equals(closedShot)).toBe(false)
  await testInfo.attach('открытая дверь', { body: openShot, contentType: 'image/png' })
})

test('подсказка НПС: видно, чем он занят сейчас, — а цель и страх только ведущему; занятие меняется', async ({ page, isMobile }) => {
  const gunnar = page.getByTestId('npc-gunnar')
  const show = async () => (isMobile ? gunnar.tap() : gunnar.hover())
  await show()
  const tooltip = page.locator('.map-tooltip')
  await expect(tooltip).toContainText('Гуннар')
  await expect(tooltip.getByTestId('npc-activity')).toHaveText('Сейчас: Протирает кружки за стойкой и краем глаза следит за человеком в капюшоне.')
  await expect(tooltip).not.toContainText('долг гильдии')
  await expect(tooltip).not.toContainText('наёмник')
  await expectNoHorizontalScroll(page)

  const location = await page.evaluate(() => (window as unknown as { __aiMaster: { getState(): { active: { world: { currentLocationId: string } } } } }).__aiMaster.getState().active.world.currentLocationId)
  await act(page, { type: 'npcUpdated', locationId: location, npcId: 'gunnar', changes: { activity: 'Спустился в погреб за бочонком.' } }, MASTER)
  // Подсказка открыта — занятие обновляется сразу.
  await expect(page.locator('.map-tooltip').getByTestId('npc-activity')).toHaveText('Сейчас: Спустился в погреб за бочонком.')
})
