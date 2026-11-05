import type { Page } from '@playwright/test'
import { darkFantasy } from '../src/theme/darkFantasy'
import { expect, test } from './fixtures'
import { collectPageErrors, expectNoHorizontalScroll, openCharacterCreation, startQuickGame } from './helpers'

const rootVar = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name)
const rootData = (page: Page) => page.evaluate(() => ({ ...document.documentElement.dataset }))

async function openPanel(page: Page) {
  await page.getByTestId('settings-open').click()
  const panel = page.getByTestId('settings-panel')
  await expect(panel).toBeVisible()
  await page.waitForTimeout(300) // анимация выезда
  return panel
}

/** Проверочная тема — только для e2e, в реестр добавляется через отладочный доступ (в сборку не попадает). */
const testTheme = { ...structuredClone(darkFantasy), id: 'e2e-check', name: 'Проверочная' }
testTheme.colors.bg = '#203040'

test('смена темы: карточки всех тем реестра, тема применяется сразу', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page)
  await page.goto('./')
  let panel = await openPanel(page)
  // Сейчас в реестре одна тема — «Тёмное фэнтези»; она выбрана.
  await expect(panel.getByRole('radio', { name: 'Тёмное фэнтези' })).toHaveAttribute('aria-checked', 'true')
  await expect(panel.locator('.theme-card')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(page.getByTestId('settings-open')).toBeFocused()

  // Новая тема реестра сама появляется в панели.
  await page.evaluate(
    (theme) => (window as unknown as { __aiMasterAppearance: { addDebugTheme(t: unknown): void } }).__aiMasterAppearance.addDebugTheme(theme),
    testTheme,
  )
  panel = await openPanel(page)
  await expect(panel.locator('.theme-card')).toHaveCount(2)
  await panel.getByTestId('theme-card-e2e-check').click()
  await expect(panel.getByTestId('theme-card-e2e-check')).toHaveAttribute('aria-checked', 'true')
  expect(await rootVar(page, '--color-bg')).toBe('#203040')
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(32, 48, 64)')
  expect((await rootData(page)).theme).toBe('e2e-check')
  await testInfo.attach('проверочная тема', { body: await page.screenshot(), contentType: 'image/png' })

  await panel.getByTestId('theme-card-dark-fantasy').click()
  expect(await rootVar(page, '--color-bg')).toBe('#0f0c0a')
  expect(errors).toEqual([])
})

test('тонкая настройка, карта и анимации применяются сразу и сохраняются после перезагрузки — до первой отрисовки', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page)
  await page.goto('./')
  await startQuickGame(page)
  const panel = await openPanel(page)

  await panel.getByTestId('accent-azure').click()
  expect(await rootVar(page, '--color-accent')).toBe('#79a7d9')
  await panel.getByTestId('master-font').selectOption('pt-serif')
  await expect(page.locator('.message--master .message-text').first()).toHaveCSS('font-family', /^"PT Serif"/)
  await panel.getByTestId('text-size-large').click()
  await expect(page.locator('html')).toHaveCSS('font-size', '18px')
  await panel.getByTestId('density-compact').click()
  expect(await rootVar(page, '--space-12')).toBe('8px')
  await panel.getByTestId('grid-opacity').fill('40')
  expect(await rootVar(page, '--pref-grid-opacity')).toBe('0.4')
  await expect(page.locator('.map-grid')).toHaveCSS('opacity', '0.4')
  await panel.getByTestId('map-grid').uncheck()
  await expect(panel.getByTestId('grid-opacity')).toBeDisabled()
  await expect(page.locator('.map-grid')).toBeHidden()
  await panel.getByTestId('npc-labels').uncheck()
  await expect(page.locator('.npc-label').first()).toBeHidden()
  await panel.getByTestId('animations').uncheck()
  expect((await rootData(page)).motion).toBe('reduce')
  await testInfo.attach('настройки изменены', { body: await page.screenshot(), contentType: 'image/png' })

  // После перезагрузки настройки применены скриптом в <head> ещё до загрузки приложения:
  // задерживаем скрипт приложения и смотрим на страницу, пока React ничего не отрисовал.
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
    await held
    await route.continue()
  })
  const reload = page.reload()
  await page.waitForFunction(() => document.body !== null)
  expect(await page.locator('#root').innerHTML()).toBe('')
  expect(await rootVar(page, '--color-accent')).toBe('#79a7d9')
  expect(await rootVar(page, '--space-12')).toBe('8px')
  expect(await rootVar(page, '--font-master')).toContain('PT Serif')
  await expect(page.locator('html')).toHaveCSS('font-size', '18px')
  expect(await rootData(page)).toMatchObject({ theme: 'dark-fantasy', density: 'compact', mapGrid: 'off', npcLabels: 'off', motion: 'reduce' })
  release()
  await reload
  await page.unroute(/\/assets\/index-[^/]+\.js$/)

  // Приложение подхватило те же настройки; истории они не касаются.
  await page.getByTestId('menu-continue').click()
  await expect(page.locator('.map-grid')).toBeHidden()
  const again = await openPanel(page)
  await expect(again.getByTestId('accent-azure')).toHaveAttribute('aria-checked', 'true')
  await expect(again.getByTestId('master-font')).toHaveValue('pt-serif')
  await expect(again.getByTestId('text-size-large')).toHaveAttribute('aria-checked', 'true')
  await expect(again.getByTestId('density-compact')).toHaveAttribute('aria-checked', 'true')
  await expect(again.getByTestId('map-grid')).not.toBeChecked()
  await expect(again.getByTestId('npc-labels')).not.toBeChecked()
  await expect(again.getByTestId('animations')).not.toBeChecked()

  // Сброс к теме по умолчанию.
  await again.getByTestId('appearance-reset').click()
  expect(await rootVar(page, '--color-accent')).toBe('#c9a45c')
  expect(await rootVar(page, '--space-12')).toBe('12px')
  await expect(page.locator('html')).toHaveCSS('font-size', '16px')
  await expect(again.getByTestId('accent-theme')).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('.map-grid')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('ai-master:appearance'))).toBeNull()
  expect(errors).toEqual([])
})

test.describe('анимации по умолчанию — как в системе', () => {
  test.use({ reducedMotion: 'reduce' })

  test('система просит уменьшить движение — анимации выключены, пока игрок не включит', async ({ page }) => {
    await page.goto('./')
    expect((await rootData(page)).motion).toBe('reduce')
    const panel = await openPanel(page)
    await expect(panel.getByTestId('animations')).not.toBeChecked()
    await panel.getByTestId('animations').check()
    expect((await rootData(page)).motion).toBe('full')
  })
})

test.describe('десктоп', () => {
  test.skip(({ isMobile }) => isMobile, 'только для десктопа')

  test('боковая панель справа во всю высоту, открывается из меню и из игры', async ({ page }, testInfo) => {
    await page.goto('./')
    let panel = await openPanel(page)
    const viewport = page.viewportSize()!
    const box = (await panel.boundingBox())!
    expect(Math.abs(box.x + box.width - viewport.width)).toBeLessThan(1)
    expect(box.y).toBe(0)
    expect(Math.abs(box.height - viewport.height)).toBeLessThan(1)
    expect(box.width).toBeLessThan(viewport.width / 2)
    await page.getByRole('button', { name: 'Закрыть' }).click()

    await startQuickGame(page)
    panel = await openPanel(page)
    await testInfo.attach('десктоп: панель в игре', { body: await page.screenshot(), contentType: 'image/png' })
    await page.locator('.appearance-backdrop').click({ position: { x: 20, y: 400 } })
    await expect(panel).toHaveCount(0)
  })
})

test.describe('телефон', () => {
  test.skip(({ isMobile }) => !isMobile, 'только для телефона')

  test('шторка снизу во всю ширину, без горизонтальной прокрутки', async ({ page }, testInfo) => {
    const errors = collectPageErrors(page)
    await page.goto('./')
    const panel = await openPanel(page)
    const viewport = page.viewportSize()!
    const box = (await panel.boundingBox())!
    expect(box.x).toBe(0)
    expect(Math.abs(box.width - viewport.width)).toBeLessThan(1)
    expect(Math.abs(box.y + box.height - viewport.height)).toBeLessThan(2)
    await expectNoHorizontalScroll(page)
    await testInfo.attach('телефон: шторка оформления', { body: await page.screenshot(), contentType: 'image/png' })

    // Самый крупный текст: панель, меню, создание персонажа и игра — без горизонтальной прокрутки.
    await panel.getByTestId('text-size-xlarge').click()
    await expectNoHorizontalScroll(page)
    await panel.getByTestId('appearance-reset').scrollIntoViewIfNeeded()
    await testInfo.attach('телефон: шторка, очень крупный текст', { body: await page.screenshot(), contentType: 'image/png' })
    await page.getByRole('button', { name: 'Закрыть' }).click()
    await expectNoHorizontalScroll(page)
    await openCharacterCreation(page)
    await expectNoHorizontalScroll(page)
    await page.getByRole('button', { name: 'В меню' }).click()
    await startQuickGame(page)
    await expectNoHorizontalScroll(page)
    await openPanel(page)
    await expectNoHorizontalScroll(page)
    await testInfo.attach('телефон: игра, очень крупный текст', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
    expect(errors).toEqual([])
  })
})
