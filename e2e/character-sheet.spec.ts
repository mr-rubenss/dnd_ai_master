import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { act, collectPageErrors, ENGINE, expectNoHorizontalScroll, reloadAndContinue, startQuickGame } from './helpers'

async function openStatsTab(page: Page, isMobile: boolean) {
  if (isMobile) await page.locator('.inventory-toggle').tap()
  // При первом запуске открыта вкладка «Характеристики».
  await expect(page.getByRole('tab', { name: 'Характеристики' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#sheet-panel-stats')).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.goto('./')
  await startQuickGame(page)
})

test('вкладка «Характеристики»: характеристики, спасброски, навыки Ратибора', async ({ page, isMobile }, testInfo) => {
  const errors = collectPageErrors(page)
  await openStatsTab(page, isMobile)
  await expect(page.locator('#sheet-panel-equipment')).toBeHidden()

  const stats = page.locator('#sheet-panel-stats')
  // СИЛ 17 → +3, ИНТ 8 → −1.
  await expect(stats.locator('[data-ability="str"]')).toContainText('+3')
  await expect(stats.locator('[data-ability="str"]')).toContainText('17')
  await expect(stats.locator('[data-ability="int"]')).toContainText('−1')
  await expect(stats.locator('.sheet-summary')).toContainText('+2')
  await expect(stats.getByTestId('passive-perception')).toHaveText('13')

  // Спасброски воина: Сила и Телосложение с владением.
  await expect(stats.locator('[data-save="str"] .stat-mod')).toHaveText('+5')
  await expect(stats.locator('[data-save="str"] .prof-mark--proficient')).toHaveCount(1)
  await expect(stats.locator('[data-save="dex"] .stat-mod')).toHaveText('+2')
  await expect(stats.locator('[data-save="dex"] .prof-mark--none')).toHaveCount(1)

  // Навыки: Атлетика (солдат) и Проницательность (Умелость человека) с владением, Скрытность и Магия — без.
  await expect(stats.locator('[data-skill]')).toHaveCount(18)
  await expect(stats.locator('[data-skill="athletics"] .stat-mod')).toHaveText('+5')
  await expect(stats.locator('[data-skill="perception"] .stat-mod')).toHaveText('+3')
  await expect(stats.locator('[data-skill="stealth"] .stat-mod')).toHaveText('+2')
  await expect(stats.locator('[data-skill="arcana"] .stat-mod')).toHaveText('−1')
  await expect(stats.locator('[data-skill="insight"] .stat-mod')).toHaveText('+3')
  await expect(stats.locator('[data-skill] .prof-mark--proficient')).toHaveCount(5)

  await expect(stats.locator('.conditions-empty')).toHaveText('Нет')
  await expectNoHorizontalScroll(page)
  await testInfo.attach('лист персонажа', { body: await page.screenshot({ fullPage: isMobile }), contentType: 'image/png' })
  expect(errors).toEqual([])
})

test('вкладки переключаются стрелками с клавиатуры', async ({ page, isMobile }) => {
  test.skip(isMobile, 'клавиатура — на десктопе')
  await page.getByRole('tab', { name: 'Характеристики' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Снаряжение' })).toBeFocused()
  await expect(page.getByRole('tab', { name: 'Снаряжение' })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('tab', { name: 'Характеристики' })).toBeFocused()
  await expect(page.getByRole('tab', { name: 'Характеристики' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#sheet-panel-stats')).toBeVisible()
})

test('состояния из сохранения: Отравлен снижает пассивное Восприятие, Истощение показывает уровень', async ({ page, isMobile }) => {
  // Состояния накладывает движок — действием в истории.
  await act(page, { type: 'conditionsChanged', heroId: 'ratibor', conditions: [{ id: 'poisoned' }, { id: 'exhaustion', level: 2 }] }, ENGINE)
  await reloadAndContinue(page)
  await openStatsTab(page, isMobile)

  const stats = page.locator('#sheet-panel-stats')
  await expect(stats.getByTestId('passive-perception')).toHaveText('8')
  await expect(stats.locator('[data-condition="poisoned"]')).toContainText('Отравлен')
  await expect(stats.locator('[data-condition="exhaustion"]')).toContainText('Истощение 2')
  await expectNoHorizontalScroll(page)
})
