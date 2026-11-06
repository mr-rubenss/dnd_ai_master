// Магия в листе персонажа: шаг «Заклинания» при создании волшебника, вкладка «Магия», ячейки, «Изменить подготовленные»,
// выбор заклинаний старому заклинателю. На телефоне — без горизонтальной прокрутки (широкий шрифт — фикстура).
import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { act, addHeroCopy, collectPageErrors, expectNoHorizontalScroll, fillLanguages, fillSpellStep, MASTER, openCharacterCreation, startQuickGame } from './helpers'

const next = (page: Page) => page.getByRole('button', { name: 'Далее', exact: true })
const option = (page: Page, group: string, id: string) => page.getByRole('radiogroup', { name: group }).locator(`[data-option="${id}"]`)
const stepTitle = (page: Page) => page.locator('#creation-step-title')
const spell = (page: Page, slot: string, id: string) => page.locator(`[data-slot="${slot}"] [data-spell="${id}"] .spell-option-toggle`)
const slotCount = (page: Page, slot: string) => page.locator(`[data-slot="${slot}"] .slot-count`)

async function openSheet(page: Page) {
  const toggle = page.locator('.inventory-toggle')
  if (await toggle.isVisible()) await toggle.click()
}

const CANTRIPS = ['fire-bolt', 'light', 'mage-hand']
const BOOK = ['magic-missile', 'shield', 'sleep', 'detect-magic', 'mage-armor', 'identify']
const PREPARED = ['magic-missile', 'shield', 'sleep', 'mage-armor']

test('создание волшебника: шаг «Заклинания», книга, «Посвящённый в магию»; вкладка «Магия» в игре', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page)
  await page.goto('./')
  await openCharacterCreation(page)

  await option(page, 'Класс', 'wizard').click()
  await next(page).click()
  // Мудрец: черта «Посвящённый в магию» со списком волшебника.
  await option(page, 'Предыстория', 'sage').click()
  await page.getByRole('radiogroup', { name: 'Прибавка +2' }).locator('[data-value="int"]').click()
  await page.getByRole('radiogroup', { name: 'Прибавка +1' }).locator('[data-value="con"]').click()
  await next(page).click()
  await option(page, 'Вид', 'human').click()
  await fillLanguages(page)
  await page.getByRole('radiogroup', { name: 'Черта происхождения' }).locator('[data-option="alert"]').click()
  await next(page).click()
  await page.getByRole('button', { name: /Расставить под класс/ }).click()
  await next(page).click()
  for (const skill of ['investigation', 'medicine']) await page.locator(`[data-slot="classSkills"] [data-value="${skill}"]`).click()
  await page.locator('[data-slot="speciesSkills"] [data-value="perception"]').click()
  await next(page).click()

  // 6. Заклинания
  await expect(stepTitle(page)).toHaveText('6. Заклинания')
  // ИНТ 15 + 2 = 17 (+3): Сл 8 + 3 + 2 = 13, атака +5.
  await expect(page.getByTestId('spell-stats')).toHaveText('Характеристика заклинаний — Интеллект: Сл спасброска 13, бонус атаки заклинанием +5.')
  await expect(page.locator('.creation-problems')).toHaveText('Заговоры: выберите 3 (выбрано 0)')
  for (const id of CANTRIPS) await spell(page, 'cantrips', id).click()
  await expect(slotCount(page, 'cantrips')).toHaveText('3 из 3')
  // Лимит: четвёртый заговор не выбрать.
  await expect(spell(page, 'cantrips', 'ray-of-frost')).toBeDisabled()
  for (const id of BOOK) await spell(page, 'spellbook', id).click()
  await expect(slotCount(page, 'spellbook')).toHaveText('6 из 6')
  // Подготовить можно только из книги.
  await expect(page.locator('[data-slot="prepared"] [data-spell="grease"]')).toHaveCount(0)
  for (const id of PREPARED) await spell(page, 'prepared', id).click()
  await expect(spell(page, 'prepared', 'identify')).toBeDisabled()

  // Описание раскрывается по кнопке.
  await page.locator('[data-slot="cantrips"] [data-spell="fire-bolt"] .spell-option-more').click()
  await expect(page.locator('[data-slot="cantrips"] [data-spell="fire-bolt"] .spell-details')).toContainText('120 футов')

  // «Посвящённый в магию»: список задан предысторией — волшебник; 2 заговора и 1 заклинание.
  const initiate = page.getByTestId('initiate-choice')
  await expect(page.getByTestId('initiate-list')).toBeDisabled()
  await expect(page.getByTestId('initiate-list')).toHaveValue('wizard')
  await expect(page.locator('.creation-problems')).toHaveText('«Посвящённый в магию»: выберите 2 заговора (выбрано 0)')
  await spell(page, 'initiate-cantrips', 'prestidigitation').click()
  await spell(page, 'initiate-cantrips', 'minor-illusion').click()
  await spell(page, 'initiate-spell', 'feather-fall').click()
  await expect(initiate).toContainText('раз в день без ячейки')
  await expect(next(page)).toBeEnabled()
  await expectNoHorizontalScroll(page)
  await testInfo.attach('шаг «Заклинания»', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  await next(page).click()

  await option(page, 'Снаряжение класса', 'class-A').click()
  await option(page, 'Снаряжение предыстории', 'background-A').click()
  await next(page).click()
  await page.getByLabel('Имя', { exact: true }).fill('Мирослава')
  await next(page).click()
  await expect(stepTitle(page)).toHaveText('9. Итог')
  await expect(page.getByTestId('summary-spells')).toContainText('Огненный снаряд (заговор)')
  await expect(page.getByTestId('summary-spells')).toContainText('Опознание (в книге)')
  await expect(page.getByTestId('summary-spells')).toContainText('Падение пёрышком — Посвящённый в магию (волшебник)')

  await page.getByRole('button', { name: 'Начать приключение' }).click()
  await page.getByLabel('Название').fill('Башня мага')
  await page.getByRole('button', { name: 'Начать историю' }).click()
  await expect(page.locator('.dice-tray-button')).toBeVisible()

  // Вкладка «Магия»
  await openSheet(page)
  await page.getByRole('tab', { name: 'Магия' }).click()
  const panel = page.locator('#sheet-panel-magic')
  await expect(panel.getByTestId('magic-source').first()).toContainText('Волшебник: Интеллект · Сл спасброска 13 · атака заклинанием +5')
  await expect(panel.getByRole('img', { name: 'Ячейки 1-го круга: осталось 2 из 2' })).toBeVisible()
  await expect(panel.locator('.slot-dot')).toHaveCount(2)
  await expect(panel.locator('.slot-dot.is-spent')).toHaveCount(0)
  await expect(panel.getByRole('region', { name: 'Заговоры' }).locator('.magic-spell-name')).toHaveText(['Огненный снаряд', 'Свет', 'Волшебная рука'])
  await expect(panel.getByRole('region', { name: 'Заклинания: 1-й круг' })).toContainText('Опознание')
  await expect(panel.locator('[data-spell="identify"]')).toContainText('в книге, не подготовлено')
  const innate = panel.getByRole('region', { name: 'Магия черт и вида' })
  await expect(innate).toContainText('Падение пёрышком')
  await expect(innate.locator('[data-spell="feather-fall"]')).toContainText('бесплатно: 1 из 1 до долгого отдыха')
  // Нажатие раскрывает описание (с Сл и атакой героя).
  await panel.locator('[data-spell="fire-bolt"] .magic-spell-toggle').click()
  await expect(panel.locator('[data-spell="fire-bolt"] .spell-details')).toContainText('дальнобойная атака заклинанием +5')
  await expectNoHorizontalScroll(page)

  // Ведущий творит «Волшебную стрелу» — ячейка закрашивается.
  const heroId = await page.evaluate(() => (window as unknown as { __aiMaster: { getState(): { active: { party: { heroId: string }[] } } } }).__aiMaster.getState().active.party[0].heroId)
  await act(page, { type: 'spellCast', heroId, spellId: 'magic-missile', slotLevel: 1, freeKey: null, ritual: false }, MASTER)
  await expect(panel.locator('.slot-dot.is-spent')).toHaveCount(1)
  await expect(panel.getByRole('img', { name: 'Ячейки 1-го круга: осталось 1 из 2' })).toBeVisible()

  // «Изменить подготовленные»: лимит 4, только из книги.
  await panel.getByTestId('edit-prepared').click()
  const editor = panel.getByTestId('prepared-editor')
  await expect(editor.locator('.slot-count')).toHaveText('4 из 4')
  await expect(editor.locator('[data-spell="identify"] .spell-option-toggle')).toBeDisabled()
  await editor.locator('[data-spell="sleep"] .spell-option-toggle').click()
  await editor.locator('[data-spell="identify"] .spell-option-toggle').click()
  await expectNoHorizontalScroll(page)
  await testInfo.attach('вкладка «Магия»', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  await editor.getByRole('button', { name: 'Сохранить' }).click()
  await expect(panel.getByTestId('prepared-editor')).toHaveCount(0)
  await expect(panel.locator('[data-spell="sleep"]')).toContainText('в книге, не подготовлено')
  await expect(panel.locator('[data-spell="identify"]')).not.toContainText('в книге')
  expect(errors).toEqual([])
})

test('у воина без магии вкладки «Магия» нет', async ({ page }) => {
  await page.goto('./')
  await startQuickGame(page)
  await openSheet(page)
  await expect(page.getByRole('tab', { name: 'Характеристики' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Магия' })).toHaveCount(0)
  await expect(page.getByTestId('spell-dialog')).toHaveCount(0)
})

test('старый жрец: в «Моих героях» и в игре предлагается дополнить лист — порядок и заклинания', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page)
  await page.goto('./')
  await startQuickGame(page)
  // Старое сохранение: жрец без выбранных заклинаний (копия Ратибора с другим классом).
  await addHeroCopy(page, { id: 'old-cleric', name: 'Ведана' })
  await page.evaluate(async () => {
    const store = (window as unknown as { __aiMaster: { getState(): { roster: { heroes: { id: string; sheet: { character: Record<string, unknown> } }[] } }; importRecords(r: unknown): Promise<void>; flush(): Promise<void> } }).__aiMaster
    const hero = structuredClone(store.getState().roster.heroes.find((h) => h.id === 'old-cleric')!)
    Object.assign(hero.sheet.character, { classId: 'cleric', className: 'Жрец', feats: [] })
    await store.importRecords({ heroes: [hero] })
    await store.flush()
  })
  await page.reload()
  await page.getByTestId('menu-heroes').click()
  const card = page.getByTestId('hero-old-cleric')
  await expect(card.getByTestId('hero-choose-spells')).toBeVisible()

  // Начать историю — окно выбора открывается само.
  await card.getByRole('button', { name: 'Начать историю' }).click()
  await page.getByRole('button', { name: 'Начать историю' }).click()
  const dialog = page.getByTestId('spell-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Дополните лист: Ведана')
  await expect(dialog.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
  // «Божественный порядок» (SRD 5.2.1): Чудотворец — на один заговор больше.
  await expect(page.locator('.creation-problems')).toHaveText('Выберите: божественный порядок')
  await dialog.getByRole('radiogroup', { name: 'Божественный порядок' }).locator('[data-option="thaumaturge"]').click()
  await expect(dialog.locator('[data-slot="cantrips"] .slot-count')).toHaveText('0 из 4')
  for (const id of ['guidance', 'light', 'thaumaturgy', 'sacred-flame']) await dialog.locator(`[data-slot="cantrips"] [data-spell="${id}"] .spell-option-toggle`).click()
  for (const id of ['cure-wounds', 'bless', 'command', 'sanctuary']) await dialog.locator(`[data-slot="prepared"] [data-spell="${id}"] .spell-option-toggle`).click()
  await expectNoHorizontalScroll(page)
  await testInfo.attach('выбор заклинаний старому герою', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  await dialog.getByRole('button', { name: 'Сохранить' }).click()
  await expect(dialog).toHaveCount(0)

  await openSheet(page)
  await page.getByRole('tab', { name: 'Магия' }).click()
  // МДР 13 (+1): Сл 11, атака +3.
  await expect(page.locator('#sheet-panel-magic').getByTestId('magic-source')).toContainText('Жрец: Мудрость · Сл спасброска 11 · атака заклинанием +3')
  await expect(page.locator('#sheet-panel-magic')).toContainText('Лечение ран')
  await expect(page.getByTestId('choose-spells')).toHaveCount(0)
  // Бонус Чудотворца к Религии: Инт 8 (−1) + Мдр (+1, минимум +1) = +0.
  await page.getByRole('tab', { name: 'Характеристики' }).click()
  await expect(page.getByTestId('class-order-value')).toHaveText('Чудотворец (Thaumaturge)')
  await expect(page.locator('[data-skill="religion"] .stat-mod')).toHaveText('+0')
  expect(errors).toEqual([])
})

test('создание жреца: «Божественный порядок» — Защитник получает тяжёлые доспехи и воинское оружие', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.goto('./')
  await openCharacterCreation(page)
  await option(page, 'Класс', 'cleric').click()
  await expect(page.locator('.creation-problems')).toHaveText('Выберите: божественный порядок')
  await expect(page.getByTestId('class-order')).toContainText('Thaumaturge')
  await page.getByRole('radiogroup', { name: 'Божественный порядок' }).locator('[data-option="protector"]').click()
  await expect(next(page)).toBeEnabled()
  await expectNoHorizontalScroll(page)
  await next(page).click()
  await option(page, 'Предыстория', 'soldier').click()
  await page.getByRole('radiogroup', { name: 'Прибавка +2' }).locator('[data-value="str"]').click()
  await page.getByRole('radiogroup', { name: 'Прибавка +1' }).locator('[data-value="con"]').click()
  await page.getByLabel('Ваш инструмент').selectOption('dice-set')
  await next(page).click()
  await option(page, 'Вид', 'dwarf').click()
  await fillLanguages(page)
  await next(page).click()
  await page.getByRole('button', { name: /Расставить под класс/ }).click()
  await next(page).click()
  for (const skill of ['insight', 'medicine']) await page.locator(`[data-slot="classSkills"] [data-value="${skill}"]`).click()
  await next(page).click()
  await expect(stepTitle(page)).toHaveText('6. Заклинания')
  await expect(slotCount(page, 'cantrips')).toHaveText('0 из 3')
  await fillSpellStep(page)
  await next(page).click()
  await option(page, 'Снаряжение класса', 'class-A').click()
  await option(page, 'Снаряжение предыстории', 'background-B').click()
  await next(page).click()
  await page.getByLabel('Имя', { exact: true }).fill('Ольгерд')
  await next(page).click()
  await page.getByRole('button', { name: 'Сохранить в «Мои герои»' }).click()
  await page.getByTestId('hero-' + (await page.evaluate(() => (window as unknown as { __aiMaster: { getState(): { roster: { heroes: { id: string }[] } } } }).__aiMaster.getState().roster.heroes[0].id))).getByRole('button', { name: 'Лист персонажа' }).click()
  await expect(page.getByTestId('armor-training')).toHaveText('Все доспехи, щиты')
  await expect(page.getByTestId('class-order-value')).toHaveText('Защитник (Protector)')
  expect(errors).toEqual([])
})
