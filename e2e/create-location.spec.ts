// Ведущий создаёт новую локацию (create_location): ошибочный JSON — модель получает ошибки списком и исправляет,
// верный — локация сохраняется в мире истории и переживает перезагрузку. Ответы ИИ подменены (page.route).
import type { Page, Route } from '@playwright/test'
import { expect, test } from './fixtures'
import { collectPageErrors, reloadAndContinue, startQuickGame, withEndTurn } from './helpers'

const KEY = 'sk-e2e-fake-key-create-location'
const API = 'https://api.deepseek.com/chat/completions'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'POST' }
const sse = (events: unknown[]) => events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('')
const delta = (d: Record<string, unknown>, finish: string | null = null) => ({ choices: [{ index: 0, delta: d, finish_reason: finish }] })
const tool = (name: string, args: unknown) =>
  sse([delta({ tool_calls: [{ index: 0, id: `c-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }), delta({}, 'tool_calls'), '[DONE]'])
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

const street = {
  id: 'griffin-street',
  name: 'Улица у таверны',
  description: 'Грязная улица под фонарём.',
  cellFeet: 5,
  width: 12,
  height: 8,
  floor: 'dirt',
  wallMaterial: 'stone',
  rooms: [{ id: 'street', name: 'Улица', x: 0, y: 0, w: 12, h: 8 }],
  objects: [{ id: 'cart', type: 'debris', name: 'Сломанная телега', x: 3, y: 4, w: 2 }],
  npcs: [{ id: 'beggar', name: 'Нищий', x: 6, y: 6 }],
  exits: [{ id: 'to-tavern', kind: 'road', name: 'Дверь таверны', x: 5, y: 0, to: 'drunken-griffin' }],
  playerStart: { x: 5, y: 1 },
}

const worldLocations = (page: Page) =>
  page.evaluate(() =>
    Object.keys((window as unknown as { __aiMaster: { getState(): { active: { world: { locations: Record<string, unknown> } } } } }).__aiMaster.getState().active.world.locations),
  )

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem('ai-master:api-key', key), KEY)
})

test('ведущий создаёт локацию: ошибки — списком модели, исправленная сохраняется и переживает перезагрузку', async ({ page }) => {
  const errors = collectPageErrors(page)
  const bodies = await mockMaster(page, [
    tool('create_location', { location: { ...street, exits: [], objects: [{ id: 'cart', type: 'debris', name: 'Телега', x: 11, y: 4, w: 2 }] } }),
    tool('create_location', { location: street }),
    say('За дверью — грязная улица под фонарём.'),
  ])
  await page.goto('./')
  await startQuickGame(page)
  expect(await worldLocations(page)).toEqual(['drunken-griffin'])
  await page.locator('.player-input textarea').fill('Оглядываюсь.')
  await page.locator('.player-input textarea').press('Enter')
  await expect(page.locator('.message--master').last()).toContainText('грязная улица под фонарём')

  // Первая попытка отклонена: модель получила ошибки списком.
  const toolResult = (b: Body) => b.messages.filter((m) => m.role === 'tool').map((m) => m.content ?? '').join('\n')
  expect(toolResult(bodies[1])).toContain('Локация не создана, исправь и вызови снова')
  expect(toolResult(bodies[1])).toContain('exits: нужно хотя бы 1')
  expect(toolResult(bodies[2])).toContain('Локация «Улица у таверны» создана')
  expect(await worldLocations(page)).toEqual(['drunken-griffin', 'griffin-street'])

  // Сохранено в истории: после перезагрузки локация на месте, ведущий видит её в «Локациях мира».
  await reloadAndContinue(page)
  expect(await worldLocations(page)).toEqual(['drunken-griffin', 'griffin-street'])
  await page.locator('.player-input textarea').fill('Жду.')
  await page.locator('.player-input textarea').press('Enter')
  await expect(page.locator('.message--master').last()).toContainText('Таверна шумит')
  expect(bodies).toHaveLength(4)
  const system = bodies.at(-1)!.messages.find((m) => m.role === 'system')?.content ?? ''
  expect(system).toContain('«Улица у таверны» [griffin-street]')
  expect(errors).toEqual([])
})
