// Отдых: кнопка у поля ввода, короткий отдых с костями хитов, долгий — восстановление ячеек; ведущий (подменённый ИИ)
// прерывает отдых — ничего не восстанавливается. На телефоне — без горизонтальной прокрутки.
import type { Page, Route } from '@playwright/test'
import { expect, test } from './fixtures'
import { act, addHeroCopy, collectPageErrors, expectNoHorizontalScroll, face, installRngQueue, MASTER, queueRolls, startQuickGame } from './helpers'

type Store = {
  getState(): { active: { party: { heroId: string }[] } | null; roster: { heroes: { id: string; sheet: { character: Record<string, unknown> } }[] } }
  importRecords(r: unknown): Promise<void>
  flush(): Promise<void>
}

async function openSheet(page: Page) {
  const toggle = page.locator('.inventory-toggle')
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
}

const heroId = (page: Page) => page.evaluate(() => (window as unknown as { __aiMaster: Store }).__aiMaster.getState().active!.party[0].heroId)
const changes = (page: Page) => page.getByTestId('turn-changes').last()

test('короткий отдых без ведущего: кость хитов бросает движок, «Второе дыхание» возвращается; долгий — всё', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page)
  await installRngQueue(page)
  await page.goto('./')
  await startQuickGame(page)
  const id = await heroId(page)
  // Трудный день: ранен, оба «Вторых дыхания» потрачены.
  await act(page, { type: 'hpChanged', heroId: id, kind: 'damage', amount: 9 }, MASTER)
  await act(page, { type: 'featureUsed', heroId: id, featureId: 'second-wind' }, MASTER)
  await act(page, { type: 'featureUsed', heroId: id, featureId: 'second-wind' }, MASTER)
  await openSheet(page)
  await page.getByRole('tab', { name: 'Характеристики' }).click()
  await expect(page.getByRole('img', { name: 'Кости хитов: осталось 1 из 1' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Второе дыхание: осталось 0 из 2' })).toBeVisible()

  await page.getByTestId('rest-button').click()
  const dialog = page.getByTestId('rest-dialog')
  await expect(dialog.getByRole('radio', { name: 'Короткий отдых (1 час)' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('rest-hit-dice')).toHaveValue('1')
  await expectNoHorizontalScroll(page)
  await testInfo.attach('окно отдыха', { body: await page.screenshot(), contentType: 'image/png' })
  // Кость хитов к10: выпадет 6, +2 ТЕЛ.
  await queueRolls(page, [face(6, 10)])
  await dialog.getByRole('button', { name: 'Отдыхать' }).click()
  await expect(page.locator('.message--player').last()).toContainText('Отдыхаем: короткий отдых (1 час), трачу костей хитов: 1.')
  await expect(changes(page)).toHaveText('+8 хитов−1 кость хитов+1 применение («Второе дыхание»)')
  await expect(page.getByTestId('hp-value')).toHaveText('11')
  await expect(page.getByRole('img', { name: 'Кости хитов: осталось 0 из 1' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Второе дыхание: осталось 1 из 2' })).toBeVisible()

  // Долгий отдых: все хиты, кость хитов, умения.
  await page.getByTestId('rest-button').click()
  await dialog.getByRole('radio', { name: 'Долгий отдых (8 часов)' }).click()
  await expect(page.getByTestId('rest-hit-dice')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Отдыхать' }).click()
  await expect(changes(page)).toHaveText('+1 хит+1 кость хитов+1 применение («Второе дыхание»)')
  await expect(page.locator('.message--system').filter({ hasText: 'Долгий отдых (8 часов) окончен.' })).toHaveCount(1)
  await expect(page.getByRole('img', { name: 'Второе дыхание: осталось 2 из 2' })).toBeVisible()
  await expectNoHorizontalScroll(page)
  expect(errors).toEqual([])
})

test('долгий отдых восстанавливает ячейки заклинаний', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.goto('./')
  await startQuickGame(page)
  // Волшебница из «Моих героев» (копия Ратибора с классом и заклинаниями).
  await addHeroCopy(page, { id: 'mage', name: 'Веста' })
  await page.evaluate(async () => {
    const store = (window as unknown as { __aiMaster: Store }).__aiMaster
    const hero = structuredClone(store.getState().roster.heroes.find((h) => h.id === 'mage')!)
    Object.assign(hero.sheet.character, {
      classId: 'wizard',
      className: 'Волшебник',
      feats: [],
      magic: {
        cantrips: ['fire-bolt', 'light', 'mage-hand'],
        spellbook: ['magic-missile', 'shield', 'sleep', 'detect-magic', 'mage-armor', 'identify'],
        prepared: ['magic-missile', 'shield', 'sleep', 'mage-armor'],
        slotsUsed: {},
      },
    })
    await store.importRecords({ heroes: [hero] })
    await store.flush()
  })
  await page.reload()
  await page.getByTestId('menu-heroes').click()
  await page.getByTestId('hero-mage').getByRole('button', { name: 'Начать историю' }).click()
  await page.getByRole('button', { name: 'Начать историю' }).click()
  await expect(page.locator('.dice-tray-button')).toBeVisible()

  for (let i = 0; i < 2; i++) await act(page, { type: 'spellCast', heroId: 'mage', spellId: 'magic-missile', slotLevel: 1, freeKey: null, ritual: false }, MASTER)
  await openSheet(page)
  await page.getByRole('tab', { name: 'Магия' }).click()
  await expect(page.getByRole('img', { name: 'Ячейки 1-го круга: осталось 0 из 2' })).toBeVisible()

  await page.getByTestId('rest-button').click()
  await page.getByTestId('rest-dialog').getByRole('radio', { name: 'Долгий отдых (8 часов)' }).click()
  await page.getByTestId('rest-dialog').getByRole('button', { name: 'Отдыхать' }).click()
  await expect(changes(page)).toHaveText('+2 ячейки 1-го круга')
  await expect(page.getByRole('img', { name: 'Ячейки 1-го круга: осталось 2 из 2' })).toBeVisible()
  expect(errors).toEqual([])
})

// ---------- С ведущим (подменённый API) ----------

const KEY = 'sk-e2e-fake-key-123456'
const DEEPSEEK = 'https://api.deepseek.com/chat/completions'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'POST' }
type Call = [name: string, args: unknown]
const sse = (events: unknown[]) => events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('')
const reply = (text: string, calls: Call[] = []) =>
  sse([
    ...(text ? [{ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }] : []),
    ...calls.map(([name, args], index) => ({
      choices: [{ index: 0, delta: { tool_calls: [{ index, id: `c${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: null }],
    })),
    { choices: [{ index: 0, delta: {}, finish_reason: calls.length ? 'tool_calls' : 'stop' }] },
    '[DONE]',
  ])

async function mockApi(page: Page, replies: string[]) {
  const bodies: { messages: { role: string; content: string | null }[] }[] = []
  await page.route(DEEPSEEK, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    bodies.push(route.request().postDataJSON())
    await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: replies.shift() ?? reply('…', [['end_turn', { changes: [] }]]) })
  })
  return bodies
}

test.describe('с ведущим', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem('ai-master:api-key', key), KEY)
  })

  test('ведущий прерывает отдых: ничего не восстановлено, строки изменений нет', async ({ page }) => {
    const errors = collectPageErrors(page)
    const bodies = await mockApi(page, [
      reply('Едва ты устраиваешься у камина, дверь таверны с грохотом распахивается — на пороге стража.', [
        ['interrupt_rest', { reason: 'в таверну ворвалась стража' }],
        ['end_turn', { changes: [] }],
      ]),
    ])
    await page.goto('./')
    await startQuickGame(page)
    const id = await heroId(page)
    await act(page, { type: 'hpChanged', heroId: id, kind: 'damage', amount: 5 }, MASTER)
    await page.getByTestId('rest-button').click()
    await page.getByTestId('rest-dialog').getByRole('radio', { name: 'Долгий отдых (8 часов)' }).click()
    await page.getByTestId('rest-dialog').getByRole('button', { name: 'Отдыхать' }).click()

    await expect(page.locator('.message--system').filter({ hasText: 'Отдых прерван: в таверну ворвалась стража' })).toHaveCount(1)
    await expect(page.locator('.message--master').last()).toContainText('на пороге стража')
    // Ведущий видел просьбу об отдыхе в состоянии игры.
    expect(JSON.stringify(bodies[0].messages)).toContain('Игрок просит: долгий отдых (8 часов)')
    await openSheet(page)
    await expect(page.getByTestId('hp-value')).toHaveText('7')
    await expect(page.getByTestId('turn-changes')).toHaveCount(0)
    await expect(page.getByTestId('rest-button')).toBeEnabled()
    expect(errors).toEqual([])
  })

  test('ведущий разрешает отдых инструментом rest — хиты восстановлены', async ({ page }) => {
    await mockApi(page, [reply('Ты засыпаешь в тёплой комнате над залом.', [['rest', { kind: 'long' }], ['end_turn', { changes: [{ kind: 'hp', amount: 5 }] }]])])
    await page.goto('./')
    await startQuickGame(page)
    const id = await heroId(page)
    await act(page, { type: 'hpChanged', heroId: id, kind: 'damage', amount: 5 }, MASTER)
    await page.getByTestId('rest-button').click()
    await page.getByTestId('rest-dialog').getByRole('radio', { name: 'Долгий отдых (8 часов)' }).click()
    await page.getByTestId('rest-dialog').getByRole('button', { name: 'Отдыхать' }).click()
    await expect(changes(page)).toHaveText('+5 хитов')
    await openSheet(page)
    await expect(page.getByTestId('hp-value')).toHaveText('12')
  })
})
