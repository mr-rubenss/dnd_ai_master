import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { collectPageErrors, continueGame, expectNoHorizontalScroll, face, flushSaves, installRngQueue, openCharacterCreation, queueRolls } from './helpers'

const next = (page: Page) => page.getByRole('button', { name: 'Далее', exact: true })
const option = (page: Page, group: string, id: string) => page.getByRole('radiogroup', { name: group }).locator(`[data-option="${id}"]`)
const chip = (page: Page, slot: string, value: string) => page.locator(`[data-slot="${slot}"] [data-value="${value}"]`)
const stepTitle = (page: Page) => page.locator('#creation-step-title')

/** 4к6 для шести характеристик: итоги 16, 15, 14, 13, 12, 10 (худший кубик отбрасывается). */
const ABILITY_ROLLS = [
  [6, 5, 5, 1],
  [5, 5, 5, 2],
  [5, 5, 4, 1],
  [5, 4, 4, 3],
  [4, 4, 4, 1],
  [4, 3, 3, 2],
].flat()

test.beforeEach(async ({ page }) => {
  await installRngQueue(page)
  await page.goto('./')
  await openCharacterCreation(page)
})

test('шаги вперёд закрыты, пока текущий не завершён', async ({ page }) => {
  await expect(page.locator('.dice-tray-button')).toHaveCount(0)
  await expect(stepTitle(page)).toHaveText('1. Класс')
  await expect(next(page)).toBeDisabled()
  await expect(page.locator('.creation-problems')).toHaveText('Выберите класс')
  await expect(page.locator('.creation-steps button', { hasText: 'Вид' })).toBeDisabled()
  await expect(page.getByRole('radiogroup', { name: 'Класс' }).getByRole('radio')).toHaveCount(12)
  await expectNoHorizontalScroll(page)

  await option(page, 'Класс', 'fighter').click()
  await expect(page.locator('.creation-details')).toContainText('к10')
  // Воину нужен боевой стиль.
  await expect(next(page)).toBeDisabled()
  await expect(page.locator('.creation-problems')).toHaveText('Выберите боевой стиль')
  await option(page, 'Боевой стиль', 'defense').click()
  await expect(next(page)).toBeEnabled()
})

test('полный путь: плут-эльф с предысторией преступника и бросками 4к6', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page)

  // 1. Класс
  await option(page, 'Класс', 'rogue').click()
  await expect(page.locator('.creation-details')).toContainText('Скрытая атака')
  await expectNoHorizontalScroll(page)
  await next(page).click()

  // 2. Предыстория: +2 Ловкость, +1 Телосложение
  await expect(stepTitle(page)).toHaveText('2. Предыстория')
  await option(page, 'Предыстория', 'criminal').click()
  await expect(page.locator('.creation-details')).toContainText('Бдительный')
  await expect(next(page)).toBeDisabled()
  await page.getByRole('radiogroup', { name: 'Прибавка +2' }).locator('[data-value="dex"]').click()
  await page.getByRole('radiogroup', { name: 'Прибавка +1' }).locator('[data-value="con"]').click()
  await expectNoHorizontalScroll(page)
  await next(page).click()

  // 3. Вид: лесной эльф
  await expect(stepTitle(page)).toHaveText('3. Вид')
  await option(page, 'Вид', 'elf').click()
  await expect(page.locator('.creation-problems')).toHaveText('Выберите: эльфийская ветвь')
  await option(page, 'Эльфийская ветвь', 'wood-elf').click()
  await expect(page.locator('.creation-details')).toContainText('35 футов')
  await expectNoHorizontalScroll(page)
  await next(page).click()

  // 4. Характеристики: бросок 4к6 с подменённым генератором и расстановка под класс
  await expect(stepTitle(page)).toHaveText('4. Характеристики')
  await queueRolls(page, ABILITY_ROLLS.map((v) => face(v, 6)))
  await page.getByRole('radio', { name: 'Бросок 4к6' }).click()
  await expect(page.locator('.ability-rolls strong')).toHaveText(['16', '15', '14', '13', '12', '10'])
  await expect(page.locator('.ability-rolls li').first().locator('.die-chip.is-dropped')).toHaveText('1')
  await page.getByRole('button', { name: /Расставить под класс/ }).click()
  await expect(page.locator('tr[data-ability="dex"] .final-cell strong')).toHaveText('18')
  await expect(page.locator('tr[data-ability="con"] .final-cell strong')).toHaveText('16')
  await expectNoHorizontalScroll(page)
  await next(page).click()

  // 5. Навыки: 4 навыка плута, Острые чувства, компетентность
  await expect(stepTitle(page)).toHaveText('5. Навыки')
  await expect(page.locator('.hint').first()).toContainText('Ловкость рук, Скрытность')
  await expect(chip(page, 'classSkills', 'stealth')).toBeDisabled() // уже даёт предыстория
  for (const skill of ['acrobatics', 'deception', 'investigation', 'insight']) await chip(page, 'classSkills', skill).click()
  await expect(chip(page, 'classSkills', 'perception')).toBeDisabled() // лимит 4
  await chip(page, 'speciesSkills', 'perception').click()
  await chip(page, 'expertise', 'stealth').click()
  await chip(page, 'expertise', 'perception').click()
  await expectNoHorizontalScroll(page)
  await next(page).click()

  // 6. Снаряжение: набор плута A, золото преступника B
  await expect(stepTitle(page)).toHaveText('6. Снаряжение')
  await option(page, 'Снаряжение класса', 'class-A').click()
  await option(page, 'Снаряжение предыстории', 'background-B').click()
  await expectNoHorizontalScroll(page)
  await next(page).click()

  // 7. Имя и внешность
  await expect(stepTitle(page)).toHaveText('7. Имя и внешность')
  await page.getByLabel('Имя', { exact: true }).fill('Тень')
  await page.getByLabel('Внешность и характер').fill('Худощавая эльфийка в тёмном плаще.')
  await next(page).click()

  // 8. Итог
  await expect(stepTitle(page)).toHaveText('8. Итог')
  await expect(page.getByTestId('summary-name')).toHaveText('Тень')
  await expect(page.locator('.summary-head p')).toHaveText('Эльф (Лесной эльф) · Плут 1 ур. · Преступник')
  await expect(page.getByTestId('summary-hp')).toHaveText('11') // к8 + ТЕЛ 16 (+3)
  await expect(page.getByTestId('summary-ac')).toHaveText('15') // кожаный доспех 11 + ЛОВ 18 (+4)
  await expect(page.getByTestId('summary-skills')).toContainText('Скрытность (компетентность) +8')
  await expect(page.getByTestId('summary-items')).toContainText('Кожаный доспех (надето)')
  await expect(page.locator('.summary-sheet')).toContainText('58 зм')
  await expectNoHorizontalScroll(page)
  await testInfo.attach('итоговый лист', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

  // Начало игры и сохранение: после перезагрузки — стартовый экран с «Продолжить».
  // «Начать приключение» ведёт к новой истории: герой уже выбран, остаётся название и тон.
  await page.getByRole('button', { name: 'Начать приключение' }).click()
  await expect(page.getByRole('heading', { name: 'Новая история' })).toBeVisible()
  await expect(page.getByRole('radio', { name: /Тень/ })).toBeChecked()
  await page.getByLabel('Название').fill('Тень над трактом')
  await page.getByRole('radio', { name: 'Детектив' }).check()
  await page.getByRole('button', { name: 'Начать историю' }).click()
  await expect(page.locator('.dice-tray-button')).toBeVisible()
  await flushSaves(page)
  await page.reload()
  await expect(page.getByTestId('menu-continue')).toContainText('«Тень над трактом»')
  await expect(page.getByTestId('menu-continue')).toContainText('Тень · Плут 1 ур. · Таверна «Пьяный грифон»')
  await continueGame(page)
  if (await page.locator('.inventory-toggle').isVisible()) await page.locator('.inventory-toggle').click()
  await expect(page.locator('.character-name')).toHaveText('Тень')
  await expect(page.locator('.character-meta')).toHaveText('Эльф · Плут 1 ур. · Преступник')
  await page.getByRole('tab', { name: 'Характеристики' }).click()
  await expect(page.locator('[data-skill="stealth"] .prof-mark--expertise')).toHaveCount(1)
  await expectNoHorizontalScroll(page)
  expect(errors).toEqual([])
})

test('человек с чертой «Одарённый» выбирает ещё три навыка; можно вернуться назад', async ({ page }) => {
  await option(page, 'Класс', 'fighter').click()
  await option(page, 'Боевой стиль', 'great-weapon-fighting').click()
  await next(page).click()
  await option(page, 'Предыстория', 'soldier').click()
  await page.getByLabel('Ваш инструмент').selectOption('playing-cards')
  await page.getByRole('radio', { name: '+1 к трём' }).click()
  await next(page).click()
  await option(page, 'Вид', 'human').click()
  await expect(page.locator('.creation-problems')).toHaveText('Выберите черту происхождения')
  await option(page, 'Черта происхождения', 'skilled').click()
  await next(page).click()
  await page.getByRole('button', { name: /Расставить под класс/ }).click()
  await next(page).click()

  await expect(page.locator('[data-slot="featSkills"] .slot-count')).toHaveText('0 из 3')
  await chip(page, 'classSkills', 'perception').click()
  await chip(page, 'classSkills', 'survival').click()
  await chip(page, 'speciesSkills', 'stealth').click()
  await expect(chip(page, 'featSkills', 'perception')).toBeDisabled() // уже выбран для класса
  for (const skill of ['arcana', 'history', 'medicine']) await chip(page, 'featSkills', skill).click()
  await expect(next(page)).toBeEnabled()

  // Возврат на шаг «Класс» по навигации, выбор сохраняется.
  await page.locator('.creation-steps button', { hasText: 'Класс' }).click()
  await expect(option(page, 'Класс', 'fighter')).toHaveAttribute('aria-checked', 'true')
  await page.locator('.creation-steps button', { hasText: 'Навыки' }).click()
  await expect(page.locator('[data-slot="featSkills"] .slot-count')).toHaveText('3 из 3')
})

test('своя предыстория по шаблону 2024: сборка, бюджет 50 зм и итоговый лист', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page)
  await option(page, 'Класс', 'wizard').click()
  await next(page).click()

  await option(page, 'Предыстория', 'custom').click()
  await expect(next(page)).toBeDisabled()
  await expect(page.locator('.creation-problems')).toHaveText('Введите название предыстории')
  await page.getByLabel('Название').fill('Корабельный юнга')
  for (const a of ['str', 'dex', 'wis']) await page.locator(`[data-slot="custom-abilities"] [data-value="${a}"]`).click()
  await expect(page.locator('[data-slot="custom-abilities"] [data-value="int"]')).toBeDisabled()
  for (const s of ['athletics', 'perception']) await page.locator(`[data-slot="custom-skills"] [data-value="${s}"]`).click()
  await page.getByLabel('Инструмент', { exact: true }).selectOption('navigators-tools')
  // Черты боевого стиля в списке нет — только происхождения.
  const feats = page.getByRole('radiogroup', { name: 'Черта своей предыстории' })
  await expect(feats.getByRole('radio')).toHaveCount(4)
  await feats.locator('[data-option="alert"]').click()

  // Покупки: 2 верёвки (2 зм) и кинжал (2 зм) — осталось 46 зм.
  await page.getByLabel('Поиск предмета').fill('верёвка')
  await page.getByRole('button', { name: 'Больше: Верёвка (50 футов)' }).click()
  await page.getByRole('button', { name: 'Больше: Верёвка (50 футов)' }).click()
  await page.getByLabel('Поиск предмета').fill('кинжал')
  await page.getByRole('button', { name: 'Больше: Кинжал' }).click()
  await expect(page.getByTestId('budget-left')).toHaveText('осталось 46 зм')
  // Кольчуга (75 зм) не по карману.
  await page.getByLabel('Поиск предмета').fill('кольчуга')
  await expect(page.getByRole('button', { name: 'Больше: Кольчуга', exact: true })).toBeDisabled()

  await page.getByRole('radiogroup', { name: 'Прибавка +2' }).locator('[data-value="dex"]').click()
  await page.getByRole('radiogroup', { name: 'Прибавка +1' }).locator('[data-value="wis"]').click()
  await expectNoHorizontalScroll(page)
  await testInfo.attach('своя предыстория', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  await next(page).click()

  await option(page, 'Вид', 'orc').click()
  await next(page).click()
  await page.getByRole('button', { name: /Расставить под класс/ }).click()
  await next(page).click()
  await expect(page.locator('.hint').first()).toContainText('Атлетика, Внимательность')
  await chip(page, 'classSkills', 'arcana').click()
  await chip(page, 'classSkills', 'history').click()
  await next(page).click()
  await option(page, 'Снаряжение класса', 'class-A').click()
  await option(page, 'Снаряжение предыстории', 'background-A').click()
  await next(page).click()
  await page.getByLabel('Имя', { exact: true }).fill('Сёма')
  await next(page).click()

  await expect(page.locator('.summary-head p')).toHaveText('Орк · Волшебник 1 ур. · Корабельный юнга')
  await expect(page.getByTestId('summary-tools')).toHaveText('Инструменты навигатора')
  await expect(page.locator('.summary-sheet')).toContainText('Бдительный')
  await expect(page.locator('.summary-sheet')).toContainText('51 зм') // 5 зм волшебника + 46 зм сдачи
  await expect(page.getByTestId('summary-items')).toContainText('Верёвка (50 футов) ×2')
  await expectNoHorizontalScroll(page)

  // Героя можно сохранить, не начиная истории: он появляется в «Моих героях» свободным.
  await page.getByRole('button', { name: 'Сохранить в «Мои герои»' }).click()
  await expect(page.getByRole('heading', { name: 'Мои герои' })).toBeVisible()
  const card = page.locator('.hero-card')
  await expect(card).toHaveCount(1)
  await expect(card.locator('.hero-meta')).toHaveText('Орк · Волшебник 1 ур.')
  await expect(card.locator('.hero-portrait')).toHaveText('📜')
  await expect(card.getByTestId('hero-story')).toHaveText('Вне истории')
  expect(errors).toEqual([])
})
