// Действия на карте → события для ведущего: значимое перемещение (вплотную к НПС, новая комната) вызывает короткую
// реакцию ведущего сразу, без реплики игрока, но не чаще одной за паузу; мелкие перемещения копятся и уходят ведущему
// вместе со следующей репликой. API поставщика подменяется (page.route).
import type { Page, Route } from '@playwright/test'
import { expect, test } from './fixtures'
import { collectPageErrors, expectNoHorizontalScroll, startQuickGame, withEndTurn } from './helpers'

const KEY = 'sk-e2e-fake-key-map-events'
const API = 'https://api.deepseek.com/chat/completions'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'POST' }
const sse = (text: string) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
type Body = { messages: { role: string; content: string | null }[] }

async function mockMaster(page: Page, replies: string[]) {
  const bodies: Body[] = []
  await page.route(API, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    bodies.push(route.request().postDataJSON() as Body)
    await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: withEndTurn(route, sse(replies.shift() ?? 'Таверна шумит.')) })
  })
  return bodies
}

async function cellPoint(page: Page, x: number, y: number) {
  return page.locator('.map-svg').evaluate(
    (svg, [cx, cy]) => {
      const p = new DOMPoint(cx + 0.5, cy + 0.5).matrixTransform((svg as SVGSVGElement).getScreenCTM()!)
      return { x: p.x, y: p.y }
    },
    [x, y],
  )
}
async function stepTo(page: Page, x: number, y: number, isMobile: boolean) {
  const p = await cellPoint(page, x, y)
  if (isMobile) await page.touchscreen.tap(p.x, p.y)
  else await page.mouse.click(p.x, p.y)
  const hero = page.getByTestId('player-token')
  await expect(hero).toHaveAttribute('data-x', String(x))
  await expect(hero).toHaveAttribute('data-y', String(y))
}
const lastUser = (body: Body) => [...body.messages].reverse().find((m) => m.role === 'user')?.content ?? ''

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem('ai-master:api-key', key), KEY)
})

test('мелкие перемещения копятся и уходят ведущему с репликой игрока — с обстановкой', async ({ page, isMobile }) => {
  const errors = collectPageErrors(page)
  const bodies = await mockMaster(page, ['Ты стоишь посреди зала; Тобиас в углу тебя не замечает.'])
  await page.goto('./')
  await startQuickGame(page)
  await stepTo(page, 8, 12, isMobile)
  await stepTo(page, 7, 12, isMobile)
  // Не значимо — запроса к ведущему нет.
  await page.waitForTimeout(300)
  expect(bodies).toHaveLength(0)
  await page.locator('.player-input textarea').fill('Оглядываюсь.')
  await page.locator('.player-input textarea').press('Enter')
  await expect(page.locator('.message--master').last()).toContainText('Тобиас в углу тебя не замечает')
  expect(bodies).toHaveLength(1)
  const said = lastUser(bodies[0])
  expect(said).toMatch(/^\[Перемещение на карте\] Ратибор прошёл 15 фт\. \(2 перемещения подряд\) из клетки \(10, 13\) \(«Общий зал»\)\. Сейчас: Ратибор — «Общий зал», клетка \(7, 12\); рядом: /)
  expect(said).toContain('его видят: ')
  expect(said.endsWith('\nОглядываюсь.')).toBe(true)
  // Обстановка — и в состоянии игры (раздел «Где герои»), а скрытые зоны — только ведущему.
  expect(bodies[0].messages[0].content).toContain('## Где герои')
  expect(bodies[0].messages[0].content).toContain('Скрипучие половицы')
  await expect(page.getByText('Скрипучие половицы')).toHaveCount(0)
  // Реплика игрока в ленте — без служебного описания.
  await expect(page.locator('.message--player').last()).toHaveText(/^Вы\s*Оглядываюсь\.$/)
  await expectNoHorizontalScroll(page)
  expect(errors).toEqual([])
})

test.describe('значимые перемещения', () => {
  test.skip(({ isMobile }) => isMobile, 'нажатие рядом с НПС на телефоне Chrome «притягивает» к токену НПС — проверяем мышью')

  test('вплотную к НПС — реакция ведущего сразу; следующая значимая в паузу — копится и уходит с репликой', async ({ page }, testInfo) => {
    const errors = collectPageErrors(page)
    const bodies = await mockMaster(page, ['Тобиас поднимает глаза от кружки и щурится на тебя.', 'Гуннар кивает тебе из-за стойки.'])
    await page.goto('./')
    await startQuickGame(page)
    await stepTo(page, 18, 9, false)
    // Реакция без реплики игрока: строка «На карте» и короткий ответ ведущего.
    await expect(page.getByTestId('map-event')).toHaveText('На карте Ратибор: подошёл вплотную к Тобиас.')
    await expect(page.locator('.message--master').last()).toContainText('Тобиас поднимает глаза')
    expect(bodies).toHaveLength(1)
    const event = lastUser(bodies[0])
    expect(event).toMatch(/^\[Событие на карте — игрок ничего не писал; коротко \(1–3 предложения\)/)
    expect(event).toContain('Значимо: подошёл вплотную к Тобиас')
    expect(event).toContain('вплотную: Тобиас')
    await testInfo.attach('событие на карте', { body: await page.locator('.story-panel').screenshot(), contentType: 'image/png' })

    // Новая комната сразу после — в паузе между реакциями: запроса нет, событие копится.
    await stepTo(page, 10, 4, false)
    await page.waitForTimeout(400)
    expect(bodies).toHaveLength(1)
    await expect(page.getByTestId('map-event')).toHaveCount(1)
    await page.locator('.player-input textarea').fill('Здороваюсь с трактирщиком.')
    await page.locator('.player-input textarea').press('Enter')
    await expect(page.locator('.message--master').last()).toContainText('Гуннар кивает')
    expect(lastUser(bodies[1])).toMatch(/^\[Перемещение на карте\] Ратибор прошёл \d+ фт\. из клетки \(18, 9\)[\s\S]*«У стойки», клетка \(10, 4\)[\s\S]*\nЗдороваюсь с трактирщиком\.$/)
    expect(errors).toEqual([])
  })
})

test('«Подойти» из меню — одна реплика, без отдельной реакции на перемещение', async ({ page, isMobile }) => {
  const bodies = await mockMaster(page, ['Тобиас кивает на свободный стул.'])
  await page.goto('./')
  await startQuickGame(page)
  if (isMobile) await page.getByTestId('npc-tobias').tap()
  else await page.getByTestId('npc-tobias').click()
  await page.getByTestId('map-actions').getByRole('button', { name: 'Подойти' }).click()
  await expect(page.locator('.message--master').last()).toContainText('Тобиас кивает')
  expect(bodies).toHaveLength(1)
  await expect(page.getByTestId('map-event')).toHaveCount(0)
  expect(lastUser(bodies[0])).toMatch(/^\[Перемещение на карте\] [\s\S]*вплотную: Тобиас[\s\S]*\nПодхожу к «Тобиас»\.$/)
})
