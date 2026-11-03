import { expect, test } from './fixtures'
import {
  collectPageErrors,
  expectNoHorizontalScroll,
  expectRollOverlayCentered,
  face,
  installRngQueue,
  queueRolls,
  reloadAndContinue,
  startQuickGame,
  swipeDown,
} from './helpers'

const ADV_DIS_ERROR = 'Преимущество и помеха применяются только к броску одного d20'

test.beforeEach(async ({ page }) => {
  await installRngQueue(page)
  await page.goto('./')
  await startQuickGame(page)
})

test.describe('игровой стол — десктоп', () => {
  test.skip(({ isMobile }) => isMobile, 'только для десктопа')

  test('круглая кнопка слева от поля ввода, панели «Броски» нет', async ({ page }) => {
    await expect(page.locator('.dice-panel')).toHaveCount(0)
    const button = (await page.locator('.dice-tray-button').boundingBox())!
    const textarea = (await page.locator('.player-input textarea').boundingBox())!
    expect(button.x + button.width).toBeLessThanOrEqual(textarea.x)
    expect(Math.abs(button.width - button.height)).toBeLessThan(1)
    await expect(page.locator('.dice-tray-badge')).toHaveCount(0)
  })

  test('окно над кнопкой, остаётся открытым после бросков, бейдж показывает итог', async ({ page }, testInfo) => {
    const errors = collectPageErrors(page)
    const button = page.locator('.dice-tray-button')
    const dialog = page.locator('.dice-tray-dialog')
    await button.click()
    await expect(dialog).toBeVisible()
    await page.waitForTimeout(250) // анимация появления окна
    const buttonBox = (await button.boundingBox())!
    const dialogBox = (await dialog.boundingBox())!
    expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(buttonBox.y)
    expect(dialogBox.x).toBeLessThanOrEqual(buttonBox.x + 1)

    // Своя формула по Enter: бросок есть, а ответ игрока не отправляется.
    const playerMessages = await page.locator('.message--player').count()
    await queueRolls(page, [face(2, 6), face(5, 6), face(6, 6), face(3, 6)])
    await page.locator('.dice-custom input').fill('4d6kh3')
    await page.locator('.dice-custom input').press('Enter')
    await expectRollOverlayCentered(page)
    await expect(page.locator('.dice-tray-badge')).toHaveText('14')
    await expect(page.locator('.message--player')).toHaveCount(playerMessages)
    await expect(dialog).toBeVisible()

    // Помеха: 20 и 1 → натуральная 1, красный бейдж.
    await page.locator('.dice-modes button', { hasText: 'Помеха' }).click()
    await queueRolls(page, [face(20, 20), face(1, 20)])
    await page.locator('.dice-quick button', { hasText: /^к20$/ }).click()
    await expect(page.locator('.dice-tray-badge.is-nat1')).toHaveText('1')
    await expect(dialog).toBeVisible()

    // Преимущество: 7 и 20 → натуральная 20, золотой бейдж и подсветка в журнале.
    await page.locator('.dice-modes button', { hasText: 'Преим.' }).click()
    await queueRolls(page, [face(7, 20), face(20, 20)])
    await page.locator('.dice-quick button', { hasText: /^к20$/ }).click()
    await expect(page.locator('.dice-tray-badge.is-nat20')).toHaveText('20')
    await expectRollOverlayCentered(page)
    await expect(page.locator('.dice-overlay.is-crit-success')).toBeVisible()
    await expect(page.locator('.roll-entry').first()).toHaveClass(/is-crit-success/)
    await expect(page.locator('.roll-entry')).toHaveCount(3)
    await expect(dialog).toBeVisible()
    await testInfo.attach('десктоп: натуральная 20', { body: await page.screenshot(), contentType: 'image/png' })

    expect(errors).toEqual([])
  })

  test('показывает ошибку формулы', async ({ page }) => {
    await page.locator('.dice-tray-button').click()
    await page.locator('.dice-custom input').fill('1d20 5')
    await page.locator('.dice-custom input').press('Enter')
    await expect(page.locator('.dice-error')).toHaveText('Между частями «1d20 5» нужен знак + или −')
    await page.locator('.dice-modes button', { hasText: 'Преим.' }).click()
    await page.locator('.dice-custom input').fill('2d6')
    await page.locator('.dice-custom button', { hasText: 'Бросить' }).click()
    await expect(page.locator('.dice-error')).toHaveText(ADV_DIS_ERROR)
    await expect(page.locator('.dice-overlay')).toHaveCount(0)
  })

  test('закрывается нажатием вне окна и по Esc', async ({ page }) => {
    const button = page.locator('.dice-tray-button')
    const dialog = page.locator('.dice-tray-dialog')

    await button.click()
    await expect(dialog).toBeVisible()
    await page.locator('.map-panel .panel-header').click()
    await expect(dialog).toHaveCount(0)

    await button.click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(button).toBeFocused()

    await button.click()
    await page.locator('.dice-tray-close').click()
    await expect(dialog).toHaveCount(0)
  })

  test('журнал и бейдж сохраняются после перезагрузки', async ({ page }) => {
    await page.locator('.dice-tray-button').click()
    await queueRolls(page, [face(20, 20)])
    await page.locator('.dice-quick button', { hasText: /^к20$/ }).click()
    await expect(page.locator('.dice-tray-badge.is-nat20')).toHaveText('20')

    await reloadAndContinue(page)
    await expect(page.locator('.dice-tray-badge.is-nat20')).toHaveText('20')
    await page.locator('.dice-tray-button').click()
    await expect(page.locator('.roll-entry')).toHaveCount(1)
  })
})

test.describe('игровой стол — телефон', () => {
  test.skip(({ isMobile }) => !isMobile, 'только для телефона')

  test('шторка снизу во всю ширину, без горизонтальной прокрутки', async ({ page }, testInfo) => {
    await expectNoHorizontalScroll(page)
    await page.locator('.dice-tray-button').tap()
    const sheet = page.locator('.dice-tray-dialog')
    await expect(sheet).toBeVisible()
    await page.waitForTimeout(300) // анимация выезда шторки
    const box = (await sheet.boundingBox())!
    const viewport = page.viewportSize()!
    expect(Math.abs(box.y + box.height - viewport.height)).toBeLessThan(2)
    expect(box.x).toBe(0)
    expect(Math.abs(box.width - viewport.width)).toBeLessThan(1)
    await expect(page.locator('.dice-tray-backdrop')).toBeVisible()
    await expectNoHorizontalScroll(page)
    await testInfo.attach('телефон: шторка', { body: await page.screenshot(), contentType: 'image/png' })
  })

  test('после броска шторка остаётся открытой, анимация по центру экрана', async ({ page }, testInfo) => {
    const errors = collectPageErrors(page)
    await page.locator('.dice-tray-button').tap()
    await queueRolls(page, [face(20, 20)])
    await page.locator('.dice-quick button', { hasText: /^к20$/ }).tap()
    await expectRollOverlayCentered(page)
    await expect(page.locator('.dice-tray-dialog')).toBeVisible()
    await expect(page.locator('.dice-tray-badge.is-nat20')).toHaveText('20')
    await testInfo.attach('телефон: натуральная 20', { body: await page.screenshot(), contentType: 'image/png' })

    await page.locator('.dice-quick button', { hasText: /^к6$/ }).tap()
    await expect(page.locator('.roll-entry')).toHaveCount(2)
    await expect(page.locator('.dice-tray-dialog')).toBeVisible()
    await expectNoHorizontalScroll(page)
    expect(errors).toEqual([])
  })

  test('закрывается свайпом вниз, короткий свайп не закрывает', async ({ page }) => {
    await page.locator('.dice-tray-button').tap()
    const sheet = page.locator('.dice-tray-dialog')
    await expect(sheet).toBeVisible()

    await swipeDown(page.locator('.dice-tray-handle'), 40)
    await page.waitForTimeout(300)
    await expect(sheet).toBeVisible()

    await swipeDown(page.locator('.dice-tray-header'), 160)
    await expect(sheet).toHaveCount(0)
  })

  test('закрывается нажатием на затемнение', async ({ page }) => {
    await page.locator('.dice-tray-button').tap()
    await expect(page.locator('.dice-tray-dialog')).toBeVisible()
    await page.waitForTimeout(300)
    const viewport = page.viewportSize()!
    await page.touchscreen.tap(viewport.width / 2, 40)
    await expect(page.locator('.dice-tray-dialog')).toHaveCount(0)
    await expectNoHorizontalScroll(page)
  })
})
