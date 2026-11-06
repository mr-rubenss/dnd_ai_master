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

/** Подменённый API. hold — задержать ответ на запрос предыстории с этим номером (0, 1…) до release(). */
async function mockApi(page: Page, proposals: unknown[], hold: number[] = []) {
  const bodies: Body[] = []
  const releases: (() => void)[] = []
  let proposalIndex = 0
  await page.route(DEEPSEEK, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const body = route.request().postDataJSON() as Body
    bodies.push(body)
    const isProposal = body.tools?.some((t) => t.function.name === 'propose_background')
    if (isProposal) {
      const index = proposalIndex++
      if (hold.includes(index)) await new Promise<void>((resolve) => releases.push(resolve))
    }
    const payload = isProposal ? proposalStream(proposals.shift()) : textStream('Ветер с моря доносит запах соли.')
    await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: withEndTurn(route, payload) }).catch(() => {})
  })
  return { bodies, release: () => releases.shift()?.() }
}

const withKey = (page: Page) => page.addInitScript((key) => localStorage.setItem('ai-master:api-key', key), KEY)

async function toBackground(page: Page) {
  await page.goto('./')
  await openCharacterCreation(page)
  await option(page, 'Класс', 'wizard').click()
  await next(page).click()
}

/** Дойти от шага предыстории (прибавки выбраны) до итога. */
async function finishCreation(page: Page, name: string) {
  await next(page).click()
  await option(page, 'Вид', 'orc').click()
  await next(page).click()
  await page.getByRole('button', { name: /Расставить под класс/ }).click()
  await next(page).click()
  // Два свободных навыка класса (часть могла дать предыстория).
  for (let i = 0; i < 2; i++) await page.locator('[data-slot="classSkills"] [aria-checked="false"]:not([disabled])').first().click()
  await next(page).click()
  await option(page, 'Снаряжение класса', 'class-A').click()
  await option(page, 'Снаряжение предыстории', 'background-A').click()
  await next(page).click()
  await page.getByLabel('Имя', { exact: true }).fill(name)
  await next(page).click()
}

async function pickBonuses(page: Page, plus2: string, plus1: string) {
  await page.getByRole('radiogroup', { name: 'Прибавка +2' }).locator(`[data-value="${plus2}"]`).click()
  await page.getByRole('radiogroup', { name: 'Прибавка +1' }).locator(`[data-value="${plus1}"]`).click()
}

test('готовая предыстория: необязательная «История героя» внизу; текст один на все варианты', async ({ page, isMobile }, testInfo) => {
  const errors = collectPageErrors(page)
  await toBackground(page)
  // Сначала — выбор способа, отдельного поля над карточками нет.
  await expect(page.getByTestId('backstory')).toHaveCount(0)
  await expect(option(page, 'Предыстория', 'from-story')).toContainText('Написать свою историю')
  await expect(option(page, 'Предыстория', 'custom')).toContainText('Собрать вручную')

  await option(page, 'Предыстория', 'sage').click()
  const field = page.getByTestId('backstory')
  await expect(page.getByRole('region', { name: 'История героя' })).toContainText('Несколько слов о прошлом героя — ведущий использует это в сюжете.')
  await field.fill(BACKSTORY)
  await pickBonuses(page, 'int', 'wis')
  await expect(next(page)).toBeEnabled()

  // Переключение: «Собрать вручную» и «Написать свою историю» — тот же текст.
  await option(page, 'Предыстория', 'custom').click()
  await expect(page.getByTestId('backstory')).toHaveValue(BACKSTORY)
  await option(page, 'Предыстория', 'from-story').click()
  await expect(page.getByTestId('backstory')).toHaveValue(BACKSTORY)
  await option(page, 'Предыстория', 'sage').click()
  await expect(page.getByTestId('backstory')).toHaveValue(BACKSTORY)
  if (isMobile) await expectNoHorizontalScroll(page)
  await testInfo.attach('шаг предыстории: готовая', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

  await pickBonuses(page, 'int', 'wis')
  await finishCreation(page, 'Мудрец')
  await expect(page.getByTestId('summary-backstory')).toHaveText(BACKSTORY)
  expect(errors).toEqual([])
})

test('своя история без ключа: история обязательна, механика — вручную, история сохраняется', async ({ page, isMobile }) => {
  await toBackground(page)
  await option(page, 'Предыстория', 'from-story').click()
  await expect(page.getByTestId('story-no-ai')).toContainText('соберите вручную ниже')
  await expect(page.getByTestId('suggest-background')).toHaveCount(0)
  // Механика — обычной формой; история — обязательна.
  await page.getByLabel('Название', { exact: true }).fill('Беглый матрос')
  for (const a of ['str', 'dex', 'con']) await page.locator(`[data-slot="custom-abilities"] [data-value="${a}"]`).click()
  for (const sk of ['athletics', 'perception']) await page.locator(`[data-slot="custom-skills"] [data-value="${sk}"]`).click()
  await page.getByLabel('Инструмент', { exact: true }).selectOption('navigators-tools')
  await page.getByRole('radiogroup', { name: 'Черта своей предыстории' }).locator('[data-option="alert"]').click()
  await pickBonuses(page, 'dex', 'con')
  await expect(page.locator('.creation-problems')).toHaveText('Напишите историю героя')
  await expect(next(page)).toBeDisabled()
  await page.getByTestId('backstory').fill(BACKSTORY)
  await expect(next(page)).toBeEnabled()
  if (isMobile) await expectNoHorizontalScroll(page)
  await finishCreation(page, 'Ярема')
  await expect(page.locator('.summary-head p')).toContainText('Беглый матрос')
  await expect(page.getByTestId('summary-backstory')).toHaveText(BACKSTORY)
})

test('своя история с ИИ: этапы и секунды, поле только для чтения, предложение, детали, правка, «Предложить иначе», журнал', async ({ page, isMobile }, testInfo) => {
  const errors = collectPageErrors(page)
  await withKey(page)
  // Второй подбор: сначала нарушение шаблона, исправление ждёт — видно «попытка 2 из 3».
  const tooRich = { ...PROPOSAL, name: 'Корабельный навигатор', equipment: [{ item: 'navigators-tools', quantity: 3 }] }
  const api = await mockApi(page, [PROPOSAL, tooRich, { ...PROPOSAL, name: 'Корабельный навигатор', abilities: ['dex', 'int', 'wis'] }], [0, 2])
  await toBackground(page)
  await option(page, 'Предыстория', 'from-story').click()
  const suggest = page.getByTestId('suggest-background')
  await expect(suggest).toHaveText('Подобрать предысторию по истории')
  await expect(suggest).toBeDisabled()
  await page.getByTestId('backstory').fill(BACKSTORY)
  await suggest.click()

  // Пока ИИ работает: этап, секунды, «Отменить»; поле только для чтения.
  const progress = page.getByTestId('ai-progress')
  await expect(progress.getByTestId('ai-progress-stage')).toHaveText('Отправляю историю…')
  await expect(progress.getByTestId('ai-progress-seconds')).toHaveText(/^[1-9]\d* с$/, { timeout: 3_000 })
  await expect(page.getByTestId('backstory')).toHaveAttribute('readonly', '')
  if (isMobile) await expectNoHorizontalScroll(page)
  await testInfo.attach('подбор предыстории: индикатор', { body: await page.screenshot(), contentType: 'image/png' })
  api.release()

  const explanations = page.getByTestId('proposal-explanations')
  await expect(explanations).toContainText('Атлетика — паруса и такелаж; Внимательность — вахта на марсе.')
  await expect(page.getByTestId('backstory')).not.toHaveAttribute('readonly', '')
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Беглый матрос')
  await expect(page.getByTestId('budget-left')).toHaveText('осталось 47 зм')

  const details = page.getByTestId('proposal-details')
  await details.getByRole('button', { name: 'Добавить', exact: true }).first().click()
  await details.getByRole('button', { name: 'Не надо' }).click()
  await expect(page.getByTestId('backstory')).toHaveValue(`${BACKSTORY} Родом из портового Вельгарда.`)
  if (isMobile) await expectNoHorizontalScroll(page)
  await testInfo.attach('шаг предыстории: своя история', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

  await page.getByLabel('Название', { exact: true }).fill('Беглый матрос с «Чайки»')
  await page.getByTestId('suggest-background').click()
  await expect(page.getByTestId('ai-progress-stage')).toHaveText('Мастер исправляет (попытка 2 из 3)…')
  api.release()
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Корабельный навигатор')
  expect(api.bodies[1].messages[1].content).toContain('Прошлое предложение')
  expect(api.bodies[2].messages.at(-1)!.content).toContain('больше 50 зм')
  // Запрос сокращён: без доспехов и дорогих предметов.
  expect(api.bodies[0].messages[0].content).not.toContain('plate-armor')
  expect(api.bodies[0].messages[0].content).toContain('navigators-tools')

  await pickBonuses(page, 'dex', 'wis')
  await finishCreation(page, 'Ярема')
  await expect(page.getByTestId('summary-backstory')).toHaveText(`${BACKSTORY} Родом из портового Вельгарда.`)

  // Журнал разработчика: длительность и размер каждой попытки.
  await page.getByTestId('settings-open').click()
  const panel = page.getByTestId('settings-panel')
  await panel.getByTestId('settings-tab-master').click()
  await panel.getByTestId('dev-log').locator('summary').click()
  await expect(panel.getByTestId('dev-log-attempt').first()).toContainText(/Предыстория по истории · deepseek-chat · \d+\.\d с · ответ получен/)
  await expect(panel.getByTestId('dev-log-attempt').first()).toContainText(/Запрос [\d\s]+ симв\. · ответ [\d\s]+ симв\./)
  expect(errors).toEqual([])
})

test('подбор: «Отменить» обрывает запрос, всё остаётся как было', async ({ page }) => {
  await withKey(page)
  await mockApi(page, [PROPOSAL], [0])
  await toBackground(page)
  await option(page, 'Предыстория', 'from-story').click()
  await page.getByTestId('backstory').fill(BACKSTORY)
  await page.getByTestId('suggest-background').click()
  await expect(page.getByTestId('ai-progress')).toBeVisible()
  await page.getByTestId('ai-cancel').click()
  await expect(page.getByTestId('ai-progress')).toHaveCount(0)
  await expect(page.getByTestId('proposal-error')).toHaveCount(0)
  await expect(page.getByTestId('suggest-background')).toHaveText('Подобрать предысторию по истории')
  await expect(page.getByTestId('backstory')).toHaveValue(BACKSTORY)
  await expect(page.getByTestId('backstory')).not.toHaveAttribute('readonly', '')
})

test('подбор: тайм-аут — понятное сообщение, «Попробовать ещё раз» и «Собрать вручную» (история сохраняется)', async ({ page }) => {
  await withKey(page)
  // Короткие сроки на время теста (в игре — из src/ai/timeouts.ts).
  await page.addInitScript(() => Object.assign(window, { __aiMasterTimeouts: { background: { totalMs: 3000, idleMs: 1000 } } }))
  await mockApi(page, [PROPOSAL, PROPOSAL, PROPOSAL], [0, 2])
  await toBackground(page)
  await option(page, 'Предыстория', 'from-story').click()
  await page.getByTestId('backstory').fill(BACKSTORY)
  await page.getByTestId('suggest-background').click()
  const error = page.getByTestId('proposal-error')
  await expect(error).toContainText('Модель молчит: за 1 с не пришло ни одного куска ответа. Запрос остановлен.')
  await expect(error.getByRole('button', { name: 'Попробовать ещё раз' })).toBeVisible()
  // Второй раз отвечает сразу.
  await error.getByRole('button', { name: 'Попробовать ещё раз' }).click()
  await expect(page.getByTestId('proposal-explanations')).toBeVisible()

  await page.getByTestId('suggest-background').click()
  await expect(error).toBeVisible()
  await error.getByRole('button', { name: 'Собрать вручную' }).click()
  await expect(option(page, 'Предыстория', 'custom')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('backstory')).toHaveValue(BACKSTORY)
})

test('ИИ так и не дал предложение по шаблону — понятная ошибка и выход в ручной режим', async ({ page }) => {
  await withKey(page)
  const tooRich = { ...PROPOSAL, equipment: [{ item: 'navigators-tools', quantity: 3 }] }
  await mockApi(page, [tooRich, tooRich, tooRich])
  await toBackground(page)
  await option(page, 'Предыстория', 'from-story').click()
  await page.getByTestId('backstory').fill(BACKSTORY)
  await page.getByTestId('suggest-background').click()
  await expect(page.getByTestId('proposal-error')).toContainText(
    'ИИ не смог предложить предысторию по шаблону: Снаряжение стоит 75 зм — больше 50 зм Попробуйте ещё раз или заполните вручную.',
  )
  await page.getByTestId('proposal-manual').click()
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('')
})
