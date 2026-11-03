import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { collectPageErrors, continueGame, expectNoHorizontalScroll, startQuickGame } from './helpers'

const HEROES_KEY = 'ai-master:heroes'
const STORY = 'Вечер в «Пьяном грифоне»'

const heroCard = (page: Page, id: string) => page.getByTestId(`hero-${id}`)

async function openHeroes(page: Page) {
  await page.getByRole('button', { name: 'В меню' }).click()
  await page.getByTestId('menu-heroes').click()
  await expect(page.getByRole('heading', { name: 'Мои герои' })).toBeVisible()
}

/** Добавляет в «Мои герои» второго героя — копию Ратибора по имени Ингрид — и перезагружает страницу. */
async function addIngrid(page: Page) {
  await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key)!)
    const hero = structuredClone(saved.roster.heroes[0])
    hero.id = 'ingrid'
    hero.storyId = null
    hero.sheet.character.id = 'ingrid'
    hero.sheet.character.name = 'Ингрид'
    saved.roster.heroes.push(hero)
    localStorage.setItem(key, JSON.stringify(saved))
  }, HEROES_KEY)
  await page.reload()
  await page.getByTestId('menu-heroes').click()
}

test.beforeEach(async ({ page }) => {
  await page.goto('./')
  await startQuickGame(page)
})

test('карточка героя: портрет, имя, вид, класс, уровень и история', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page)
  await openHeroes(page)
  await expect(page.getByRole('tab', { name: 'Герои (1)' })).toHaveAttribute('aria-selected', 'true')
  const card = heroCard(page, 'ratibor')
  await expect(card.locator('.hero-portrait')).toHaveText('⚔️')
  await expect(card.locator('.hero-name')).toHaveText('Ратибор')
  await expect(card.locator('.hero-meta')).toHaveText('Человек · Воин 1 ур.')
  await expect(card.getByTestId('hero-story')).toHaveText(`В истории «${STORY}»`)
  // Героя из незавершённой истории удалить нельзя.
  await expect(card.getByRole('button', { name: 'Удалить' })).toBeDisabled()
  await expectNoHorizontalScroll(page)
  await testInfo.attach('мои герои', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

  await card.getByRole('button', { name: 'Продолжить' }).click()
  await expect(page.locator('.dice-tray-button')).toBeVisible()
  expect(errors).toEqual([])
})

test('лист персонажа открывается поверх списка и закрывается', async ({ page }) => {
  await openHeroes(page)
  await heroCard(page, 'ratibor').getByRole('button', { name: 'Лист персонажа' }).click()
  const dialog = page.getByRole('dialog', { name: 'Ратибор' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByTestId('hero-sheet-ac')).toHaveText('16')
  await expect(dialog).toContainText('Двуручный меч')
  await expect(dialog).toContainText('Атлетика')
  await expectNoHorizontalScroll(page)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('переименование: в списке и в идущей игре; пустое имя — с объяснением', async ({ page, isMobile }) => {
  await openHeroes(page)
  const card = heroCard(page, 'ratibor')
  await card.getByRole('button', { name: 'Переименовать' }).click()
  await card.getByLabel('Новое имя').fill('   ')
  await card.getByRole('button', { name: 'Сохранить' }).click()
  await expect(card.getByRole('alert')).toHaveText('Введите имя героя.')

  await card.getByLabel('Новое имя').fill('Ратибор Гроза')
  await card.getByRole('button', { name: 'Сохранить' }).click()
  await expect(card.locator('.hero-name')).toHaveText('Ратибор Гроза')

  await card.getByRole('button', { name: 'Продолжить' }).click()
  if (isMobile) await page.locator('.inventory-toggle').click()
  await expect(page.locator('.character-name')).toHaveText('Ратибор Гроза')
})

test('новая история за другого героя прерывает текущую; свободного героя можно удалить', async ({ page }) => {
  await openHeroes(page)
  await addIngrid(page)
  const ingrid = heroCard(page, 'ingrid')
  await expect(ingrid.getByTestId('hero-story')).toHaveText('Вне истории')

  // Отказ — ничего не меняется.
  page.once('dialog', (dialog) => void dialog.dismiss())
  await ingrid.getByRole('button', { name: 'Начать историю' }).click()
  await expect(heroCard(page, 'ratibor').getByTestId('hero-story')).toHaveText(`В истории «${STORY}»`)

  // Согласие — Ингрид в новой истории, Ратибор свободен.
  page.once('dialog', (dialog) => void dialog.accept())
  await ingrid.getByRole('button', { name: 'Начать историю' }).click()
  await expect(page.locator('.dice-tray-button')).toBeVisible()
  await openHeroes(page)
  await expect(heroCard(page, 'ingrid').getByTestId('hero-story')).toHaveText(`В истории «${STORY}»`)
  const ratibor = heroCard(page, 'ratibor')
  await expect(ratibor.getByTestId('hero-story')).toHaveText('Вне истории')

  // Удаление — с подтверждением.
  let message = ''
  page.once('dialog', (dialog) => {
    message = dialog.message()
    void dialog.dismiss()
  })
  await ratibor.getByRole('button', { name: 'Удалить' }).click()
  expect(message).toBe('Удалить героя «Ратибор»? Это нельзя отменить.')
  await expect(ratibor).toBeVisible()
  page.once('dialog', (dialog) => void dialog.accept())
  await ratibor.getByRole('button', { name: 'Удалить' }).click()
  await expect(ratibor).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Герои (1)' })).toBeVisible()

  // Всё переживает перезагрузку.
  await page.reload()
  await continueGame(page)
  await openHeroes(page)
  await expect(page.locator('.hero-card')).toHaveCount(1)
})

test('завершённая история: герой в «Зале славы» с итогом пути', async ({ page }, testInfo) => {
  await page.locator('.player-input textarea').fill('Заказываю эль')
  await page.locator('.player-input textarea').press('Enter')
  await expect(page.locator('.message--master')).toHaveCount(3)

  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByTestId('finish-story').click()
  await expect(page.getByRole('tab', { name: 'Зал славы (1)' })).toHaveAttribute('aria-selected', 'true')
  const entry = page.getByTestId('hall-ratibor')
  await expect(entry.locator('.hero-name')).toHaveText('Ратибор')
  await expect(entry.locator('.fate-badge')).toHaveText('История завершена')
  await expect(entry.getByTestId('hall-summary')).toHaveText(`История «${STORY}» завершена на 1-м уровне. 1 ход, 0 бросков кубиков.`)
  await expectNoHorizontalScroll(page)
  await testInfo.attach('зал славы', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

  // Героя больше нет среди героев, а игру продолжить нельзя.
  await page.getByRole('tab', { name: 'Герои (0)' }).click()
  await expect(page.locator('.heroes-empty')).toBeVisible()
  await page.getByRole('button', { name: 'В меню' }).click()
  await expect(page.getByTestId('menu-continue')).toHaveCount(0)
})

test('погибший герой в «Зале славы» отмечен гибелью', async ({ page }) => {
  await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key)!)
    saved.roster.hallOfFame.push({
      id: 'fallen-1',
      heroId: 'brom',
      name: 'Бром',
      species: 'Дварф',
      className: 'Жрец',
      level: 3,
      portrait: '✨',
      fate: 'fallen',
      storyTitle: 'Тёмный склеп',
      summary: 'Гибель в истории «Тёмный склеп» на 3-м уровне. 42 хода, 57 бросков кубиков.',
      endedAt: Date.UTC(2026, 0, 15),
    })
    localStorage.setItem(key, JSON.stringify(saved))
  }, HEROES_KEY)
  await page.reload()
  await page.getByTestId('menu-heroes').click()
  await page.getByRole('tab', { name: 'Зал славы (1)' }).click()
  const entry = page.getByTestId('hall-brom')
  await expect(entry.locator('.fate-badge')).toHaveText('Гибель')
  await expect(entry.locator('.hero-meta')).toHaveText('Дварф · Жрец 3 ур.')
  await expect(entry.locator('time')).toHaveText('15.01.2026')
  await expect(entry.getByTestId('hall-summary')).toContainText('Тёмный склеп')
})
