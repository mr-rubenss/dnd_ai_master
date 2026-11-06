// Игровое время: значок в шапке (солнце или луна и «День N, время суток»), сдвиг ведущим, отдых, сохранение.
import { expect, test } from './fixtures'
import { act, collectPageErrors, expectNoHorizontalScroll, MASTER, reloadAndContinue, startQuickGame } from './helpers'

test('шапка игры: «День 1, вечер» с луной; ведущий сдвигает время — утро с солнцем; отдых двигает время', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page)
  await page.goto('./')
  await startQuickGame(page)
  const clock = page.getByTestId('game-clock')
  // Таверна «Пьяный грифон» начинается вечером: День 1, 19:00.
  await expect(clock).toHaveText('🌙День 1, вечер')
  await expect(clock).toHaveAttribute('aria-label', 'Игровое время: День 1, 19:00 (вечер)')
  await expectNoHorizontalScroll(page)
  await testInfo.attach('время в шапке', { body: await page.screenshot(), contentType: 'image/png' })

  await act(page, { type: 'timeAdvanced', minutes: 11 * 60, reason: 'проспали до утра' }, MASTER)
  await expect(clock).toHaveText('☀️День 2, утро')

  // Короткий отдых — ещё час.
  await page.getByTestId('rest-button').click()
  await page.getByTestId('rest-dialog').getByRole('button', { name: 'Отдыхать' }).click()
  await expect(clock).toHaveAttribute('aria-label', 'Игровое время: День 2, 07:00 (утро)')

  await reloadAndContinue(page)
  await expect(page.getByTestId('game-clock')).toHaveText('☀️День 2, утро')
  await expectNoHorizontalScroll(page)
  expect(errors).toEqual([])
})

test('вне игры значка времени нет', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByTestId('game-clock')).toHaveCount(0)
})
