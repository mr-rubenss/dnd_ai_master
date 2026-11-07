// «Что-то не так»: тестовый отчёт — кнопки в меню и у поля ввода, окно с описанием, «Скопировать» и «Скачать файл»,
// предложение после сбоя. В отчёте — ход с сырым запросом и ответом модели, инструменты, броски; ключа нет.
// API поставщика подменяется (page.route).
import { readFile } from 'node:fs/promises'
import type { Page, Route } from '@playwright/test'
import { expect, test } from './fixtures'
import { act, collectPageErrors, ENGINE, expectNoHorizontalScroll, face, installRngQueue, queueRolls, startQuickGame, withEndTurn } from './helpers'

const KEY = 'sk-e2e-report-SECRET-987654'
const API = 'https://api.deepseek.com/chat/completions'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'POST' }
const sse = (events: unknown[]) => events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('')
const delta = (d: Record<string, unknown>, finish: string | null = null) => ({ choices: [{ index: 0, delta: d, finish_reason: finish }] })
const toolCall = (index: number, id: string, name: string, args: unknown) =>
  delta({ tool_calls: [{ index, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })

async function mockRounds(page: Page, rounds: (string | number)[]) {
  await page.route(API, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const next = rounds.shift() ?? sse([delta({ content: '…' }, 'stop')])
    if (typeof next === 'number') return route.fulfill({ status: next, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ error: { message: 'Invalid API key' } }) })
    await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: withEndTurn(route, next) })
  })
}

async function say(page: Page, text: string) {
  await page.locator('.player-input textarea').fill(text)
  await page.locator('.player-input textarea').press('Enter')
}

/** «Скачать файл» — текст скачанного отчёта. */
async function downloadReport(page: Page): Promise<{ name: string; text: string }> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('report-download').click()])
  const path = await download.path()
  return { name: download.suggestedFilename(), text: await readFile(path!, 'utf8') }
}

test('у поля ввода: отчёт с ходом — запрос, сырой ответ, отказ движка, скрытый бросок, ручной бросок; без ключа', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page)
  await installRngQueue(page)
  await page.addInitScript((key) => localStorage.setItem('ai-master:api-key', key), KEY)
  await mockRounds(page, [
    sse([
      delta({ content: 'Ты окидываешь зал взглядом.' }),
      toolCall(0, 'c1', 'request_check', { skill: 'perception', dc: 14, reason: 'вор крадётся следом', hidden: true }),
      toolCall(1, 'c2', 'change_gold', { amount: -1000, reason: 'взятка' }),
      delta({}, 'tool_calls'),
      '[DONE]',
    ]),
    sse([delta({ content: 'В углу шевельнулась тень.' }, 'stop'), '[DONE]']),
  ])
  await page.goto('./')
  await startQuickGame(page)
  await queueRolls(page, [face(15, 20)])
  await say(page, 'Осматриваюсь: нет ли слежки?')
  await expect(page.locator('.message--master').last()).toContainText('В углу шевельнулась тень.')
  // Ручной бросок с панели кубиков.
  await act(page, { type: 'diceRolled', roll: { id: 'tray-e2e', timestamp: 1, result: { notation: '1d6', mode: 'normal', groups: [{ sign: 1, count: 1, sides: 6, dice: [{ sides: 6, value: 4, kept: true }], subtotal: 4 }], modifier: 0, total: 4, natural: null, critical: null }, manual: true } }, ENGINE)

  await page.getByTestId('report-button').click()
  const dialog = page.getByTestId('report-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Тестовый отчёт' })).toBeVisible()
  await dialog.getByLabel('Что пошло не так?').fill(`Тень появилась без броска? Ключ на всякий: ${KEY}`)
  await expectNoHorizontalScroll(page)
  await testInfo.attach('окно отчёта', { body: await page.screenshot(), contentType: 'image/png' })

  const { name, text } = await downloadReport(page)
  await expect(page.getByTestId('report-status')).toContainText('Файл отчёта сохранён')
  expect(name).toMatch(/^ai-master-report-\d{4}-\d{2}-\d{2}-\d{4}\.md$/)
  await testInfo.attach('отчёт', { body: text, contentType: 'text/markdown' })

  expect(text).toContain('# Тестовый отчёт ИИ-Мастера')
  expect(text).toContain('## Что пошло не так\n> Тень появилась без броска?')
  expect(text).toMatch(/- Версия игры: \d+\.\d+\.\d+ \(/)
  expect(text).toContain('- Браузер: Mozilla/5.0')
  expect(text).toContain('- Игровое время и локация: День 1, 19:00 (вечер)')
  expect(text).toContain('### Ход 1 ·')
  expect(text).toContain('> Осматриваюсь: нет ли слежки?')
  expect(text).toContain('#### Запрос 1')
  expect(text).toContain('#### Ответ 2')
  expect(text).toContain('Ты окидываешь зал взглядом.')
  expect(text).toContain('- `change_gold` (запрос 1) — **ОТКАЗ движка**')
  expect(text).toContain('**СКРЫТЫЙ** (игрок не видит)')
  expect(text).toContain('в следующий запрос ведущему: да')
  expect(text).toContain('## Ручные броски с панели кубиков')
  expect(text).toContain('1к6: [4] = 4')
  expect(text).toContain('## Журнал действий (последние')
  expect(text).toContain('- Модель: deepseek-chat')
  // Ни ключа, ни адреса API.
  expect(text).not.toContain(KEY)
  expect(text).not.toContain('SECRET')
  expect(text).not.toContain('api.deepseek.com')

  await dialog.getByRole('button', { name: 'Закрыть' }).click()
  await expect(dialog).toHaveCount(0)
  expect(errors).toEqual([])
})

test('в меню: «Что-то не так» — отчёт без истории, «Скопировать»', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('./')
  await page.getByTestId('report-button').click()
  const dialog = page.getByTestId('report-dialog')
  await dialog.getByLabel('Что пошло не так?').fill('Не открывается меню героев')
  await dialog.getByTestId('report-copy').click()
  await expect(page.getByTestId('report-status')).toContainText('Отчёт скопирован')
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toContain('> Не открывается меню героев')
  expect(copied).toContain('- История: не открыта')
  expect(copied).toContain('## Ходы (последние 0)')
  await expectNoHorizontalScroll(page)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('сбой ведущего: у ошибки — «Что-то не так», описание подставлено, ошибка в отчёте', async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem('ai-master:api-key', key), KEY)
  await mockRounds(page, [401])
  await page.goto('./')
  await startQuickGame(page)
  await say(page, 'Подхожу к стойке')
  const error = page.getByTestId('master-error')
  await expect(error).toBeVisible()
  await error.getByTestId('report-from-error').click()
  const dialog = page.getByTestId('report-dialog')
  await expect(dialog.getByLabel('Что пошло не так?')).toHaveValue(/^Ошибка ведущего: /)
  const { text } = await downloadReport(page)
  expect(text).toContain('> Подхожу к стойке')
  expect(text).toMatch(/\*\*Ошибка:\*\* .*\[auth/)
  expect(text).not.toContain(KEY)
  await expectNoHorizontalScroll(page)
})

test('необработанная ошибка: игра сама предлагает отчёт, ошибка — в разделе консоли', async ({ page }) => {
  await page.goto('./')
  await startQuickGame(page)
  await page.evaluate(() => {
    window.setTimeout(() => {
      throw new Error('Что-то упало в e2e')
    })
  })
  const offer = page.getByTestId('report-offer')
  await expect(offer).toContainText('Что-то упало в e2e')
  await expectNoHorizontalScroll(page)
  await offer.getByRole('button', { name: 'Составить отчёт' }).click()
  await expect(offer).toHaveCount(0)
  const dialog = page.getByTestId('report-dialog')
  await expect(dialog.getByLabel('Что пошло не так?')).toHaveValue(/Сбой: .*Что-то упало в e2e/)
  const { text } = await downloadReport(page)
  expect(text).toMatch(/## Ошибки консоли \([1-9]/)
  expect(text).toContain('Error: Что-то упало в e2e')
})
