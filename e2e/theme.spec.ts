import { expect, test } from './fixtures'
import { collectPageErrors, face, installRngQueue, queueRolls, startQuickGame } from './helpers'

const css = (locator: import('@playwright/test').Locator, property: string) =>
  locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p).trim(), property)

test('тема «Тёмное фэнтези» задаёт оформление через CSS-переменные', async ({ page }) => {
  const errors = collectPageErrors(page)
  await installRngQueue(page)
  await page.goto('./')

  // Тема встроена в index.html до скриптов.
  const html = page.locator('html')
  await expect(page.locator('style#theme')).toHaveCount(1)
  expect(await css(html, '--color-bg')).toBe('#0f0c0a')
  expect(await css(html, '--font-display')).toBe("'Cormorant Garamond', Georgia, serif")
  expect(await css(html, 'color-scheme')).toBe('dark')
  expect(await css(page.locator('body'), 'background-color')).toBe('rgb(15, 12, 10)')
  expect(await css(page.locator('body'), 'color')).toBe('rgb(230, 220, 200)')

  // Карта: пол, стены, двери, рамки фишек — из токенов карты.
  await startQuickGame(page)
  const map = page.locator('.map-svg')
  expect(await css(map.locator('.floor--wood').first(), 'fill')).toBe('rgb(74, 53, 35)')
  expect(await css(map.locator('.wall-line--stone').first(), 'stroke')).toBe('rgb(18, 14, 11)')
  expect(await css(page.getByTestId('door-entrance').locator('.door-leaf'), 'fill')).toBe('rgb(138, 90, 43)')
  expect(await css(map.locator('.npc-token').first(), 'stroke')).toBe('rgb(11, 9, 7)')
  expect(await css(map.locator('.player-ring'), 'stroke')).toBe('rgb(227, 194, 127)')

  // Подсветка натуральной 20 — из токенов кубиков.
  await page.locator('.dice-tray-button').click()
  await queueRolls(page, [face(20, 20)])
  await page.locator('.dice-quick button', { hasText: /^к20$/ }).click()
  const badge = page.locator('.dice-tray-badge.is-nat20')
  await expect(badge).toHaveText('20')
  expect(await css(badge, 'background-color')).toBe('rgb(201, 164, 92)')
  expect(await css(badge, 'box-shadow')).toBe('rgba(227, 194, 127, 0.7) 0px 0px 8px 0px')
  expect(errors).toEqual([])
})
