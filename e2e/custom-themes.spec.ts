import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { collectPageErrors, expectNoHorizontalScroll, startQuickGame } from './helpers'

const rootVar = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name)

async function openPanel(page: Page) {
  await page.getByTestId('settings-open').click()
  const panel = page.getByTestId('settings-panel')
  await expect(panel).toBeVisible()
  return panel
}

async function saveCustom(page: Page, name: string) {
  const panel = page.getByTestId('settings-panel')
  await panel.getByTestId('custom-theme-new').click()
  await panel.getByTestId('custom-theme-name').fill(name)
  await panel.getByTestId('custom-theme-save').click()
  await expect(panel.getByRole('radio', { name: new RegExp(name) })).toHaveAttribute('aria-checked', 'true')
}

test('своя тема: сохранить из текущих настроек, несколько тем, переименовать, удалить', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.goto('./')
  const panel = await openPanel(page)

  // Пустое название — отказ.
  await panel.getByTestId('custom-theme-new').click()
  await panel.getByTestId('custom-theme-save').click()
  await expect(panel.getByTestId('theme-error')).toHaveText('Введите название темы.')
  await panel.getByRole('button', { name: 'Отмена' }).click()

  // Акцент и плотность запекаются в тему; сами настройки возвращаются к значениям темы.
  await panel.getByTestId('accent-jade').click()
  await panel.getByTestId('density-compact').click()
  await saveCustom(page, 'Нефритовая')
  await expect(panel.locator('.theme-card')).toHaveCount(2)
  await expect(panel.locator('.theme-card-badge')).toHaveCount(1)
  await expect(panel.getByTestId('accent-theme')).toHaveAttribute('aria-checked', 'true')
  await expect(panel.getByTestId('density-normal')).toHaveAttribute('aria-checked', 'true')
  expect(await rootVar(page, '--color-accent')).toBe('#6fb48f')
  expect(await rootVar(page, '--space-12')).toBe('8px')

  // Вторая тема — из «Тёмного фэнтези».
  await panel.getByTestId('theme-card-dark-fantasy').click()
  await saveCustom(page, 'Вторая')
  await expect(panel.locator('.theme-card')).toHaveCount(3)
  expect(await rootVar(page, '--color-accent')).toBe('#c9a45c')

  // Переименование.
  const editor = panel.getByTestId('custom-theme-editor')
  await editor.getByTestId('custom-theme-rename').fill('Золотая')
  await editor.getByTestId('custom-theme-rename-save').click()
  await expect(panel.getByRole('radio', { name: /Золотая/ })).toHaveAttribute('aria-checked', 'true')

  // Удаление с подтверждением: выбранная тема удалена — снова тема по умолчанию.
  let message = ''
  page.once('dialog', (dialog) => {
    message = dialog.message()
    void dialog.accept()
  })
  await editor.getByTestId('custom-theme-delete').click()
  expect(message).toBe('Удалить свою тему «Золотая»? Это нельзя отменить.')
  await expect(panel.locator('.theme-card')).toHaveCount(2)
  await expect(panel.getByTestId('theme-card-dark-fantasy')).toHaveAttribute('aria-checked', 'true')
  await expect(panel.getByTestId('custom-theme-editor')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('редактор цветов: живой предпросмотр, предупреждение о читаемости, тема применяется до отрисовки после перезагрузки', async ({
  page,
}, testInfo) => {
  const errors = collectPageErrors(page)
  await page.goto('./')
  await startQuickGame(page)
  const panel = await openPanel(page)
  await saveCustom(page, 'Морская')
  const editor = panel.getByTestId('custom-theme-editor')

  // Цвет меняется сразу — на странице и в превью.
  await editor.getByTestId('color-colors.bg').fill('#14202c')
  expect(await rootVar(page, '--color-bg')).toBe('#14202c')
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(20, 32, 44)')
  await expect(editor.locator('.theme-preview')).toHaveCSS('background-color', 'rgb(20, 32, 44)')
  await editor.getByTestId('color-map.floorWood').fill('#5a4a30')
  await expect(page.locator('.map-svg .pat-wood').first()).toHaveCSS('fill', 'rgb(90, 74, 48)')
  await expect(panel.getByTestId('contrast-warning')).toHaveCount(0)

  // Плохо читаемый текст — предупреждение; исправили — исчезло.
  await editor.getByTestId('color-colors.fg').fill('#404850')
  const warning = panel.getByTestId('contrast-warning')
  await expect(warning).toBeVisible()
  await expect(warning).toContainText('Текст может плохо читаться')
  await expect(warning).toContainText('текст на фоне «фон»')
  await expect(warning).toContainText('нужно не меньше 4.5:1')
  await testInfo.attach('предупреждение о контрасте', { body: await page.screenshot(), contentType: 'image/png' })
  await editor.getByTestId('color-colors.fg').fill('#f0e8d8')
  await expect(warning).toHaveCount(0)

  // После перезагрузки своя тема применена ещё до загрузки приложения.
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
    await held
    await route.continue()
  })
  const reload = page.reload()
  await page.waitForFunction(() => document.body !== null)
  expect(await page.locator('#root').innerHTML()).toBe('')
  expect(await rootVar(page, '--color-bg')).toBe('#14202c')
  expect(await rootVar(page, '--color-fg')).toBe('#f0e8d8')
  release()
  await reload
  const again = await openPanel(page)
  await expect(again.getByRole('radio', { name: /Морская/ })).toHaveAttribute('aria-checked', 'true')
  await expect(again.getByTestId('color-colors.bg')).toHaveValue('#14202c')
  expect(errors).toEqual([])
})

test('экспорт в JSON и импорт из файла с проверкой по схеме', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.goto('./')
  const panel = await openPanel(page)
  await saveCustom(page, 'Для друга')
  await panel.getByTestId('color-colors.accent').fill('#79a7d9')

  const [download] = await Promise.all([page.waitForEvent('download'), panel.getByTestId('theme-export').click()])
  expect(download.suggestedFilename()).toMatch(/^custom-[a-z0-9]+\.json$/)
  const exported = JSON.parse(readFileSync(await download.path(), 'utf8'))
  expect(exported).toMatchObject({ name: 'Для друга', colorScheme: 'dark', colors: { accent: '#79a7d9' } })

  // Импорт: файл друга становится новой своей темой и выбирается.
  await panel.getByTestId('theme-import-file').setInputFiles({
    name: 'friend.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...exported, name: 'Тема друга', colors: { ...exported.colors, bg: '#302020' } })),
  })
  await expect(panel.getByRole('radio', { name: /Тема друга/ })).toHaveAttribute('aria-checked', 'true')
  await expect(panel.locator('.theme-card-badge')).toHaveCount(2)
  expect(await rootVar(page, '--color-bg')).toBe('#302020')

  // Некорректный файл — понятная ошибка, ничего не добавлено.
  const broken = { ...exported, colors: { ...exported.colors, fg: 'белый' } }
  delete broken.map
  await panel
    .getByTestId('theme-import-file')
    .setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(broken)) })
  const error = panel.getByTestId('theme-error')
  await expect(error).toContainText('Тема оформления некорректна')
  await expect(error).toContainText('colors.fg: ожидается цвет')
  await expect(error).toContainText('map: нет значения')
  await panel.getByTestId('theme-import-file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('не json') })
  await expect(error).toHaveText('Файл не похож на тему: это не JSON.')
  await expect(panel.locator('.theme-card-badge')).toHaveCount(2)
  expect(errors).toEqual([])
})

test.describe('телефон', () => {
  test.skip(({ isMobile }) => !isMobile, 'только для телефона')

  test('редактор своей темы в шторке — без горизонтальной прокрутки', async ({ page }, testInfo) => {
    await page.goto('./')
    const panel = await openPanel(page)
    await saveCustom(page, 'Очень длинное название своей темы, 40 зн')
    await panel.getByTestId('color-colors.fg').fill('#404850')
    await expect(panel.getByTestId('contrast-warning')).toBeVisible()
    await expectNoHorizontalScroll(page)
    const scrollable = await panel.locator('.appearance-body').evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(scrollable).toBeLessThanOrEqual(0)
    await panel.getByTestId('custom-theme-editor').scrollIntoViewIfNeeded()
    await testInfo.attach('телефон: редактор своей темы', { body: await page.screenshot(), contentType: 'image/png' })
  })
})
