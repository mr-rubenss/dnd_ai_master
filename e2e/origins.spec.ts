// Пропуски 1-го уровня по SRD 5.2.1: приёмы оружия (выбор при создании, «приём освоен» в инвентаре и листе),
// таинственные воззвания колдуна («Договор гримуара»), языки, единый раздел «Умения» (оружие дыхания
// драконорождённого) и окно «Дополните лист» для старых героев. На телефоне — без горизонтальной прокрутки.
import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { act, addHeroCopy, collectPageErrors, expectNoHorizontalScroll, fillChipSlots, fillLanguages, fillSpellStep, MASTER, openCharacterCreation } from './helpers'

const next = (page: Page) => page.getByRole('button', { name: 'Далее', exact: true })
const option = (page: Page, group: string, id: string) => page.getByRole('radiogroup', { name: group }).locator(`[data-option="${id}"]`)
const stepTitle = (page: Page) => page.locator('#creation-step-title')

async function openSheet(page: Page) {
  const toggle = page.locator('.inventory-toggle')
  if (await toggle.isVisible()) await toggle.click()
}

const leadId = (page: Page) =>
  page.evaluate(() => (window as unknown as { __aiMaster: { getState(): { active: { party: { heroId: string }[] } } } }).__aiMaster.getState().active.party[0].heroId)

interface HeroPlan {
  classId: string
  background: 'soldier' | 'criminal'
  species: string
  speciesOption?: string
  name: string
  /** Выборы на шаге «Класс» после выбора класса. */
  onClass?: (page: Page) => Promise<void>
  /** Шаг «Заклинания» (колдун). */
  onSpells?: (page: Page) => Promise<void>
}

/** Создать героя через мастер создания и начать с ним историю. */
async function createHero(page: Page, plan: HeroPlan) {
  await page.goto('./')
  await openCharacterCreation(page)
  await option(page, 'Класс', plan.classId).click()
  await plan.onClass?.(page)
  await expect(next(page)).toBeEnabled()
  await next(page).click()
  await option(page, 'Предыстория', plan.background).click()
  if (plan.background === 'soldier') await page.getByLabel('Ваш инструмент').selectOption('playing-cards')
  await page.getByRole('radio', { name: '+1 к трём' }).click()
  await next(page).click()
  await option(page, 'Вид', plan.species).click()
  if (plan.speciesOption) await page.locator(`.creation-details [data-option="${plan.speciesOption}"]`).click()
  await fillLanguages(page)
  await next(page).click()
  await page.getByRole('button', { name: /Расставить под класс/ }).click()
  await next(page).click()
  await fillChipSlots(page.locator('.skill-slot[data-slot]'))
  await next(page).click()
  if (plan.onSpells) {
    await expect(stepTitle(page)).toHaveText('6. Заклинания')
    await plan.onSpells(page)
    await expect(next(page)).toBeEnabled()
    await next(page).click()
  }
  await option(page, 'Снаряжение класса', 'class-A').click()
  await option(page, 'Снаряжение предыстории', 'background-A').click()
  await next(page).click()
  await page.getByLabel('Имя', { exact: true }).fill(plan.name)
  await next(page).click()
  await expect(stepTitle(page)).toHaveText(/Итог/)
}

async function startStory(page: Page) {
  await page.getByRole('button', { name: 'Начать приключение' }).click()
  await page.getByLabel('Название').fill('Пограничье')
  await page.getByRole('button', { name: 'Начать историю' }).click()
  await expect(page.locator('.dice-tray-button')).toBeVisible()
}

test('воин: приёмы оружия при создании — «приём освоен» у оружия в инвентаре и в листе', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page)
  await createHero(page, {
    classId: 'fighter',
    background: 'soldier',
    species: 'dwarf',
    name: 'Всеслав',
    onClass: async (p) => {
      await option(p, 'Боевой стиль', 'defense').click()
      const masteries = p.getByTestId('weapon-masteries')
      await expect(masteries).toContainText('простое или воинское оружие')
      await expect(masteries.locator('.slot-count')).toHaveText('0 из 3')
      await expect(p.locator('.creation-problems')).toHaveText('Приёмы оружия: выберите 3 (выбрано 0)')
      for (const id of ['greatsword', 'flail', 'longbow']) await masteries.locator(`[data-value="${id}"]`).click()
      // Больше трёх не выбрать.
      await expect(masteries.locator('[data-value="dagger"]')).toBeDisabled()
      await expect(masteries.locator('[data-value="greatsword"]')).toContainText('Задевание')
      await expectNoHorizontalScroll(p)
    },
  })
  await expect(page.getByTestId('summary-masteries')).toHaveText('Двуручный меч (Задевание), Цеп (Ослабление), Длинный лук (Замедление)')
  await expect(page.getByTestId('summary-languages')).toContainText('Общий')
  await startStory(page)

  await openSheet(page)
  await expect(page.getByTestId('masteries-value')).toContainText('Двуручный меч (Задевание)')
  await expect(page.getByTestId('languages-value')).toContainText('Общий')
  await page.getByRole('tab', { name: 'Снаряжение' }).click()
  await expect(page.getByTestId('mastery-greatsword')).toHaveText('приём освоен')
  await expect(page.getByTestId('mastery-flail')).toBeVisible()
  // Метательные копья — без освоенного приёма.
  await expect(page.getByTestId('mastery-javelin')).toHaveCount(0)
  await expect(page.getByTestId('attack-mainHand')).toContainText('приём освоен')
  await page.locator('[data-item="javelin"] .item-button').click()
  await expect(page.locator('[data-item="javelin"] .item-details')).toContainText('Замедление (Slow) — не освоен')
  await expectNoHorizontalScroll(page)
  await testInfo.attach('приёмы оружия в инвентаре', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  expect(errors).toEqual([])
})

test('колдун: воззвание «Договор гримуара» — книга теней с заговорами и ритуалами в листе и во вкладке «Магия»', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page)
  await createHero(page, {
    classId: 'warlock',
    background: 'criminal',
    species: 'dwarf',
    name: 'Зоряна',
    onSpells: async (p) => {
      await fillSpellStep(p)
      const invocations = p.getByTestId('invocations')
      await expect(invocations.locator('.slot-count').first()).toHaveText('0 из 1')
      await expect(p.locator('.creation-problems')).toHaveText('Таинственные воззвания: выберите 1 (выбрано 0)')
      // На 1-м уровне — только воззвания без требований уровня: «Дьявольского зрения» (2+) нет.
      await expect(invocations.locator('[data-option="devils-sight"]')).toHaveCount(0)
      await expect(invocations.locator('[data-option="armor-of-shadows"]')).toBeVisible()
      await invocations.locator('[data-option="pact-of-the-tome"]').click()
      await expect(p.locator('.creation-problems')).toHaveText('«Договор гримуара»: выберите 3 заговора (выбрано 0)')
      const tome = p.getByTestId('tome-choice')
      for (const id of ['guidance', 'light', 'druidcraft']) await tome.locator(`[data-slot="tome-cantrips"] [data-spell="${id}"] .spell-option-toggle`).click()
      // Ритуалы — только заклинания 1-го круга с пометкой «ритуал».
      await expect(tome.locator('[data-slot="tome-rituals"] [data-spell="magic-missile"]')).toHaveCount(0)
      for (const id of ['detect-magic', 'find-familiar']) await tome.locator(`[data-slot="tome-rituals"] [data-spell="${id}"] .spell-option-toggle`).click()
      await expectNoHorizontalScroll(p)
      await testInfo.attach('воззвание при создании', { body: await p.screenshot({ fullPage: true }), contentType: 'image/png' })
    },
  })
  await expect(page.getByTestId('summary-invocations')).toHaveText('Договор гримуара (Указание, Свет, Искусство друидов, Обнаружение магии, Поиск фамильяра)')
  await expect(page.getByTestId('summary-spells')).toContainText('Поиск фамильяра — Воззвание «Договор гримуара»')
  await startStory(page)

  await openSheet(page)
  await expect(page.getByTestId('invocations-value')).toContainText('Договор гримуара')
  await page.getByRole('tab', { name: 'Магия' }).click()
  const innate = page.locator('#sheet-panel-magic').getByRole('region', { name: 'Магия черт и вида' })
  await expect(innate.locator('[data-spell="find-familiar"]')).toContainText('Воззвание «Договор гримуара»')
  await expect(innate.locator('[data-spell="guidance"]')).toBeVisible()
  await expectNoHorizontalScroll(page)
  expect(errors).toEqual([])
})

test('драконорождённый: оружие дыхания в разделе «Умения» — применения кружками, трата и долгий отдых', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page)
  await createHero(page, {
    classId: 'barbarian',
    background: 'soldier',
    species: 'dragonborn',
    speciesOption: 'red',
    name: 'Огнеяр',
    onClass: async (p) => {
      const masteries = p.getByTestId('weapon-masteries')
      await expect(masteries).toContainText('простое или воинское рукопашное оружие')
      // Варвар: только рукопашное — луков в списке нет.
      await expect(masteries.locator('[data-value="longbow"]')).toHaveCount(0)
      for (const id of ['greataxe', 'handaxe']) await masteries.locator(`[data-value="${id}"]`).click()
    },
  })
  await startStory(page)
  await openSheet(page)
  const breath = page.getByTestId('feature-breath-weapon')
  await expect(breath).toContainText('Оружие дыхания')
  await expect(breath).toContainText('Драконорождённый (Красный)')
  await expect(breath).toContainText('2/2 · долгий отдых')
  await expect(page.getByTestId('feature-rage')).toContainText('2/2')
  await expect(page.getByTestId('feature-relentless-endurance')).toHaveCount(0)

  await act(page, { type: 'featureUsed', heroId: await leadId(page), featureId: 'breath-weapon' }, MASTER)
  await expect(breath).toContainText('1/2')
  await expect(breath.locator('.slot-dot.is-spent')).toHaveCount(1)
  await expectNoHorizontalScroll(page)
  await testInfo.attach('раздел «Умения»', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

  // Долгий отдых (без ведущего — отряд отдыхает): применения возвращаются, приёмы оружия можно сменить.
  await page.getByTestId('rest-button').click()
  await page.getByTestId('rest-dialog').getByRole('radio', { name: /Долгий/ }).click()
  await page.getByTestId('rest-dialog').getByRole('button', { name: 'Отдыхать' }).click()
  await expect(breath).toContainText('2/2')
  await page.getByTestId('change-masteries').click()
  const dialog = page.getByTestId('mastery-dialog')
  await expect(dialog).toContainText('можно сменить один вид оружия')
  // Сменить два вида сразу нельзя.
  await dialog.locator('[data-value="greataxe"]').click()
  await dialog.locator('[data-value="handaxe"]').click()
  await dialog.locator('[data-value="maul"]').click()
  await dialog.locator('[data-value="glaive"]').click()
  await dialog.getByRole('button', { name: 'Сохранить' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('После долгого отдыха можно сменить только один вид оружия.')
  await dialog.locator('[data-value="glaive"]').click()
  await dialog.locator('[data-value="handaxe"]').click()
  await dialog.getByRole('button', { name: 'Сохранить' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('masteries-value')).toContainText('Молот (Опрокидывание)')
  await expect(page.getByTestId('change-masteries')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('старый воин без приёмов и языков: «Дополните лист» в игре', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page)
  await page.goto('./')
  await page.getByTestId('menu-quick-start').click()
  await expect(page.locator('.dice-tray-button')).toBeVisible()
  await addHeroCopy(page, { id: 'old-fighter', name: 'Добрыня' })
  await page.evaluate(async () => {
    const store = (window as unknown as { __aiMaster: { getState(): { roster: { heroes: { id: string; sheet: { character: Record<string, unknown> } }[] } }; importRecords(r: unknown): Promise<void>; flush(): Promise<void> } }).__aiMaster
    const hero = structuredClone(store.getState().roster.heroes.find((h) => h.id === 'old-fighter')!)
    delete hero.sheet.character.weaponMasteries
    delete hero.sheet.character.languages
    await store.importRecords({ heroes: [hero] })
    await store.flush()
  })
  await page.reload()
  await page.getByTestId('menu-heroes').click()
  const card = page.getByTestId('hero-old-fighter')
  await expect(card.getByTestId('hero-choose-spells')).toBeVisible()
  await card.getByRole('button', { name: 'Начать историю' }).click()
  await page.getByRole('button', { name: 'Начать историю' }).click()

  const dialog = page.getByTestId('spell-dialog')
  await expect(dialog).toContainText('Дополните лист: Добрыня')
  await expect(page.locator('.creation-problems')).toHaveText('Приёмы оружия: выберите 3 (выбрано 0)')
  for (const id of ['greatsword', 'javelin', 'spear']) await dialog.locator(`[data-slot="weapon-masteries"] [data-value="${id}"]`).click()
  await expect(page.locator('.creation-problems')).toHaveText('Языки: выберите 2 из обычных (выбрано 0)')
  for (const id of ['elvish', 'orc']) await dialog.locator(`[data-slot="languages"] [data-value="${id}"]`).click()
  await expectNoHorizontalScroll(page)
  await testInfo.attach('«Дополните лист»: приёмы и языки', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  await dialog.getByRole('button', { name: 'Сохранить' }).click()
  await expect(dialog).toHaveCount(0)
  await openSheet(page)
  await expect(page.getByTestId('languages-value')).toHaveText('Общий, Эльфийский, Орочий')
  await expect(page.getByTestId('masteries-value')).toContainText('Метательное копьё (Замедление)')
  expect(errors).toEqual([])
})
