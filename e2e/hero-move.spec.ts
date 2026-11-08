// Интерактивный токен героя: перетаскивание мышью и пальцем (путь A*, длина в футах, недоступные клетки), нажатие на
// клетку, нельзя в стену, на занятую клетку и за закрытую дверь; токены НПС игрок не двигает; меню действий у НПС,
// дверей и предметов отправляет сообщение ведущему от имени героя.
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { collectPageErrors, expectNoHorizontalScroll, flushSaves, reloadAndContinue, startQuickGame } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('./')
  await startQuickGame(page)
})

/** Центр клетки карты на экране (с учётом поля вокруг карты и масштаба). */
async function cellPoint(page: Page, x: number, y: number) {
  return page.locator('.map-svg').evaluate(
    (svg, [cx, cy]) => {
      const p = new DOMPoint(cx + 0.5, cy + 0.5).matrixTransform((svg as SVGSVGElement).getScreenCTM()!)
      return { x: p.x, y: p.y }
    },
    [x, y],
  )
}

const hero = (page: Page) => page.getByTestId('player-token')
async function expectHeroAt(page: Page, x: number, y: number) {
  await expect(hero(page)).toHaveAttribute('data-x', String(x))
  await expect(hero(page)).toHaveAttribute('data-y', String(y))
  await expect(hero(page)).not.toHaveAttribute('data-walking', 'true')
}

test.describe('мышь', () => {
  test.skip(({ isMobile }) => isMobile, 'только для мыши')

  test('перетаскивание: путь, длина в футах, недоступные клетки; токен идёт по пути; позиция сохраняется', async ({ page }, testInfo) => {
    const errors = collectPageErrors(page)
    await expectHeroAt(page, 10, 13)
    const start = await cellPoint(page, 10, 13)
    const target = await cellPoint(page, 6, 10)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(target.x, target.y, { steps: 8 })
    // Во время перетаскивания: путь, «20 фт.» (по 5 фт. за клетку, диагональ — тоже 5), недоступные клетки подсвечены.
    await expect(page.getByTestId('drag-overlay')).toBeVisible()
    await expect(page.getByTestId('drag-target')).toHaveAttribute('data-valid', 'true')
    await expect(page.getByTestId('drag-distance')).toHaveText('20 фт.')
    await expect(page.getByTestId('drag-path')).toHaveAttribute('data-steps', '4')
    await expect(page.getByTestId('map-unreachable')).toHaveCount(1)
    await testInfo.attach('перетаскивание героя', { body: await page.locator('.map-board').screenshot(), contentType: 'image/png' })
    await page.mouse.up()
    await expect(page.getByTestId('drag-overlay')).toHaveCount(0)
    // Идёт по клеткам, а не прыгает.
    await expect(hero(page)).toHaveAttribute('data-walking', 'true')
    await expectHeroAt(page, 6, 10)
    // Перемещение — действие хранилища: после перезагрузки герой там же.
    await flushSaves(page)
    await reloadAndContinue(page)
    await expectHeroAt(page, 6, 10)
    expect(errors).toEqual([])
  })

  test('отпустить в занятую клетку или за запертую дверь нельзя — герой на месте, причина видна', async ({ page }) => {
    const start = await cellPoint(page, 10, 13)
    const gunnar = await cellPoint(page, 7, 1)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(gunnar.x, gunnar.y, { steps: 8 })
    await expect(page.getByTestId('drag-target')).toHaveAttribute('data-valid', 'false')
    await expect(page.getByTestId('drag-distance')).toHaveText('нельзя')
    await page.mouse.up()
    await expect(page.getByTestId('map-notice')).toHaveText('Клетка занята: НПС «Гуннар».')
    await expectHeroAt(page, 10, 13)

    const storeroom = await cellPoint(page, 17, 3)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(storeroom.x, storeroom.y, { steps: 8 })
    await page.mouse.up()
    await expect(page.getByTestId('map-notice')).toContainText('Туда не дойти')
    await expectHeroAt(page, 10, 13)
  })

  test('токен НПС не перетаскивается — двигает только ведущий', async ({ page }) => {
    const from = await cellPoint(page, 7, 1)
    const to = await cellPoint(page, 7, 4)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 8 })
    await page.mouse.up()
    await expect(page.getByTestId('npc-gunnar')).toHaveAttribute('data-x', '7')
    await expect(page.getByTestId('npc-gunnar')).toHaveAttribute('data-y', '1')
    await expect(page.getByTestId('drag-overlay')).toHaveCount(0)
  })
})

test.describe('касание', () => {
  test.skip(({ isMobile }) => !isMobile, 'только для сенсорного экрана')

  test('перетаскивание пальцем: путь виден, страница не прокручивается, герой идёт', async ({ page, context }, testInfo) => {
    await page.locator('.map-board').scrollIntoViewIfNeeded()
    const scrollBefore = await page.evaluate(() => window.scrollY)
    const start = await cellPoint(page, 10, 13)
    const target = await cellPoint(page, 13, 10)
    const cdp = await context.newCDPSession(page)
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', p?: { x: number; y: number }) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] })
    await touch('touchStart', start)
    for (let i = 1; i <= 8; i++) await touch('touchMove', { x: start.x + ((target.x - start.x) * i) / 8, y: start.y + ((target.y - start.y) * i) / 8 })
    await expect(page.getByTestId('drag-distance')).toHaveText('15 фт.')
    await testInfo.attach('перетаскивание пальцем', { body: await page.locator('.map-board').screenshot(), contentType: 'image/png' })
    await touch('touchEnd')
    await expectHeroAt(page, 13, 10)
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore)
    await expectNoHorizontalScroll(page)
  })
})

test('нажатие на клетку — герой идёт туда по пути', async ({ page, isMobile }) => {
  // Клетка вдали от мебели: на телефоне Chrome «притягивает» нажатие к ближайшему кликабельному предмету.
  const cell = await cellPoint(page, 8, 12)
  if (isMobile) await page.touchscreen.tap(cell.x, cell.y)
  else await page.mouse.click(cell.x, cell.y)
  await expect(hero(page)).toHaveAttribute('data-walking', 'true')
  await expectHeroAt(page, 8, 12)
})

test('меню действий: «Поговорить» с НПС, «Открыть» дверь, «Подойти» — сообщение ведущему от имени героя', async ({ page, isMobile }, testInfo) => {
  const press = async (testId: string) => (isMobile ? page.getByTestId(testId).tap() : page.getByTestId(testId).click())
  await press('npc-gunnar')
  const menu = page.getByTestId('map-actions')
  await expect(menu.locator('button')).toHaveText(['Подойти', 'Осмотреть', 'Поговорить'])
  await expectNoHorizontalScroll(page)
  await testInfo.attach('меню действий', { body: await page.locator('.map-board').screenshot(), contentType: 'image/png' })
  await menu.getByRole('button', { name: 'Поговорить' }).click()
  await expect(page.locator('.message--player').last()).toHaveText(/Заговариваю с «Гуннар»\./)
  await expect(page.locator('.message--master').last()).toContainText('Ведущий задумчиво молчит')

  await press('door-entrance')
  await expect(menu.locator('button')).toHaveText(['Подойти', 'Осмотреть', 'Открыть'])
  await expect(page.locator('.message--master').last()).toContainText('Ведущий задумчиво молчит')
  await menu.getByRole('button', { name: 'Открыть' }).click()
  await expect(page.locator('.message--player').last()).toHaveText(/Открываю дверь «Входная дверь»\./)
  // Дверь сама не открылась: решает ведущий (инструментом set_door).
  await expect(page.getByTestId('door-entrance')).toHaveAttribute('data-state', 'closed')

  await press('npc-tobias')
  await menu.getByRole('button', { name: 'Подойти' }).click()
  await expect(page.locator('.message--player').last()).toHaveText(/Подхожу к «Тобиас»\./)
  await expect(hero(page)).not.toHaveAttribute('data-walking', 'true')
  const x = Number(await hero(page).getAttribute('data-x'))
  const y = Number(await hero(page).getAttribute('data-y'))
  expect(Math.max(Math.abs(x - 17), Math.abs(y - 9))).toBe(1)

  // Предмет — «Взять».
  await expect(page.locator('.message--master').last()).toContainText('Ведущий задумчиво молчит')
  await press('object-candle-2')
  await expect(menu.getByRole('button', { name: 'Взять' })).toBeVisible()
})
