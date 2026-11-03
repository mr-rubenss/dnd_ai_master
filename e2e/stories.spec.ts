import type { Page } from '@playwright/test'
import fighterJson from '../src/data/characters/fighter-ratibor.json' with { type: 'json' }
import { expect, test } from './fixtures'
import { act, addHeroCopy, collectPageErrors, continueGame, expectNoHorizontalScroll, flushSaves, MASTER, startQuickGame } from './helpers'

const TAVERN = 'Вечер в «Пьяном грифоне»'

async function openStories(page: Page) {
  await page.getByRole('button', { name: 'В меню' }).click()
  await page.getByTestId('menu-stories').click()
  await expect(page.getByRole('heading', { name: 'Мои истории' })).toBeVisible()
}

const storyCard = (page: Page, title: string) => page.locator('.story-card', { has: page.getByTestId('story-title').getByText(title, { exact: true }) })

async function say(page: Page, text: string) {
  await page.locator('.player-input textarea').fill(text)
  await page.locator('.player-input textarea').press('Enter')
  await expect(page.locator('.message--player').last()).toContainText(text)
}

/** Вторая история «Северный тракт» за Ингрид, тон — хоррор. Открывает игру в ней. */
async function startSecondStory(page: Page) {
  await addHeroCopy(page, { id: 'ingrid', name: 'Ингрид' })
  await openStories(page)
  await page.getByTestId('stories-new').click()
  await page.getByRole('radio', { name: /Ингрид/ }).check()
  await page.getByLabel('Название').fill('Северный тракт')
  await page.getByRole('radio', { name: 'Хоррор' }).check()
  await page.getByRole('button', { name: 'Начать историю' }).click()
  await expect(page.locator('.dice-tray-button')).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.goto('./')
})

test('две истории не смешиваются: свои герои, сообщения и двери', async ({ page, isMobile }, testInfo) => {
  const errors = collectPageErrors(page)
  await startQuickGame(page)
  await say(page, 'Ратибор заказывает эль')
  await act(page, { type: 'doorChanged', locationId: 'drunken-griffin', doorId: 'storage-door', state: 'open' }, MASTER)
  await expect(page.getByTestId('door-storage-door')).toHaveAttribute('data-state', 'open')

  await startSecondStory(page)
  // Во второй истории — своя Ингрид, ни одной реплики Ратибора и запертая кладовая.
  if (isMobile) await page.locator('.inventory-toggle').click()
  await expect(page.locator('.character-name')).toHaveText('Ингрид')
  if (isMobile) await page.locator('.inventory-toggle').click()
  await expect(page.locator('.message--player')).toHaveCount(0)
  await expect(page.getByTestId('door-storage-door')).toHaveAttribute('data-state', 'locked')
  await say(page, 'Ингрид осматривает углы')

  // Список историй: название, герой, уровень, локация, тон, дата последней игры.
  await openStories(page)
  await expect(page.locator('.story-card')).toHaveCount(2)
  const north = storyCard(page, 'Северный тракт')
  await expect(north.getByTestId('story-party')).toHaveText('Ингрид · Воин 1 ур.')
  await expect(north.getByTestId('story-location')).toHaveText('Таверна «Пьяный грифон»')
  await expect(north).toContainText('Хоррор')
  await expect(north).toContainText('Последняя игра:')
  // Последняя сыгранная — первой.
  await expect(page.locator('.story-card').first()).toContainText('Северный тракт')
  await expectNoHorizontalScroll(page)
  await testInfo.attach('мои истории', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

  // Возвращаемся в первую: всё на месте.
  await storyCard(page, TAVERN).getByRole('button', { name: 'Продолжить' }).click()
  await expect(page.locator('.message--player')).toHaveCount(1)
  await expect(page.locator('.message--player')).toContainText('Ратибор заказывает эль')
  await expect(page.getByTestId('door-storage-door')).toHaveAttribute('data-state', 'open')

  // И после перезагрузки истории остаются раздельными.
  await flushSaves(page)
  await page.reload()
  await page.getByTestId('menu-stories').click()
  await storyCard(page, 'Северный тракт').getByRole('button', { name: 'Продолжить' }).click()
  await expect(page.locator('.message--player')).toHaveCount(1)
  await expect(page.locator('.message--player')).toContainText('Ингрид осматривает углы')
  expect(errors).toEqual([])
})

test('переименование и удаление истории (с подтверждением); герой возвращается в «Мои герои»', async ({ page }) => {
  await startQuickGame(page)
  await startSecondStory(page)
  await openStories(page)

  const north = storyCard(page, 'Северный тракт')
  await north.getByRole('button', { name: 'Переименовать' }).click()
  await north.getByLabel('Новое название').fill('  ')
  await north.getByRole('button', { name: 'Сохранить' }).click()
  await expect(north.getByRole('alert')).toHaveText('Введите название истории.')
  await north.getByLabel('Новое название').fill('Тракт мертвецов')
  await north.getByRole('button', { name: 'Сохранить' }).click()
  const renamed = storyCard(page, 'Тракт мертвецов')
  await expect(renamed).toBeVisible()
  await expect(storyCard(page, TAVERN)).toBeVisible()

  let message = ''
  page.once('dialog', (dialog) => {
    message = dialog.message()
    void dialog.dismiss()
  })
  await renamed.getByRole('button', { name: 'Удалить' }).click()
  expect(message).toContain('Удалить историю «Тракт мертвецов»?')
  expect(message).toContain('Герои (Ингрид) вернутся в «Мои герои».')
  await expect(renamed).toBeVisible()

  page.once('dialog', (dialog) => void dialog.accept())
  await renamed.getByRole('button', { name: 'Удалить' }).click()
  await expect(renamed).toHaveCount(0)
  await expect(page.locator('.story-card')).toHaveCount(1)

  await page.getByRole('button', { name: 'В меню' }).click()
  await page.getByTestId('menu-heroes').click()
  await expect(page.getByTestId('hero-ingrid').getByTestId('hero-story')).toHaveText('Вне истории')
  await expect(page.getByTestId('hero-ratibor').getByTestId('hero-story')).toHaveText(`В истории «${TAVERN}»`)
})

test('новая история: свободный герой или новый, название и тон', async ({ page }, testInfo) => {
  await startQuickGame(page)
  await openStories(page)
  await page.getByTestId('stories-new').click()
  // Ратибор занят — свободных героев нет, предлагается создать нового.
  await expect(page.getByText('Свободных героев нет')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Начать историю' })).toBeDisabled()
  await expect(page.getByRole('radio', { name: /Таверна «Пьяный грифон»/ })).toBeChecked()
  await expect(page.getByLabel('Название')).toHaveValue(TAVERN)
  await expect(page.getByRole('radio', { name: 'Лёгкое приключение' })).toBeChecked()
  await expect(page.getByRole('radio')).toHaveCount(5) // приключение + 4 тона
  await expectNoHorizontalScroll(page)
  await testInfo.attach('новая история', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  await page.getByTestId('new-story-create-hero').click()
  await expect(page.getByRole('heading', { name: 'Создание персонажа' })).toBeVisible()
})

test('старое сохранение из localStorage переносится в «Мои истории» без потерь', async ({ page }) => {
  // Игра версии 8 в localStorage — как у игроков до историй. Подкладываем её один раз, до загрузки приложения.
  const { character, inventory } = fighterJson as unknown as { character: Record<string, unknown>; inventory: unknown }
  const save = {
    version: 8,
    state: {
      story: { id: 'old-run', storyId: 'griffin-evening', title: TAVERN, heroId: character.id, startedAt: Date.UTC(2026, 9, 1) },
      character,
      inventory,
      location: { id: 'drunken-griffin', player: { x: 10, y: 13 }, doors: { entrance: 'open', 'storage-door': 'locked' } },
      messages: [{ id: 'old-1', author: 'player', text: 'Старый ход из localStorage' }],
      rolls: [],
    },
  }
  await page.addInitScript((json) => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem('ai-master:save', json)
  }, JSON.stringify(save))
  await page.goto('./')

  await expect(page.getByTestId('menu-continue')).toContainText(`«${TAVERN}»: Ратибор · Воин 1 ур.`)
  await continueGame(page)
  await expect(page.locator('.message--player')).toContainText('Старый ход из localStorage')
  await expect(page.getByTestId('door-entrance')).toHaveAttribute('data-state', 'open')
  const legacy = await page.evaluate(() => [localStorage.getItem('ai-master:save'), localStorage.getItem('ai-master:legacy-backup') !== null])
  expect(legacy).toEqual([null, true])

  // После перезагрузки история на месте и не задвоилась.
  await page.reload()
  await page.getByTestId('menu-stories').click()
  await expect(page.locator('.story-card')).toHaveCount(1)
})
