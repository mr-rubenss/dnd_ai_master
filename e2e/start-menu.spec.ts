import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { collectPageErrors, expectNoHorizontalScroll, flushSaves, startQuickGame } from './helpers'

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
  // В шапке меню — только кисть оформления.
  await expect(page.locator('.header-button')).toHaveCount(1)
  await expect(page.getByTestId('settings-open')).toBeVisible()
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
  await flushSaves(page)
  await page.reload()

  await expect(continueButton(page)).toContainText('«Вечер в «Пьяном грифоне»»: Ратибор · Воин 1 ур. · Таверна «Пьяный грифон»')
  await expectNoHorizontalScroll(page)
  await testInfo.attach('стартовый экран с сохранением', { body: await page.screenshot(), contentType: 'image/png' })
  await continueButton(page).click()
  await expect(page.locator('.message--player').last()).toContainText('Сажусь у камина')
})

test('«Создать нового героя» при сохранении открывает создание без вопросов — история цела', async ({ page }) => {
  await startQuickGame(page)
  await makeMove(page, 'Старая история')
  await page.getByRole('button', { name: 'В меню' }).click()

  // Создать героя можно и не прерывая историю: подтверждение спросят только при старте новой.
  page.on('dialog', () => {
    throw new Error('Открытие создания не должно спрашивать подтверждение')
  })
  await createButton(page).click()
  await expect(creationHeading(page)).toBeVisible()
  await page.getByRole('button', { name: 'В меню' }).click()
  await continueButton(page).click()
  await expect(page.locator('.message--player').last()).toContainText('Старая история')
})

test('«Быстрый старт», когда Ратибор уже в истории, продолжает её — без вопросов и без потерь', async ({ page }) => {
  await startQuickGame(page)
  await makeMove(page, 'Старая история')
  await page.getByRole('button', { name: 'В меню' }).click()

  page.on('dialog', () => {
    throw new Error('Быстрый старт не должен ничего прерывать')
  })
  await quickStart(page).click()
  await expect(page.locator('.dice-tray-button')).toBeVisible()
  await expect(page.locator('.message--player').last()).toContainText('Старая история')
  await page.getByRole('button', { name: 'В меню' }).click()
  await page.getByTestId('menu-stories').click()
  await expect(page.locator('.story-card')).toHaveCount(1)
})
