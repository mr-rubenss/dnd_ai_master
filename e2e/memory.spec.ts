// Память ведущего: сжатие старой ленты в сводку (в фоне, другой моделью), журнал фактов, журнал приключения
// и журнал разработчика, ошибка «слишком длинный контекст», итог истории от ИИ. API подменяется (page.route).
import type { Page, Route } from '@playwright/test'
import { expect, test } from './fixtures'
import { act, collectPageErrors, expectNoHorizontalScroll, MASTER, reloadAndContinue, startQuickGame } from './helpers'

const KEY = 'sk-e2e-fake-key-123456'
const DEEPSEEK = 'https://api.deepseek.com/chat/completions'
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'POST',
}
const RATIBOR = { kind: 'player' as const, heroId: 'ratibor' }

type Body = { model: string; messages: { role: string; content: string | null }[]; tools?: { function: { name: string } }[] }

const sse = (events: unknown[]) => events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('')
const delta = (d: Record<string, unknown>, finish: string | null = null) => ({ choices: [{ index: 0, delta: d, finish_reason: finish }] })
/** Ответ потоком; в конце — расход с кэшем, как у DeepSeek. */
const textStream = (text: string) =>
  sse([
    delta({ content: text }),
    delta({}, 'stop'),
    { choices: [], usage: { prompt_tokens: 9000, completion_tokens: 40, total_tokens: 9040, prompt_cache_hit_tokens: 6400, prompt_cache_miss_tokens: 2600 } },
    '[DONE]',
  ])
const toolStream = (name: string, args: unknown) =>
  sse([delta({ tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] }), delta({}, 'tool_calls'), '[DONE]'])
const fulfillSse = (route: Route, body: string) => route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body })

const kindOf = (body: Body) => {
  const system = body.messages[0]?.content ?? ''
  if (system.includes('## Задача: сжать фрагмент ленты')) return 'compact'
  if (system.includes('## Задача: итог истории')) return 'epilogue'
  return 'turn'
}

/** Подменённый поставщик: ход — текст; сжатие — факт инструментом, затем строки сводки; итог — текст. */
async function mockApi(page: Page, turn: (body: Body, route: Route, index: number) => Promise<void> | void) {
  const bodies: Body[] = []
  let turns = 0
  await page.route(DEEPSEEK, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const body = route.request().postDataJSON() as Body
    bodies.push(body)
    const kind = kindOf(body)
    if (kind === 'compact') {
      const answered = body.messages.some((m) => m.role === 'tool')
      if (body.tools && !answered) return fulfillSse(route, toolStream('note_fact', { text: 'Тобиас — вор бочек; должен гильдии 30 зм' }))
      return fulfillSse(route, textStream('- Герой расспрашивал Гуннара о Тобиасе\n- Гуннар обещал молчать за 5 зм'))
    }
    if (kind === 'epilogue') return fulfillSse(route, textStream('Ратибор вывел Тобиаса на чистую воду. Гуннар сдержал слово. Таверна вздохнула спокойно.'))
    await turn(body, route, turns++)
  })
  return bodies
}

/** Настройки ведущего: маленький целевой размер запроса (сжатие сразу) и отдельная модель для сжатия. */
const configure = (page: Page) =>
  page.addInitScript((key) => {
    localStorage.setItem('ai-master:api-key', key)
    localStorage.setItem('ai-master:ai', JSON.stringify({ provider: 'deepseek', verbosity: 'normal', targetTokens: 3000, compactModel: 'deepseek-lite' }))
  }, KEY)

/** Длинная лента: ходы игрока и ответы ведущего. */
async function fillFeed(page: Page, turns: number) {
  for (let i = 0; i < turns; i++) {
    await act(page, { type: 'playerSpoke', heroId: 'ratibor', messageId: `p${i}`, text: `Старый ход ${i}: расспрашиваю про Тобиаса.` }, RATIBOR)
    await act(page, { type: 'masterNarrated', messageId: `m${i}`, text: `Старый ответ ${i}: Гуннар пожимает плечами.` }, MASTER)
  }
}

async function send(page: Page, text: string) {
  await page.locator('.player-input textarea').fill(text)
  await page.locator('.player-input textarea').press('Enter')
}

async function openJournal(page: Page, isMobile: boolean) {
  if (isMobile) await page.locator('.inventory-toggle').tap()
  await page.getByRole('tab', { name: 'Журнал' }).click()
  return page.getByTestId('adventure-journal')
}

test('длинная игра: сжатие в фоне другой моделью, сводка и факты в запросе и в журнале, журнал разработчика', async ({ page, isMobile }, testInfo) => {
  const errors = collectPageErrors(page)
  await configure(page)
  const bodies = await mockApi(page, (_, route, i) => fulfillSse(route, textStream(i === 0 ? 'Гуннар кивает на дверь кладовой.' : 'Тобиас бледнеет.')))
  await page.goto('./')
  await startQuickGame(page)
  await fillFeed(page, 8)

  await send(page, 'Спрашиваю, где Тобиас.')
  await expect(page.locator('.message--master').last()).toHaveText(/Гуннар кивает на дверь кладовой\./)
  // Сжатие — после ответа, в фоне: сначала факт (note_fact), потом сводка.
  await expect.poll(() => bodies.filter((b) => kindOf(b) === 'compact').length).toBeGreaterThanOrEqual(2)
  const compact = bodies.filter((b) => kindOf(b) === 'compact')
  expect(compact.every((b) => b.model === 'deepseek-lite')).toBe(true)
  expect(compact[0].tools?.map((t) => t.function.name)).toEqual(['note_fact'])
  expect(compact[0].messages[1].content).toContain('Игрок (Ратибор): Старый ход 0: расспрашиваю про Тобиаса.')
  expect(bodies[0].model).toBe('deepseek-chat')

  // Журнал приключения: сводка и факт; вся лента для игрока на месте.
  const journal = await openJournal(page, isMobile)
  await expect(journal.getByTestId('journal-summary')).toContainText('Герой расспрашивал Гуннара о Тобиасе')
  await expect(journal.getByTestId('journal-facts')).toContainText('Тобиас — вор бочек; должен гильдии 30 зм')
  await expect(page.locator('.narration-log')).toContainText('Старый ход 0: расспрашиваю про Тобиаса.')
  if (isMobile) await expectNoHorizontalScroll(page)
  await testInfo.attach('журнал приключения', { body: await page.screenshot(), contentType: 'image/png' })
  if (isMobile) await page.locator('.inventory-toggle').tap()

  // Следующий запрос: сводка и журнал фактов в системном промте, старых сообщений нет, последние — как есть.
  await send(page, 'Иду к кладовой.')
  await expect(page.locator('.message--master').last()).toHaveText(/Тобиас бледнеет\./)
  const next = bodies.filter((b) => kindOf(b) === 'turn')[1]
  const system = next.messages[0].content!
  expect(system.indexOf('## Что было раньше')).toBeLessThan(system.indexOf('## Журнал фактов'))
  expect(system.indexOf('## Журнал фактов')).toBeLessThan(system.indexOf('## Состояние игры'))
  expect(system).toContain('- Гуннар обещал молчать за 5 зм')
  expect(system).toContain('- Тобиас — вор бочек; должен гильдии 30 зм')
  const contents = next.messages.slice(1).map((m) => m.content)
  expect(contents).not.toContain('Старый ход 0: расспрашиваю про Тобиаса.')
  expect(contents).toContain('Гуннар кивает на дверь кладовой.')
  expect(contents.at(-1)).toBe('Иду к кладовой.')

  // Журнал разработчика: части запроса, кэш, сжатие.
  await page.getByTestId('settings-open').click()
  const panel = page.getByTestId('settings-panel')
  await panel.getByTestId('settings-tab-master').click()
  await expect(panel.getByTestId('context-window-preset')).toHaveText(/DeepSeek: 128\s000 токенов\./)
  await expect(panel.getByTestId('target-tokens')).toHaveValue('3000')
  await expect(panel.getByTestId('compact-model')).toHaveValue('deepseek-lite')
  const log = panel.getByTestId('dev-log')
  await log.locator('summary').click()
  const turnEntry = log.locator('[data-testid="dev-log-request"][data-purpose="turn"]').first()
  await expect(turnEntry).toContainText('из кэша 6 400 (71%)')
  await expect(turnEntry.getByTestId('dev-log-parts')).toContainText(/Правила и промт [\d\s]+ · Инструменты [\d\s]+ · Что было раньше [\d\s]+ · Журнал фактов/)
  // Первое сжатие (записи — новые сверху): факт записан, запрос стал меньше.
  const first = log.getByTestId('dev-log-compaction').last()
  await expect(first).toContainText(/Сжатие памяти \(запрос больше бюджета\) · deepseek-lite/)
  await expect(first).toContainText(/Сжато сообщений: \d+ · запрос ≈[\d\s]+ → ≈[\d\s]+ ток\./)
  await expect(first).toContainText('новых фактов: 1')
  if (isMobile) await expectNoHorizontalScroll(page)
  await testInfo.attach('журнал разработчика', { body: await page.screenshot(), contentType: 'image/png' })
  await page.keyboard.press('Escape')

  // Память — часть истории: после перезагрузки сводка на месте.
  await reloadAndContinue(page)
  const again = await openJournal(page, isMobile)
  await expect(again.getByTestId('journal-summary')).toContainText('Гуннар обещал молчать за 5 зм')
  expect(errors).toEqual([])
})

test('«слишком длинный контекст»: сжатие и один повтор — игрок получает ответ', async ({ page }) => {
  await configure(page)
  const bodies = await mockApi(page, (_, route, i) => {
    if (i === 0)
      return route.fulfill({
        status: 400,
        headers: { ...CORS, 'content-type': 'application/json' },
        body: JSON.stringify({ error: { message: "This model's maximum context length is 65536 tokens.", type: 'invalid_request_error' } }),
      })
    return fulfillSse(route, textStream('Человек в капюшоне поднимает взгляд.'))
  })
  await page.goto('./')
  await startQuickGame(page)
  await fillFeed(page, 4)
  await send(page, 'Подсаживаюсь к нему.')
  await expect(page.locator('.message--master').last()).toHaveText(/Человек в капюшоне поднимает взгляд\./)
  await expect(page.getByTestId('master-error')).toHaveCount(0)
  const kinds = bodies.map(kindOf)
  // Ход → отказ → сжатие (факт, сводка) → тот же ход ещё раз, уже со сводкой.
  expect(kinds.slice(0, 4)).toEqual(['turn', 'compact', 'compact', 'turn'])
  expect(bodies[3].messages[0].content).toContain('## Что было раньше')
  expect(bodies.filter((b) => kindOf(b) === 'turn')).toHaveLength(2)
})

test('итог истории пишет ведущий по сводке и журналу фактов; игрок может его поправить', async ({ page }) => {
  await configure(page)
  const bodies = await mockApi(page, (_, route) => fulfillSse(route, textStream('Ок.')))
  await page.goto('./')
  await startQuickGame(page)
  await act(page, { type: 'factRecorded', fact: { id: 'f1', text: 'Тобиас — вор бочек', at: 1 } }, MASTER)
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByTestId('finish-story').click()
  const dialog = page.getByRole('dialog', { name: /Итог истории/ })
  const summary = dialog.getByLabel('Краткое содержание')
  await expect(summary).toHaveValue('Ратибор вывел Тобиаса на чистую воду. Гуннар сдержал слово. Таверна вздохнула спокойно.')
  const request = bodies.find((b) => kindOf(b) === 'epilogue')!
  expect(request.messages[1].content).toContain('- Тобиас — вор бочек')
  await summary.fill('Ратибор нашёл вора.')
  await dialog.getByRole('button', { name: 'Сохранить в летопись' }).click()
  await expect(dialog).toHaveCount(0)
})
