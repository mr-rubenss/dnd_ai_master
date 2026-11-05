// ИИ-ведущий: настройки, проверка подключения и ход ведущего. API поставщика подменяется (page.route) — настоящих
// запросов нет; ключ в тестах — выдуманный.
import type { Page, Route } from '@playwright/test'
import { expect, test } from './fixtures'
import { collectPageErrors, expectNoHorizontalScroll, startQuickGame } from './helpers'

const KEY = 'sk-e2e-fake-key-123456'
const DEEPSEEK = 'https://api.deepseek.com/chat/completions'
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'POST',
}

const sse = (events: unknown[]) => events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('')
const delta = (d: Record<string, unknown>, finish: string | null = null) => ({ choices: [{ index: 0, delta: d, finish_reason: finish }] })
const textStream = (parts: string[]) => sse([...parts.map((p) => delta({ content: p })), delta({}, 'stop'), '[DONE]'])

type Handler = (body: Record<string, unknown>, route: Route) => Promise<void> | void

/** Подменяет API: на каждый POST — handler; OPTIONS (предзапрос CORS) — разрешение. Возвращает тела запросов. */
async function mockApi(page: Page, url: string, handler: Handler) {
  const bodies: Record<string, unknown>[] = []
  const headers: Record<string, string>[] = []
  await page.route(url, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const body = route.request().postDataJSON() as Record<string, unknown>
    bodies.push(body)
    headers.push(route.request().headers())
    await handler(body, route)
  })
  return { bodies, headers }
}

const fulfillSse = (route: Route, text: string) =>
  route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: text })
const fulfillJson = (route: Route, status: number, json: unknown, extra: Record<string, string> = {}) =>
  route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json', ...extra }, body: JSON.stringify(json) })

/** Исправный поставщик: без стриминга — JSON, с инструментами — два вызова, иначе — текст потоком. */
const healthy: Handler = (body, route) => {
  if (body.stream === false)
    return fulfillJson(route, 200, { choices: [{ index: 0, message: { role: 'assistant', content: 'да' }, finish_reason: 'stop' }] })
  if (body.tools)
    return fulfillSse(
      route,
      sse([
        delta({ tool_calls: [{ index: 0, id: 'a', type: 'function', function: { name: 'add_numbers', arguments: '{"a":2,' } }] }),
        delta({ tool_calls: [{ index: 1, id: 'b', type: 'function', function: { name: 'get_time_of_day', arguments: '{"place":"Таверна"}' } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: '"b":3}' } }] }),
        delta({}, 'tool_calls'),
        '[DONE]',
      ]),
    )
  return fulfillSse(route, textStream(['Один, ', 'два, ', 'три.']))
}

async function openMasterTab(page: Page) {
  await page.getByTestId('settings-open').click()
  const panel = page.getByTestId('settings-panel')
  await expect(panel.getByTestId('settings-tab-appearance')).toHaveAttribute('aria-selected', 'true')
  await panel.getByTestId('settings-tab-master').click()
  await expect(panel.getByTestId('settings-tab-master')).toHaveAttribute('aria-selected', 'true')
  return panel
}

/** Ключ уже введён (как будто игрок настроил ведущего раньше). */
const withKey = (page: Page) => page.addInitScript((key) => localStorage.setItem('ai-master:api-key', key), KEY)

test('вкладки настроек; «Ведущий»: пресет DeepSeek, скрытый ключ, длина ответов, хранение', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.goto('./')
  const panel = await openMasterTab(page)
  await expect(panel.getByTestId('provider-deepseek')).toHaveAttribute('aria-checked', 'true')
  await expect(panel.getByTestId('preset-info')).toContainText('https://api.deepseek.com')
  await expect(panel.getByTestId('preset-info')).toContainText('deepseek-chat')
  await expect(panel.getByTestId('check-connection')).toBeDisabled()
  await expect(panel.getByTestId('master-problems')).toHaveText('Введите ключ API.')

  const key = panel.getByTestId('api-key')
  await expect(key).toHaveAttribute('type', 'password')
  await key.fill(KEY)
  await panel.getByTestId('api-key-toggle').click()
  await expect(key).toHaveAttribute('type', 'text')
  await panel.getByTestId('api-key-toggle').click()
  await expect(key).toHaveAttribute('type', 'password')
  await expect(panel.getByTestId('check-connection')).toBeEnabled()

  await panel.getByTestId('verbosity-short').click()
  // «Свой»: адрес и модель вручную, проверка адреса.
  await panel.getByTestId('provider-custom').click()
  await panel.getByTestId('api-base-url').fill('http://api.example.com/v1')
  await expect(panel.getByTestId('master-problems')).toContainText('https://')
  await panel.getByTestId('api-base-url').fill('https://api.example.com/v1')
  await panel.getByTestId('api-model').fill('my-model')
  await expect(panel.getByTestId('master-problems')).toHaveCount(0)

  // Ключ — отдельно от остальных настроек, только в localStorage этого браузера.
  const stored = await page.evaluate(() => ({ key: localStorage.getItem('ai-master:api-key'), ai: localStorage.getItem('ai-master:ai') }))
  expect(stored.key).toBe(KEY)
  expect(stored.ai).not.toContain(KEY)
  expect(JSON.parse(stored.ai!)).toMatchObject({ provider: 'custom', baseUrl: 'https://api.example.com/v1', model: 'my-model', verbosity: 'short' })

  await page.reload()
  const again = await openMasterTab(page)
  await expect(again.getByTestId('provider-custom')).toHaveAttribute('aria-checked', 'true')
  await expect(again.getByTestId('api-model')).toHaveValue('my-model')
  await expect(again.getByTestId('verbosity-short')).toHaveAttribute('aria-checked', 'true')
  await expect(again.getByTestId('api-key')).toHaveValue(KEY)
  await expect(again.getByTestId('api-key')).toHaveAttribute('type', 'password')
  expect(errors).toEqual([])
})

test('«Проверить подключение»: ключ, стриминг, несколько инструментов в одном ответе', async ({ page }, testInfo) => {
  await withKey(page)
  const api = await mockApi(page, DEEPSEEK, healthy)
  await page.goto('./')
  const panel = await openMasterTab(page)
  await panel.getByTestId('check-connection').click()
  for (const id of ['key', 'stream', 'tools']) await expect(panel.getByTestId(`check-${id}`)).toHaveAttribute('data-status', 'ok')
  await expect(panel.getByTestId('check-tools')).toContainText('Оба инструмента вызваны в одном ответе')
  expect(api.bodies.map((b) => [b.model, b.stream, !!b.tools])).toEqual([
    ['deepseek-chat', false, false],
    ['deepseek-chat', true, false],
    ['deepseek-chat', true, true],
  ])
  expect(api.headers[0].authorization).toBe(`Bearer ${KEY}`)
  await testInfo.attach('проверка подключения', { body: await page.screenshot(), contentType: 'image/png' })
})

test('проверка: неверный ключ — объяснение, остальные проверки пропущены; ключ нигде не показан', async ({ page }) => {
  await withKey(page)
  await mockApi(page, DEEPSEEK, (_, route) =>
    fulfillJson(route, 401, {
      error: { message: `Authentication Fails, Your api key: ****${KEY.slice(-4)} is invalid`, type: 'authentication_error' },
    }),
  )
  await page.goto('./')
  const panel = await openMasterTab(page)
  await panel.getByTestId('check-connection').click()
  await expect(panel.getByTestId('check-key')).toHaveAttribute('data-status', 'fail')
  await expect(panel.getByTestId('check-key')).toContainText('Ключ API не принят')
  await expect(panel.getByTestId('check-key')).toContainText('Без принятого ключа ведущий не сможет отвечать.')
  await expect(panel.getByTestId('check-stream')).toHaveAttribute('data-status', 'skipped')
  await expect(panel.getByTestId('check-tools')).toHaveAttribute('data-status', 'skipped')
  expect(await panel.getByTestId('check-results').innerText()).not.toContain(KEY.slice(-4))
})

test('проверка «Своего» поставщика: модель не вызывает инструменты', async ({ page }) => {
  await withKey(page)
  await page.addInitScript(() =>
    localStorage.setItem(
      'ai-master:ai',
      JSON.stringify({ provider: 'custom', format: 'openai-chat', baseUrl: 'https://llm.example.com/v1', model: 'tiny' }),
    ),
  )
  const api = await mockApi(page, 'https://llm.example.com/v1/chat/completions', (body, route) =>
    body.tools ? fulfillSse(route, textStream(['Сумма — 5, ', 'сейчас вечер.'])) : healthy(body, route),
  )
  await page.goto('./')
  const panel = await openMasterTab(page)
  await panel.getByTestId('check-connection').click()
  await expect(panel.getByTestId('check-tools')).toHaveAttribute('data-status', 'fail')
  await expect(panel.getByTestId('check-tools')).toContainText('не сможет запрашивать проверки')
  await expect(panel.getByTestId('check-stream')).toHaveAttribute('data-status', 'ok')
  expect(api.bodies[0].model).toBe('tiny')
})

test('ход ведущего: запрос с историей, ответ появляется потоком и записывается в историю', async ({ page }) => {
  const errors = collectPageErrors(page)
  await withKey(page)
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  const api = await mockApi(page, DEEPSEEK, async (_, route) => {
    await held
    await fulfillSse(route, textStream(['Гуннар ', 'поднимает взгляд ', 'и кивает.']))
  })
  await page.goto('./')
  await startQuickGame(page)
  const masters = await page.locator('.message--master:not(.is-streaming)').count()
  await page.locator('.player-input textarea').fill('Подхожу к стойке')
  await page.locator('.player-input textarea').press('Enter')
  // Пока ответа нет — «Ведущий думает…», отправить следующий ход нельзя.
  await expect(page.getByTestId('master-streaming')).toContainText('Ведущий думает…')
  await page.locator('.player-input textarea').fill('Ещё')
  await expect(page.locator('.player-input > button[type="submit"]')).toBeDisabled()
  release()
  await expect(page.locator('.message--master').last()).toHaveText(/Гуннар поднимает взгляд и кивает\./)
  await expect(page.getByTestId('master-streaming')).toHaveCount(0)
  await expect(page.locator('.message--master:not(.is-streaming)')).toHaveCount(masters + 1)
  const body = api.bodies[0] as { messages: { role: string; content: string }[]; max_tokens: number; stream: boolean }
  expect(body.stream).toBe(true)
  expect(body.max_tokens).toBe(800)
  expect(body.messages[0].role).toBe('system')
  expect(body.messages[0].content).toContain('Вечер в «Пьяном грифоне»')
  expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'Подхожу к стойке' })
  expect(errors).toEqual([])
})

test('ошибки хода: нет денег на счёте — понятное сообщение и «Повторить»; лимит — автоматический повтор', async ({ page }) => {
  await withKey(page)
  const replies: ((route: Route) => Promise<void>)[] = [
    (route) => fulfillJson(route, 402, { error: { message: 'Insufficient Balance', type: 'unknown_error' } }),
    (route) => fulfillJson(route, 429, { error: { message: 'Rate limit reached' } }, { 'retry-after': '1' }),
    (route) => fulfillSse(route, textStream(['Тобиас ', 'исчезает в толпе.'])),
  ]
  await mockApi(page, DEEPSEEK, (_, route) => replies.shift()!(route))
  await page.goto('./')
  await startQuickGame(page)
  await page.locator('.player-input textarea').fill('Иду за человеком в капюшоне')
  await page.locator('.player-input textarea').press('Enter')
  const error = page.getByTestId('master-error')
  await expect(error).toContainText('закончились деньги')
  await expect(error.getByRole('button', { name: 'Повторить' })).toBeEnabled()

  await error.getByRole('button', { name: 'Повторить' }).click()
  // Retry-After из чужого домена браузер не показывает (CORS) — пауза по умолчанию, 2 с.
  await expect(page.getByTestId('master-notice')).toContainText(/Превышен лимит запросов — повторяю через \d+ с/)
  await expect(page.locator('.message--master').last()).toHaveText(/Тобиас исчезает в толпе\./)
  await expect(page.getByTestId('master-error')).toHaveCount(0)
  await expect(page.getByTestId('master-notice')).toHaveCount(0)
  // Сообщение игрока одно — повтор не дублирует ход.
  await expect(page.locator('.message--player', { hasText: 'Иду за человеком в капюшоне' })).toHaveCount(1)
})

test('нет сети — понятное сообщение', async ({ page }) => {
  await withKey(page)
  await page.route(DEEPSEEK, (route) => route.abort('internetdisconnected'))
  await page.goto('./')
  await startQuickGame(page)
  await page.locator('.player-input textarea').fill('Привет')
  await page.locator('.player-input textarea').press('Enter')
  await expect(page.getByTestId('master-error')).toContainText('Не удалось связаться с адресом API: нет сети')
})

test.describe('телефон', () => {
  test.skip(({ isMobile }) => !isMobile, 'только для телефона')

  test('вкладка «Ведущий» в шторке — без горизонтальной прокрутки', async ({ page }, testInfo) => {
    await withKey(page)
    await mockApi(page, DEEPSEEK, healthy)
    await page.goto('./')
    const panel = await openMasterTab(page)
    await panel.getByTestId('provider-custom').click()
    await panel.getByTestId('provider-deepseek').click()
    await panel.getByTestId('check-connection').click()
    await expect(panel.getByTestId('check-tools')).toHaveAttribute('data-status', 'ok')
    await expectNoHorizontalScroll(page)
    expect(await panel.locator('.appearance-body').evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)
    await testInfo.attach('телефон: настройки ведущего', { body: await page.screenshot(), contentType: 'image/png' })
  })
})
