import { expect, test } from './fixtures'
import { collectPageErrors, expectNoHorizontalScroll, flushSaves, startQuickGame } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('./')
  await startQuickGame(page)
})

test('главный экран: карта таверны, персонаж, лента ведущего', async ({ page, isMobile }, testInfo) => {
  const errors = collectPageErrors(page)
  await expect(page).toHaveTitle('ИИ-Мастер')
  await expect(page.locator('.map-panel h2')).toHaveText('Таверна «Пьяный грифон»')
  await expect(page.locator('.map-entity[aria-label="Гуннар"]')).toBeVisible()
  await expect(page.locator('.message--master').first()).toBeVisible()

  if (isMobile) {
    // На телефоне инвентарь свёрнут в кнопку со сводкой.
    await expect(page.locator('.inventory-toggle')).toContainText('КД 16')
    await page.locator('.inventory-toggle').tap()
  }
  await expect(page.locator('.character-name')).toHaveText('Ратибор')
  await expect(page.locator('.character-meta')).toContainText('Воин 1 ур.')
  await expect(page.locator('.character-stats')).toContainText('16')

  await expectNoHorizontalScroll(page)
  await testInfo.attach('главный экран', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  expect(errors).toEqual([])
})

test('подсказка на карте по наведению или нажатию', async ({ page, isMobile }) => {
  const tobias = page.locator('.map-entity[aria-label="Тобиас"]')
  if (isMobile) await tobias.tap()
  else await tobias.hover()
  const tooltip = page.locator('.map-tooltip')
  await expect(tooltip).toContainText('Тобиас')
  await expect(tooltip).toContainText('Враждебен')
  await page.keyboard.press('Escape')
  await expect(tooltip).toHaveCount(0)
})

test('описание предмета раскрывается по нажатию', async ({ page, isMobile }) => {
  if (isMobile) await page.locator('.inventory-toggle').tap()
  await page.getByRole('tab', { name: 'Снаряжение' }).click()
  const item = page.locator('.item-button', { hasText: 'Двуручный меч' })
  await item.click()
  await expect(item).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.item-details')).toContainText('2к6 рубящий')
  await expectNoHorizontalScroll(page)
})

test('ход игрока сохраняется; после перезагрузки — стартовый экран с «Продолжить»', async ({ page }) => {
  await page.locator('.player-input textarea').fill('Заказываю кружку эля')
  await page.locator('.player-input textarea').press('Enter')
  await expect(page.locator('.message--player').last()).toContainText('Заказываю кружку эля')

  await flushSaves(page)
  await page.reload()
  await expect(page.getByTestId('menu-continue')).toContainText('Ратибор · Воин 1 ур. · Таверна «Пьяный грифон»')
  await page.getByTestId('menu-continue').click()
  await expect(page.locator('.message--player').last()).toContainText('Заказываю кружку эля')
})

test('«В меню» из игры и обратно без потери прогресса', async ({ page }) => {
  await expect(page.locator('.header-button', { hasText: 'Новая игра' })).toHaveCount(0)
  await page.locator('.player-input textarea').fill('Жду')
  await page.locator('.player-input textarea').press('Enter')
  await page.getByRole('button', { name: 'В меню' }).click()
  await expect(page.getByTestId('menu-continue')).toBeVisible()
  await expectNoHorizontalScroll(page)
  await page.getByTestId('menu-continue').click()
  await expect(page.locator('.message--player').last()).toContainText('Жду')
})
