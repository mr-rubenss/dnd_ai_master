// «История героя» и предыстория «По моей истории» (ответ ИИ подменён page.route): без ключа, корректное предложение,
// нарушение шаблона с исправлением, «Предложить иначе», дописанные детали, история — в листе и в контексте ведущего.
import type { Page, Route } from '@playwright/test'
import { expect, test } from './fixtures'
import { collectPageErrors, expectNoHorizontalScroll, openCharacterCreation, withEndTurn } from './helpers'

const KEY = 'sk-e2e-fake-key-123456'
const DEEPSEEK = 'https://api.deepseek.com/chat/completions'
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'POST',
}
const BACKSTORY = 'Бывший моряк, сбежал с корабля после бунта, ищет брата.'

const next = (page: Page) => page.getByRole('button', { name: 'Далее', exact: true })
const option = (page: Page, group: string, id: string) => page.getByRole('radiogroup', { name: group }).locator(`[data-option="${id}"]`)

const PROPOSAL = {
  name: 'Беглый матрос',
  description: 'Ходил на торговом когге, после бунта бежал на берег.',
  abilities: ['str', 'dex', 'con'],
  skills: ['athletics', 'perception'],
  tool: 'navigators-tools',
  feat: 'savage-attacker',
  equipment: [
    { item: 'spear', quantity: 1 },
    { item: 'crowbar', quantity: 1 },
  ],
  explanations: {
    name: 'Моряк, сбежавший после бунта.',
    abilities: 'Сила и выносливость — годы на вантах, Ловкость — качка.',
    skills: 'Атлетика — паруса и такелаж; Внимательность — вахта на марсе.',
    tool: 'Навигационные инструменты — вёл корабль по звёздам.',
    feat: 'Дикий атакующий — бунт научил драться грязно.',
    equipment: 'Копьё и ломик — всё, что унёс с корабля.',
  },
  extra_details: ['Родом из портового Вельгарда.', 'Брат служил юнгой на том же корабле.'],
}

type Body = { messages: { role: string; content: string | null }[]; tools?: { function: { name: string } }[] }

const sse = (events: unknown[]) => events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('')
const proposalStream = (args: unknown) =>
  sse([
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'p1', type: 'function', function: { name: 'propose_background', arguments: JSON.stringify(args) } }] }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    '[DONE]',
  ])
const textStream = (text: string) =>
  sse([{ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }, '[DONE]'])

async function mockApi(page: Page, proposals: unknown[]) {
  const bodies: Body[] = []
  await page.route(DEEPSEEK, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const body = route.request().postDataJSON() as Body
    bodies.push(body)
    const isProposal = body.tools?.some((t) => t.function.name === 'propose_background')
    const payload = isProposal ? proposalStream(proposals.shift()) : textStream('Ветер с моря доносит запах соли.')
    await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: withEndTurn(route, payload) })
  })
  return bodies
}

test('без ключа: «По моей истории» недоступно с подсказкой, «История героя» и ручной режим работают', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.goto('./')
  await openCharacterCreation(page)
  await option(page, 'Класс', 'wizard').click()
  await next(page).click()
  const fromStory = option(page, 'Предыстория', 'from-story')
  await expect(fromStory).toBeDisabled()
  await expect(fromStory).toContainText('нужен ключ API')
  await expect(fromStory).toContainText('укажите ключ API в «Настройки» → «Ведущий»')
  // История героя — при готовой предыстории тоже.
  await page.getByTestId('backstory').fill(BACKSTORY)
  await option(page, 'Предыстория', 'soldier').click()
  await expect(page.getByTestId('backstory')).toHaveValue(BACKSTORY)
  await option(page, 'Предыстория', 'custom').click()
  await expect(page.getByLabel('Название', { exact: true })).toBeVisible()
  await expect(page.getByTestId('backstory')).toHaveValue(BACKSTORY)
  expect(errors).toEqual([])
})

test('по моей истории: предложение с объяснениями, детали — по решению игрока, ручная правка, «Предложить иначе»', async ({ page, isMobile }, testInfo) => {
  const errors = collectPageErrors(page)
  await page.addInitScript((key) => localStorage.setItem('ai-master:api-key', key), KEY)
  // Второй раз: сначала нарушение шаблона (снаряжение дороже 50 зм), потом исправленное.
  const tooRich = { ...PROPOSAL, name: 'Корабельный навигатор', equipment: [{ item: 'navigators-tools', quantity: 3 }] }
  const bodies = await mockApi(page, [PROPOSAL, tooRich, { ...PROPOSAL, name: 'Корабельный навигатор', abilities: ['dex', 'int', 'wis'] }])
  await page.goto('./')
  await openCharacterCreation(page)
  await option(page, 'Класс', 'wizard').click()
  await next(page).click()

  await option(page, 'Предыстория', 'from-story').click()
  const panel = page.getByTestId('story-proposal')
  await expect(panel).toContainText('Напишите «Историю героя»')
  await expect(page.getByTestId('suggest-background')).toBeDisabled()
  await page.getByTestId('backstory').fill(BACKSTORY)
  await page.getByTestId('suggest-background').click()

  // Объяснение каждого выбора.
  const explanations = page.getByTestId('proposal-explanations')
  await expect(explanations).toContainText('Атлетика — паруса и такелаж; Внимательность — вахта на марсе.')
  await expect(explanations).toContainText('Навигационные инструменты — вёл корабль по звёздам.')
  // Предложение — в обычной форме своей предыстории, всё можно поменять вручную.
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Беглый матрос')
  await expect(page.locator('[data-slot="custom-skills"] [data-value="athletics"]')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('budget-left')).toHaveText('осталось 47 зм')

  // Дописанные детали — отдельно; в историю попадает только принятая.
  const details = page.getByTestId('proposal-details')
  await details.getByRole('button', { name: 'Добавить в историю' }).first().click()
  await details.getByRole('button', { name: 'Не надо' }).click()
  await expect(page.getByTestId('backstory')).toHaveValue(`${BACKSTORY} Родом из портового Вельгарда.`)
  await expect(details.locator('[data-status="rejected"]')).toContainText('Брат служил юнгой')
  if (isMobile) await expectNoHorizontalScroll(page)
  await testInfo.attach('предыстория по моей истории', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

  await page.getByLabel('Название', { exact: true }).fill('Беглый матрос с «Чайки»')
  await page.locator('[data-slot="custom-skills"] [data-value="perception"]').click()
  await page.locator('[data-slot="custom-skills"] [data-value="survival"]').click()

  // «Предложить иначе»: прошлое предложение уходит модели; ошибку шаблона она исправляет.
  await page.getByTestId('suggest-background').click()
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Корабельный навигатор')
  const retry = bodies[2].messages
  expect(bodies[1].messages[1].content).toContain('Прошлое предложение')
  expect(retry.at(-1)!.role).toBe('tool')
  expect(retry.at(-1)!.content).toContain('больше 50 зм')
  expect(bodies[0].messages[1].content).toContain(BACKSTORY)
  await expect(page.locator('[data-slot="custom-abilities"] [data-value="int"]')).toHaveAttribute('aria-checked', 'true')

  // Дальше — до листа: история героя на месте и уходит ведущему.
  await page.getByRole('radiogroup', { name: 'Прибавка +2' }).locator('[data-value="dex"]').click()
  await page.getByRole('radiogroup', { name: 'Прибавка +1' }).locator('[data-value="wis"]').click()
  await next(page).click()
  await option(page, 'Вид', 'orc').click()
  await next(page).click()
  await page.getByRole('button', { name: /Расставить под класс/ }).click()
  await next(page).click()
  for (const chip of await page.locator('[data-slot="classSkills"] [aria-checked="false"]:not([disabled])').all()) {
    if ((await page.locator('[data-slot="classSkills"] [aria-checked="true"]').count()) >= 2) break
    await chip.click()
  }
  if (await page.locator('[data-slot="speciesSkills"]').count())
    await page.locator('[data-slot="speciesSkills"] [aria-checked="false"]:not([disabled])').first().click()
  await next(page).click()
  await option(page, 'Снаряжение класса', 'class-A').click()
  await option(page, 'Снаряжение предыстории', 'background-A').click()
  await next(page).click()
  await page.getByLabel('Имя', { exact: true }).fill('Ярема')
  await next(page).click()
  await expect(page.getByTestId('summary-backstory')).toHaveText(`${BACKSTORY} Родом из портового Вельгарда.`)
  await expect(page.locator('.summary-head p')).toContainText('Корабельный навигатор')

  await page.getByRole('button', { name: 'Начать приключение' }).click()
  await page.getByRole('button', { name: 'Начать историю' }).click()
  await page.locator('.player-input textarea').fill('Спрашиваю про корабли в порту.')
  await page.locator('.player-input textarea').press('Enter')
  await expect(page.locator('.message--master').last()).toContainText('Ветер с моря')
  const turn = bodies.find((b) => !b.tools?.some((t) => t.function.name === 'propose_background'))!
  expect(turn.messages[0].content).toContain(`История героя (словами игрока; источник зацепок для сюжета): ${BACKSTORY} Родом из портового Вельгарда.`)
  expect(errors).toEqual([])
})

test('ИИ так и не дал предложение по шаблону — понятная ошибка; можно перейти к ручной предыстории', async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem('ai-master:api-key', key), KEY)
  const tooRich = { ...PROPOSAL, equipment: [{ item: 'navigators-tools', quantity: 3 }] }
  await mockApi(page, [tooRich, tooRich, tooRich])
  await page.goto('./')
  await openCharacterCreation(page)
  await option(page, 'Класс', 'wizard').click()
  await next(page).click()
  await page.getByTestId('backstory').fill(BACKSTORY)
  await option(page, 'Предыстория', 'from-story').click()
  await page.getByTestId('suggest-background').click()
  await expect(page.getByTestId('proposal-error')).toHaveText(
    'ИИ не смог предложить предысторию по шаблону: Снаряжение стоит 75 зм — больше 50 зм Попробуйте ещё раз или заполните вручную.',
  )
  await option(page, 'Предыстория', 'custom').click()
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('')
})
