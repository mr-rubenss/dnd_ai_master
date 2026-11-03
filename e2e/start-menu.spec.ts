import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { collectPageErrors, expectNoHorizontalScroll, startQuickGame } from './helpers'

const createButton = (page: Page) => page.getByTestId('menu-create')
const quickStart = (page: Page) => page.getByTestId('menu-quick-start')
const continueButton = (page: Page) => page.getByTestId('menu-continue')
const creationHeading = (page: Page) => page.getByRole('heading', { name: 'Создание персонажа' })

/** Ход игрока в текущей игре — чтобы было что терять. */
async function makeMove(page: Page, text: string) {
  await page.locator('.player-input textarea').fill(text)
  await page.locator('.player-input textarea').press('Enter')
  await expect(page.locator('.message--player').last()).toContainText(text)
}

test.beforeEach(async ({ page }) => {
  await page.goto('./')
})

test('без сохранения: стартовый экран без «Продолжить»', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page)
  await expect(page.getByRole('heading', { name: 'Добро пожаловать к столу' })).toBeVisible()
  await expect(continueButton(page)).toHaveCount(0)
  await expect(createButton(page)).toBeVisible()
  await expect(quickStart(page)).toContainText('Быстрый старт (Ратибор)')
  await expect(page.locator('.header-button')).toHaveCount(0)
  await expectNoHorizontalScroll(page)
  await testInfo.attach('стартовый экран', { body: await page.screenshot(), contentType: 'image/png' })

  // Без сохранения подтверждение не спрашивается.
  page.on('dialog', () => {
    throw new Error('Без сохранения не должно быть подтверждения')
  })
  await createButton(page).click()
  await expect(creationHeading(page)).toBeVisible()
  await page.getByRole('button', { name: 'В меню' }).click()
  await expect(createButton(page)).toBeVisible()
  expect(errors).toEqual([])
})

test('с сохранением: «Продолжить» с именем героя и локацией', async ({ page }, testInfo) => {
  await startQuickGame(page)
  await makeMove(page, 'Сажусь у камина')
  await page.reload()

  await expect(continueButton(page)).toContainText('Ратибор · Воин 1 ур. · Таверна «Пьяный грифон»')
  await expect(page.locator('.start-menu-note')).toBeVisible()
  await expectNoHorizontalScroll(page)
  await testInfo.attach('стартовый экран с сохранением', { body: await page.screenshot(), contentType: 'image/png' })
  await continueButton(page).click()
  await expect(page.locator('.message--player').last()).toContainText('Сажусь у камина')
})

test('«Создать нового героя» при сохранении спрашивает подтверждение; игра заменяется только при старте нового', async ({
  page,
}) => {
  await startQuickGame(page)
  await makeMove(page, 'Старая история')
  await page.getByRole('button', { name: 'В меню' }).click()

  // Отказ — остаёмся в меню.
  let message = ''
  page.once('dialog', (dialog) => {
    message = dialog.message()
    void dialog.dismiss()
  })
  await createButton(page).click()
  expect(message).toContain('Текущая игра будет потеряна')
  await expect(continueButton(page)).toBeVisible()

  // Согласие — открывается создание, но сохранение живо, пока новый герой не начал игру.
  page.once('dialog', (dialog) => void dialog.accept())
  await createButton(page).click()
  await expect(creationHeading(page)).toBeVisible()
  await page.getByRole('button', { name: 'В меню' }).click()
  await continueButton(page).click()
  await expect(page.locator('.message--player').last()).toContainText('Старая история')
})

test('«Быстрый старт» при сохранении тоже спрашивает подтверждение и начинает игру заново', async ({ page }) => {
  await startQuickGame(page)
  await makeMove(page, 'Старая история')
  await page.getByRole('button', { name: 'В меню' }).click()

  page.once('dialog', (dialog) => void dialog.dismiss())
  await quickStart(page).click()
  await expect(continueButton(page)).toBeVisible()

  page.once('dialog', (dialog) => void dialog.accept())
  await quickStart(page).click()
  await expect(page.locator('.dice-tray-button')).toBeVisible()
  await expect(page.locator('.message--player')).toHaveCount(0)
})
