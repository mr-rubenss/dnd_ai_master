import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { act, collectPageErrors, ENGINE, expectNoHorizontalScroll, flushSaves, MASTER, startQuickGame } from './helpers'

const STORY = 'Вечер в «Пьяном грифоне»'
const EDITED = 'Ратибор вернул Гуннару украденный кошелёк. Тобиас сбежал через погреб. Таверна снова спит спокойно.'

async function openSheetTab(page: Page, isMobile: boolean, tab: 'Характеристики' | 'Снаряжение') {
  if (isMobile && (await page.locator('.inventory-toggle').getAttribute('aria-expanded')) !== 'true') await page.locator('.inventory-toggle').click()
  await page.getByRole('tab', { name: tab }).click()
}

test.beforeEach(async ({ page }) => {
  await page.goto('./')
  await startQuickGame(page)
})

test('завершение истории: окно итога, только чтение, «Летопись» героя переходит в новую историю', async ({ page, isMobile }, testInfo) => {
  const errors = collectPageErrors(page)
  // События истории: задание, факт, находка, ход игрока.
  await act(page, { type: 'questUpdated', quest: { id: 'q1', title: 'Вернуть кошелёк', status: 'completed', notes: '' } }, MASTER)
  await act(page, { type: 'factRecorded', fact: { id: 'f1', text: 'Тобиас работает на гильдию воров', at: 1 } }, MASTER)
  await act(page, { type: 'itemsGranted', heroId: 'ratibor', items: [{ itemId: 'dagger', quantity: 2 }] }, MASTER)
  await page.locator('.player-input textarea').fill('Возвращаю кошелёк')
  await page.locator('.player-input textarea').press('Enter')
  await expect(page.locator('.message--master')).toHaveCount(3)

  // Подтверждение.
  let message = ''
  page.once('dialog', (dialog) => {
    message = dialog.message()
    void dialog.accept()
  })
  await page.getByTestId('finish-story').click()
  expect(message).toContain(`Завершить историю «${STORY}»?`)
  expect(message).toContain('только для чтения')

  // Окно итога: черновик из заданий и фактов, уровни, находки.
  const dialog = page.getByRole('dialog', { name: `Итог истории «${STORY}»` })
  await expect(dialog).toBeVisible()
  const summary = dialog.getByLabel('Краткое содержание')
  await expect(summary).toHaveValue(/Выполнено задание «Вернуть кошелёк»\. Тобиас работает на гильдию воров\. Сделано ходов: 1\./)
  await expect(dialog.getByLabel('Чем всё кончилось')).toHaveValue('История завершена. Ратибор — снова в пути и может начать новую историю.')
  await expect(dialog.getByTestId('epilogue-levels')).toHaveText('Уровень: 1 → 1')
  await expect(dialog.getByTestId('epilogue-finds')).toHaveText('Ключевые находки: Кинжал ×2')
  await expectNoHorizontalScroll(page)
  await testInfo.attach('итог истории', { body: await page.screenshot(), contentType: 'image/png' })

  // Игрок правит итог.
  await summary.fill(EDITED)
  await dialog.getByRole('button', { name: 'Сохранить в летопись' }).click()
  await expect(dialog).toHaveCount(0)

  // История только для чтения: нет ввода, кубиков, завершения и смены экипировки.
  await expect(page.getByTestId('story-read-only')).toContainText('История завершена — только чтение.')
  await expect(page.locator('.player-input')).toHaveCount(0)
  await expect(page.locator('.dice-tray-button')).toHaveCount(0)
  await expect(page.getByTestId('finish-story')).toHaveCount(0)
  await expect(page.locator('.message--player')).toContainText('Возвращаю кошелёк')
  await openSheetTab(page, isMobile, 'Снаряжение')
  await expect(page.getByRole('button', { name: /Убрать/ })).toHaveCount(0)
  if (isMobile) await page.locator('.inventory-toggle').click()
  await page.getByRole('button', { name: 'Итог истории' }).click()
  await expect(dialog.getByLabel('Краткое содержание')).toHaveValue(EDITED)
  await dialog.getByRole('button', { name: 'Закрыть' }).click()

  // «Мои истории»: завершена, можно только открыть или удалить.
  await page.getByRole('button', { name: 'В меню' }).click()
  await expect(page.getByTestId('menu-continue')).toHaveCount(0)
  await page.getByTestId('menu-stories').click()
  const card = page.locator('.story-card')
  await expect(card).toContainText('Завершена')
  await expect(card.getByRole('button', { name: 'Открыть' })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Переименовать' })).toHaveCount(0)

  // «Мои герои»: Ратибор свободен, у него «Летопись».
  await page.getByRole('button', { name: 'В меню' }).click()
  await page.getByTestId('menu-heroes').click()
  const hero = page.getByTestId('hero-ratibor')
  await expect(hero.getByTestId('hero-story')).toHaveText('Вне истории')
  const chronicle = hero.getByTestId('hero-chronicle')
  await expect(chronicle.locator('summary')).toHaveText('Летопись: 1 история')
  await chronicle.locator('summary').click()
  await expect(chronicle).toContainText(`«${STORY}»`)
  await expect(chronicle).toContainText(EDITED)
  await expect(chronicle).toContainText('Уровень 1 → 1 · находки: Кинжал ×2')
  await expectNoHorizontalScroll(page)
  await testInfo.attach('летопись в моих героях', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

  // Новая история: летопись переходит вместе с героем и видна на листе персонажа.
  await hero.getByRole('button', { name: 'Начать историю' }).click()
  await page.getByLabel('Название').fill('Дорога на север')
  await page.getByRole('button', { name: 'Начать историю' }).click()
  await expect(page.locator('.dice-tray-button')).toBeVisible()
  await openSheetTab(page, isMobile, 'Характеристики')
  const sheetChronicle = page.getByRole('region', { name: 'Летопись' }).first()
  await expect(sheetChronicle).toContainText(EDITED)

  // После перезагрузки всё на месте.
  await flushSaves(page)
  await page.reload()
  await page.getByTestId('menu-heroes').click()
  await expect(page.getByTestId('hero-ratibor').getByTestId('hero-story')).toHaveText('В истории «Дорога на север»')
  await expect(page.getByTestId('hero-ratibor').getByTestId('hero-chronicle').locator('summary')).toHaveText('Летопись: 1 история')
  expect(errors).toEqual([])
})

test('погибший герой при завершении уходит в «Зал славы»', async ({ page }) => {
  await act(page, { type: 'heroDied', heroId: 'ratibor' }, ENGINE)
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByTestId('finish-story').click()
  const dialog = page.getByRole('dialog', { name: `Итог истории «${STORY}»` })
  await expect(dialog.getByLabel('Чем всё кончилось')).toHaveValue('История завершена гибелью: Ратибор.')
  await expect(dialog.locator('.fate-badge')).toHaveText('Гибель')
  await dialog.getByRole('button', { name: 'Закрыть' }).click()

  await page.getByRole('button', { name: 'В меню' }).click()
  await page.getByTestId('menu-heroes').click()
  await expect(page.locator('.hero-card')).toHaveCount(0)
  await page.getByRole('tab', { name: 'Зал славы (1)' }).click()
  await expect(page.getByTestId('hall-ratibor').locator('.fate-badge')).toHaveText('Гибель')
})
