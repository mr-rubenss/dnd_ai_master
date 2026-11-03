import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { act, addHeroCopy, collectPageErrors, continueGame, equippedOfLead, expectNoHorizontalScroll, MASTER, reloadAndContinue, startQuickGame } from './helpers'

async function openEquipment(page: Page, isMobile: boolean) {
  if (isMobile && (await page.locator('.inventory-toggle').getAttribute('aria-expanded')) !== 'true') {
    await page.locator('.inventory-toggle').click()
  }
  await page.getByRole('tab', { name: 'Снаряжение' }).click()
  await expect(page.locator('#sheet-panel-equipment')).toBeVisible()
}

/** Раскрывает предмет в инвентаре и нажимает кнопку экипировки. */
async function itemAction(page: Page, itemId: string, label: string) {
  const row = page.locator(`[data-item="${itemId}"]`)
  if ((await row.locator('.item-button').getAttribute('aria-expanded')) !== 'true') await row.locator('.item-button').click()
  await row.getByRole('button', { name: label, exact: true }).click()
}

const slot = (page: Page, name: 'mainHand' | 'offHand' | 'armor') => page.locator(`.equipment-list [data-slot="${name}"]`)
const armorClass = (page: Page) => page.getByTestId('armor-class').first()

test.beforeEach(async ({ page }) => {
  await page.goto('./')
  await startQuickGame(page)
})

test('вкладки: «Характеристики» первые и открыты сначала, затем запоминается выбранная', async ({ page, isMobile }) => {
  if (isMobile) await page.locator('.inventory-toggle').click()
  await expect(page.getByRole('tab').first()).toHaveText('Характеристики')
  await expect(page.getByRole('tab').nth(1)).toHaveText('Снаряжение')
  await expect(page.getByRole('tab', { name: 'Характеристики' })).toHaveAttribute('aria-selected', 'true')

  await page.getByRole('tab', { name: 'Снаряжение' }).click()
  await page.reload()
  await continueGame(page)
  if (isMobile) await page.locator('.inventory-toggle').click()
  await expect(page.getByRole('tab', { name: 'Снаряжение' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#sheet-panel-equipment')).toBeVisible()
})

test('смена оружия и доспеха: атака и КД пересчитываются сразу и сохраняются', async ({ page, isMobile }, testInfo) => {
  const errors = collectPageErrors(page)
  await openEquipment(page, isMobile)

  // Двуручный меч Ратибора: СИЛ +3, БМ +2, боевой стиль «Бой большим оружием».
  await expect(page.getByTestId('attack-mainHand')).toContainText('Атака +5 · 2к6+3 рубящий')
  await expect(page.getByTestId('attack-mainHand')).toContainText('Бой большим оружием')
  await expect(slot(page, 'offHand')).toContainText('занята: двуручное оружие')
  await expect(armorClass(page)).toHaveText('16')

  await itemAction(page, 'flail', 'Взять в руки')
  await expect(slot(page, 'mainHand')).toContainText('Цеп')
  await expect(page.getByTestId('attack-mainHand')).toContainText('Атака +5 · 1к8+3 дробящий')
  await expect(slot(page, 'offHand')).toContainText('пусто')

  // Копьё — универсальное: при свободной второй руке двумя руками, 1к8.
  await itemAction(page, 'spear', 'Взять в руки')
  await expect(page.getByTestId('attack-mainHand')).toContainText('1к8+3 колющий · двумя руками')

  // Без доспеха КД 10 + ЛОВ 2.
  await slot(page, 'armor').getByRole('button', { name: /Убрать/ }).click()
  await expect(armorClass(page)).toHaveText('12')
  await itemAction(page, 'chain-mail', 'Надеть')
  await expect(armorClass(page)).toHaveText('16')
  await expectNoHorizontalScroll(page)
  await testInfo.attach('экипировка', { body: await page.screenshot({ fullPage: isMobile }), contentType: 'image/png' })

  // Экипировка в состоянии истории — сохраняется после перезагрузки.
  expect(await equippedOfLead(page)).toEqual({ mainHand: 'spear', offHand: null, armor: 'chain-mail' })
  await reloadAndContinue(page)
  await openEquipment(page, isMobile)
  await expect(slot(page, 'mainHand')).toContainText('Копьё')
  expect(errors).toEqual([])
})

test('руки: щит, двуручное и парное оружие — с объяснением, почему нельзя', async ({ page, isMobile }) => {
  // Ведущий передаёт герою щит, короткий меч и два кинжала.
  await act(page, { type: 'itemsGranted', heroId: 'ratibor', items: [{ itemId: 'shield', quantity: 1 }, { itemId: 'shortsword', quantity: 1 }, { itemId: 'dagger', quantity: 2 }] }, MASTER)
  await openEquipment(page, isMobile)

  // Щит при двуручном мече — нельзя.
  await itemAction(page, 'shield', 'Надеть')
  await expect(page.locator('[data-item="shield"] .equip-error')).toHaveText('Обе руки заняты двуручным «Двуручный меч». Сначала уберите его.')
  await expect(slot(page, 'offHand')).not.toContainText('Щит')

  // Кинжал во вторую руку к нелёгкому оружию — нельзя.
  await itemAction(page, 'dagger', 'Во вторую руку')
  await expect(page.locator('[data-item="dagger"] .equip-error')).toContainText('Обе руки заняты двуручным')

  // Короткий меч + кинжал — два лёгких оружия.
  await itemAction(page, 'shortsword', 'Взять в руки')
  await itemAction(page, 'dagger', 'Во вторую руку')
  await expect(slot(page, 'offHand')).toContainText('Кинжал')
  await expect(page.getByTestId('attack-offHand')).toContainText('Атака +5 · 1к4 колющий')
  await expect(page.getByTestId('attack-offHand')).toContainText('бонусное действие')

  // Щит заменяет кинжал во второй руке: КД 16 + 2.
  await itemAction(page, 'shield', 'Надеть')
  await expect(slot(page, 'offHand')).toContainText('Щит')
  await expect(armorClass(page)).toHaveText('18')

  // Двуручный меч при щите — нельзя, с подсказкой.
  await itemAction(page, 'greatsword', 'Взять в руки')
  await expect(page.locator('[data-item="greatsword"] .equip-error')).toHaveText(
    '«Двуручный меч» — двуручное оружие и занимает обе руки. Сначала уберите «Щит» из второй руки.',
  )
  await slot(page, 'offHand').getByRole('button', { name: /Убрать/ }).click()
  await itemAction(page, 'greatsword', 'Взять в руки')
  await expect(slot(page, 'mainHand')).toContainText('Двуручный меч')
  await expect(armorClass(page)).toHaveText('16')
  await expectNoHorizontalScroll(page)
})

test('щит без владения щитами не прибавляет КД — и лист объясняет почему', async ({ page, isMobile }) => {
  // Герой без владения щитами (копия Ратибора) в своей истории; ведущий даёт ему щит и короткий меч.
  await addHeroCopy(page, { id: 'nils', name: 'Нильс', armor: ['light', 'medium', 'heavy'] })
  await page.getByRole('button', { name: 'В меню' }).click()
  await page.getByTestId('menu-heroes').click()
  await page.getByTestId('hero-nils').getByRole('button', { name: 'Начать историю' }).click()
  await page.getByRole('button', { name: 'Начать историю' }).click()
  await expect(page.locator('.dice-tray-button')).toBeVisible()
  await act(page, { type: 'itemsGranted', heroId: 'nils', items: [{ itemId: 'shield', quantity: 1 }, { itemId: 'shortsword', quantity: 1 }] }, MASTER)
  if (isMobile) await page.locator('.inventory-toggle').click()
  await expect(page.getByTestId('armor-training')).toHaveText('Все доспехи')

  await openEquipment(page, isMobile)
  await itemAction(page, 'shortsword', 'Взять в руки')
  await itemAction(page, 'shield', 'Надеть')
  await expect(slot(page, 'offHand')).toContainText('Щит')
  await expect(page.getByTestId('shield-untrained')).toHaveText('Нет владения щитами — щит не прибавляет КД')
  await expect(armorClass(page)).toHaveText('16')
  await expectNoHorizontalScroll(page)
})
