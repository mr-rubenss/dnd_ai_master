// Измерения на клеточной карте: линейка (футы по правилу сетки — диагональ 5 футов), шаблоны областей с подсветкой
// задетых клеток и списком задетых (скрытых НПС игрок не видит), область ведущего (show_area → areaShown).
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { act, collectPageErrors, expectNoHorizontalScroll, MASTER, startQuickGame } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('./')
  await startQuickGame(page)
  await page.locator('.map-board').scrollIntoViewIfNeeded()
})

/** Точка карты (в клетках, непрерывная) на экране. */
async function mapPoint(page: Page, x: number, y: number) {
  return page.locator('.map-svg').evaluate(
    (svg, [px, py]) => {
      const p = new DOMPoint(px, py).matrixTransform((svg as SVGSVGElement).getScreenCTM()!)
      return { x: p.x, y: p.y }
    },
    [x, y],
  )
}

/** Протянуть по карте мышью или пальцем (на телефоне — касания через CDP, как в hero-move.spec.ts). */
async function dragOnMap(page: Page, isMobile: boolean, from: [number, number], to: [number, number]) {
  const a = await mapPoint(page, ...from)
  const b = await mapPoint(page, ...to)
  const steps = 8
  const at = (i: number) => ({ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps })
  if (isMobile) {
    const cdp = await page.context().newCDPSession(page)
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', p?: { x: number; y: number }) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] })
    await touch('touchStart', a)
    for (let i = 1; i <= steps; i++) await touch('touchMove', at(i))
    await touch('touchEnd')
  } else {
    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    for (let i = 1; i <= steps; i++) await page.mouse.move(at(i).x, at(i).y)
    await page.mouse.up()
  }
}

const press = (page: Page, isMobile: boolean, testId: string) => (isMobile ? page.getByTestId(testId).tap() : page.getByTestId(testId).click())

test('линейка: расстояние в футах, диагональ — 5 футов; герой не двигается; страница не прокручивается', async ({ page, isMobile }, testInfo) => {
  const errors = collectPageErrors(page)
  const hero = page.getByTestId('player-token')
  await press(page, isMobile, 'measure-ruler-button')
  await expect(page.getByTestId('measure-ruler-button')).toHaveAttribute('aria-pressed', 'true')
  const scrollBefore = await page.evaluate(() => window.scrollY)
  // От героя (10, 13) к (6, 10): 4 клетки по горизонтали, 3 по вертикали — 4 шага, 20 футов.
  await dragOnMap(page, isMobile, [10.5, 13.5], [6.5, 10.5])
  await expect(page.getByTestId('measure-ruler')).toHaveAttribute('data-feet', '20')
  await expect(page.getByTestId('measure-info')).toHaveText(/Линейка: 20 фт\. \(4 кл\.\)/)
  await expect(hero).toHaveAttribute('data-x', '10')
  await expect(hero).toHaveAttribute('data-y', '13')
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore)
  // Снимок элемента прокручивает к нему страницу — поэтому после проверки прокрутки.
  await testInfo.attach('линейка', { body: await page.locator('.map-panel').screenshot(), contentType: 'image/png' })
  // Строго по диагонали: 3 клетки — 15 футов.
  await dragOnMap(page, isMobile, [10.5, 13.5], [7.5, 10.5])
  await expect(page.getByTestId('measure-info')).toHaveText(/Линейка: 15 фт\. \(3 кл\.\)/)
  await expectNoHorizontalScroll(page)
  // Выключить линейку — измерение пропадает, нажатия снова идут карте.
  await press(page, isMobile, 'measure-ruler-button')
  await expect(page.getByTestId('measure-surface')).toHaveCount(0)
  await expect(page.getByTestId('measure-ruler')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('шаблоны: сфера рядом с Гуннаром задевает его; скрытый Шнырь в список не попадает; конус от героя', async ({ page, isMobile }, testInfo) => {
  const errors = collectPageErrors(page)
  await press(page, isMobile, 'measure-area-button')
  const shapes = page.getByRole('group', { name: 'Фигура области' })
  await expect(shapes.locator('button')).toHaveText(['Конус', 'Сфера', 'Куб', 'Линия', 'Цилиндр', 'Излучение'])
  await expectNoHorizontalScroll(page)
  await shapes.getByRole('button', { name: 'Сфера' }).click()
  await expect(page.getByTestId('measure-area-button')).toHaveText('Сфера')

  // Сфера 10 фт. из узла (7, 2): клетка Гуннара (7, 1) — внутри.
  await dragOnMap(page, isMobile, [7.05, 2.05], [9.05, 2.05])
  const area = page.getByTestId('measure-area')
  await expect(area).toHaveAttribute('data-shape', 'sphere')
  await expect(area).toHaveAttribute('data-size', '10')
  expect(Number(await area.getAttribute('data-cells'))).toBeGreaterThan(4)
  await expect(page.getByTestId('measure-info')).toContainText('Сфера 10 фт.')
  await expect(page.getByTestId('measure-creatures')).toHaveText(/Задеты: .*Гуннар/)
  await testInfo.attach('сфера', { body: await page.locator('.map-panel').screenshot(), contentType: 'image/png' })

  // Сфера у скрытого карманника (19, 13): игрок его не видит — «Никого не задевает».
  await dragOnMap(page, isMobile, [19.5, 13.5], [19.5, 12.4])
  await expect(page.getByTestId('measure-creatures')).toHaveText('Никого не задевает')

  // Конус от героя на север: начало у края клетки героя, 15 футов.
  await press(page, isMobile, 'measure-area-button')
  await press(page, isMobile, 'measure-area-button')
  await shapes.getByRole('button', { name: 'Конус' }).click()
  await dragOnMap(page, isMobile, [10.5, 13.5], [10.5, 10])
  await expect(area).toHaveAttribute('data-shape', 'cone')
  await expect(area).toHaveAttribute('data-size', '15')
  await expect(page.getByTestId('measure-info')).toContainText('Конус 15 фт.')
  await expect(page.getByTestId('player-token')).toHaveAttribute('data-x', '10')
  await expectNoHorizontalScroll(page)
  await page.getByTestId('measure-close').click()
  await expect(area).toHaveCount(0)
  expect(errors).toEqual([])
})

test('область ведущего (show_area): подсветка, подпись, кто задет; «Скрыть»', async ({ page }, testInfo) => {
  const template = { shape: 'sphere', size: 20, origin: { x: 12.5, y: 13.5 } }
  await act(page, { type: 'areaShown', area: { id: 'area-1', locationId: 'drunken-griffin', template, label: 'Свет факела' } }, MASTER)
  const area = page.getByTestId('master-area')
  await expect(area).toHaveAttribute('data-shape', 'sphere')
  await expect(page.getByTestId('master-area-info')).toContainText('Ведущий: Свет факела · Сфера 20 фт.')
  await expect(page.getByTestId('master-area-creatures')).toHaveText('Задеты: Вы')
  await testInfo.attach('область ведущего', { body: await page.locator('.map-panel').screenshot(), contentType: 'image/png' })
  await expectNoHorizontalScroll(page)
  await page.getByTestId('master-area-close').click()
  await expect(area).toHaveCount(0)
})
