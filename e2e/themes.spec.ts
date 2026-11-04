// Каждая тема из реестра (встроенная «Тёмное фэнтези» и темы дизайнера из design/themes/) на телефоне с широким шрифтом:
// главный экран и создание персонажа без горизонтальной прокрутки, скриншоты — в отчёт Playwright.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from './fixtures'
import { collectPageErrors, expectNoHorizontalScroll, openCharacterCreation } from './helpers'

const DESIGN_THEMES = join(import.meta.dirname, '..', 'design', 'themes')

/** id тем реестра: встроенная по умолчанию и файлы дизайнера (сборка уже проверила их схемой). */
const themeIds = [
  'dark-fantasy',
  ...readdirSync(DESIGN_THEMES)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => (JSON.parse(readFileSync(join(DESIGN_THEMES, name), 'utf8')) as { id: string }).id),
]

test.describe('темы на телефоне', () => {
  test.skip(({ isMobile }) => !isMobile, 'только для телефона')

  for (const id of themeIds) {
    test(`тема ${id}: главный экран и создание персонажа`, async ({ page }, testInfo) => {
      const errors = collectPageErrors(page)
      await page.goto(`./?theme=${id}`)
      await expect(page.getByTestId('menu-create')).toBeVisible()
      // Тема по умолчанию встроена в страницу; другие включаются параметром адреса.
      expect(await page.evaluate(() => document.documentElement.dataset.theme ?? 'dark-fantasy')).toBe(id)
      await expectNoHorizontalScroll(page)
      await testInfo.attach(`${id}: главный экран`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

      await openCharacterCreation(page)
      await expectNoHorizontalScroll(page)
      await testInfo.attach(`${id}: создание персонажа`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
      expect(errors).toEqual([])
    })
  }
})

test('неизвестная тема в адресе не ломает страницу', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.goto('./?theme=no-such-theme')
  await expect(page.getByTestId('menu-create')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined()
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(15, 12, 10)')
  expect(errors).toEqual([])
})
