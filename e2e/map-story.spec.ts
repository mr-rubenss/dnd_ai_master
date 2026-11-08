// Рассказ ведущего — на карте: новый НПС идёт от входа, ушедший — к выходу; объекты проявляются, тают и сдвигаются;
// эффекты и подсветка ведущего видны; скрытое не видно до раскрытия; «подхожу к стойке» — move_hero ведёт героя по
// пути, запертая дверь — причина ведущему, в бою — сколько хватило скорости. Ответы ИИ подменены (page.route).
import type { Page, Route } from '@playwright/test'
import { expect, test } from './fixtures'
import { act, collectPageErrors, ENGINE, expectNoHorizontalScroll, MASTER, startQuickGame, withEndTurn } from './helpers'

const KEY = 'sk-e2e-fake-key-map-story'
const API = 'https://api.deepseek.com/chat/completions'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'POST' }
const sse = (events: unknown[]) => events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('')
const delta = (d: Record<string, unknown>, finish: string | null = null) => ({ choices: [{ index: 0, delta: d, finish_reason: finish }] })
const tools = (...calls: [string, unknown][]) =>
  sse([delta({ tool_calls: calls.map(([name, args], index) => ({ index, id: `c${index}-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })) }), delta({}, 'tool_calls'), '[DONE]'])
const say = (text: string) => sse([delta({ content: text }, 'stop'), '[DONE]'])
type Body = { messages: { role: string; content: string | null }[] }

async function mockMaster(page: Page, rounds: string[]) {
  const bodies: Body[] = []
  await page.route(API, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    bodies.push(route.request().postDataJSON() as Body)
    await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: withEndTurn(route, rounds.shift() ?? say('Таверна шумит.')) })
  })
  return bodies
}
const npc = (page: Page, id: string) => page.getByTestId(`npc-${id}`)
const send = async (page: Page, text: string) => {
  await page.locator('.player-input textarea').fill(text)
  await page.locator('.player-input textarea').press('Enter')
}

test.describe('без ведущего: изменения на карте анимируются', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('./')
    await startQuickGame(page)
  })

  test('новый НПС идёт от входа, ушедший — к выходу и исчезает', async ({ page }) => {
    const errors = collectPageErrors(page)
    await act(page, { type: 'npcAdded', locationId: 'drunken-griffin', npc: { id: 'guard', name: 'Стражник', x: 6, y: 9 } }, MASTER)
    // Появился у входа (10, 13) и идёт на место.
    await expect(npc(page, 'guard')).toHaveAttribute('data-walking', 'true')
    await expect(npc(page, 'guard')).toHaveAttribute('data-x', '6')
    await expect(npc(page, 'guard')).toHaveAttribute('data-y', '9')
    await expect(npc(page, 'guard')).not.toHaveAttribute('data-walking', 'true')

    await act(page, { type: 'npcRemoved', locationId: 'drunken-griffin', npcId: 'tobias' }, MASTER)
    await expect(npc(page, 'tobias')).toHaveCount(0)
    const leaving = page.getByTestId('npc-leaving-tobias')
    await expect(leaving).toHaveCount(1)
    // Идёт к выходу у входной двери (10, 13): частый опрос — уход длится около секунды.
    await expect.poll(() => leaving.getAttribute('data-x', { timeout: 200 }).catch(() => 'gone'), { intervals: [50] }).toBe('10')
    await expect(leaving).toHaveAttribute('data-y', '13')
    await expect(leaving).toHaveCount(0, { timeout: 8000 })
    expect(errors).toEqual([])
  })

  test('объекты: новый проявляется, сдвинутый переходит плавно, убранный тает', async ({ page }) => {
    await act(page, { type: 'objectAdded', locationId: 'drunken-griffin', object: { id: 'crate', type: 'chest', name: 'Ящик', x: 6, y: 12 } }, MASTER)
    await expect(page.getByTestId('object-crate')).toHaveAttribute('data-fresh', 'true')
    await act(page, { type: 'objectUpdated', locationId: 'drunken-griffin', objectId: 'crate', changes: { x: 7 } }, MASTER)
    await expect(page.getByTestId('object-crate')).toHaveAttribute('data-x', '7')
    await act(page, { type: 'objectRemoved', locationId: 'drunken-griffin', objectId: 'crate' }, MASTER)
    await expect(page.getByTestId('object-crate')).toHaveCount(0)
    await expect(page.getByTestId('object-leaving-crate')).toHaveCount(1)
    await expect(page.getByTestId('object-leaving-crate')).toHaveCount(0, { timeout: 8000 })
  })

  test('эффекты и подсветка ведущего; скрытое не видно, пока не раскрыто', async ({ page }, testInfo) => {
    await expect(npc(page, 'pickpocket')).toHaveCount(0)
    await expect(page.getByTestId('object-hearth-cache')).toHaveCount(0)
    await act(page, { type: 'effectAdded', locationId: 'drunken-griffin', effect: { id: 'fx-fire', kind: 'fire', name: 'Горящая солома', x: 1, y: 9, w: 2, h: 2 } }, MASTER)
    await act(page, { type: 'effectAdded', locationId: 'drunken-griffin', effect: { id: 'fx-smoke', kind: 'smoke', x: 3, y: 9, w: 3, h: 3 } }, MASTER)
    await act(page, { type: 'mapPinged', ping: { id: 'ping-1', locationId: 'drunken-griffin', x: 9, y: 13, w: 2, h: 1, label: 'сюда' } }, MASTER)
    await expect(page.getByTestId('effect-fx-fire')).toHaveAttribute('data-kind', 'fire')
    await expect(page.getByTestId('effect-fx-smoke')).toBeVisible()
    await expect(page.getByTestId('map-ping')).toBeVisible()
    await act(page, { type: 'entityRevealed', locationId: 'drunken-griffin', kind: 'npc', entityId: 'pickpocket' }, ENGINE)
    await act(page, { type: 'entityRevealed', locationId: 'drunken-griffin', kind: 'object', entityId: 'hearth-cache' }, MASTER)
    // Раскрытый появляется на своём месте (а не идёт от входа).
    await expect(npc(page, 'pickpocket')).toHaveAttribute('data-x', '19')
    await expect(npc(page, 'pickpocket')).toHaveAttribute('data-fresh', 'true')
    await expect(page.getByTestId('object-hearth-cache')).toHaveCount(1)
    await testInfo.attach('эффекты, подсветка, раскрытое', { body: await page.locator('.map-board').screenshot(), contentType: 'image/png' })
    await act(page, { type: 'effectRemoved', locationId: 'drunken-griffin', effectId: 'fx-fire' }, MASTER)
    await expect(page.getByTestId('effect-fx-fire')).toHaveCount(0)
    await expect(page.getByTestId('map-ping')).toHaveCount(0, { timeout: 6000 })
    await expectNoHorizontalScroll(page)
  })
})

test.describe('ведущий двигает героя (move_hero)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem('ai-master:api-key', key), KEY)
  })

  test('«подхожу к стойке» — герой идёт к стойке по пути; к запертой кладовой — причина ведущему', async ({ page }) => {
    const errors = collectPageErrors(page)
    const bodies = await mockMaster(page, [
      tools(['move_hero', { target: 'bar' }]),
      say('Ты подходишь к стойке. Гуннар поднимает глаза от кружки.'),
      tools(['move_hero', { target: 'storage-chest' }]),
      say('Дверь в кладовую на висячем замке — без ключа не войти.'),
    ])
    await page.goto('./')
    await startQuickGame(page)
    await send(page, 'Подхожу к стойке.')
    const hero = page.getByTestId('player-token')
    await expect(hero).toHaveAttribute('data-walking', 'true')
    await expect(page.locator('.message--master').last()).toContainText('Гуннар поднимает глаза')
    await expect(hero).not.toHaveAttribute('data-walking', 'true')
    // Рядом со стойкой (клетки 3–11 × 2): строка 1 или 3.
    const y = Number(await hero.getAttribute('data-y'))
    const x = Number(await hero.getAttribute('data-x'))
    expect([1, 3]).toContain(y)
    expect(x).toBeGreaterThanOrEqual(2)
    expect(x).toBeLessThanOrEqual(12)
    const result = JSON.parse(bodies[1].messages.find((m) => m.role === 'tool')?.content ?? '{}')
    expect(result.message).toMatch(/^Ратибор подходит к «Барная стойка»/)

    await send(page, 'Иду к сундуку в кладовой.')
    await expect(page.locator('.message--master').last()).toContainText('на висячем замке')
    const refusal = JSON.parse(bodies[3].messages.filter((m) => m.role === 'tool').at(-1)?.content ?? '{}')
    expect(refusal).toMatchObject({ ok: false, error: expect.stringContaining('путь перекрывает дверь «Дверь в кладовую» — она заперта') })
    await expect(hero).toHaveAttribute('data-x', String(x))
    expect(errors).toEqual([])
  })

  test('в бою: скорости не хватило — герой прошёл, сколько мог, игрок видит строку', async ({ page }) => {
    await mockMaster(page, [tools(['set_combat', { state: 'start' }], ['move_hero', { target: 'barrel-1' }]), say('Ты успеваешь пробежать полпути до бочек.')])
    await page.goto('./')
    await startQuickGame(page)
    await send(page, 'Бегу к бочкам в углу.')
    await expect(page.getByTestId('map-note')).toContainText(/Ратибор: скорости хватило на 30 из \d+ фт\. — до «Бочка эля» ещё \d+ фт\./)
    await expect(page.locator('.message--master').last()).toContainText('полпути')
    await expectNoHorizontalScroll(page)
  })
})
