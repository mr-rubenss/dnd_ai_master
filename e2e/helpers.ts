// Общие помощники e2e-тестов.
import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Подменяет crypto.getRandomValues: пока в очереди window.__rngQueue есть значения [0, 1),
 * движок кубиков получает их, затем — настоящий генератор. Так броски становятся предсказуемыми.
 */
export async function installRngQueue(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __rngQueue: number[] }
    w.__rngQueue = []
    const original = crypto.getRandomValues.bind(crypto)
    crypto.getRandomValues = (<T extends ArrayBufferView | null>(array: T): T => {
      if (array instanceof Uint32Array && array.length === 1 && w.__rngQueue.length > 0) {
        array[0] = Math.floor(w.__rngQueue.shift()! * 2 ** 32)
        return array
      }
      return original(array as never) as T
    }) as typeof crypto.getRandomValues
  })
}

/** Значение генератора, при котором на кубике с `sides` гранями выпадет `face`. */
export const face = (value: number, sides: number) => (value - 0.5) / sides

/** Задаёт, что выпадет на следующих кубиках. */
export async function queueRolls(page: Page, values: number[]) {
  await page.evaluate((v) => {
    ;(window as unknown as { __rngQueue: number[] }).__rngQueue = v
  }, values)
}

/** Есть ли у страницы горизонтальная прокрутка. */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, 'горизонтальная прокрутка страницы').toBeLessThanOrEqual(0)
}

/** Ждёт анимацию броска и проверяет, что кубик показан по центру экрана. */
export async function expectRollOverlayCentered(page: Page) {
  const die = page.locator('.dice-overlay-die')
  await expect(die).toBeVisible()
  // Дожидаемся конца «подлёта» кубика, чтобы мерить устоявшееся положение.
  await expect(page.locator('.dice-overlay.is-settled')).toBeVisible()
  const box = (await die.boundingBox())!
  const viewport = page.viewportSize()!
  const centerX = box.x + box.width / 2
  const centerY = box.y + box.height / 2
  expect(Math.abs(centerX - viewport.width / 2)).toBeLessThan(4)
  // Центр группы «кубик + подпись» — в центре экрана, сам кубик чуть выше.
  expect(centerY).toBeLessThan(viewport.height / 2)
  expect(centerY).toBeGreaterThan(viewport.height * 0.3)
}

/** Ждёт, пока анимация броска исчезнет. */
export async function waitRollOverlayGone(page: Page) {
  await expect(page.locator('.dice-overlay')).toHaveCount(0, { timeout: 6000 })
}

/** Свайп по элементу: touchstart → несколько touchmove → touchend. */
export async function swipeDown(target: Locator, distance: number) {
  await target.evaluate((el, dy) => {
    const rect = el.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const touch = (clientY: number) => new Touch({ identifier: 1, target: el, clientX: x, clientY })
    const fire = (type: string, clientY: number, active: boolean) =>
      el.dispatchEvent(
        new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          touches: active ? [touch(clientY)] : [],
          changedTouches: [touch(clientY)],
        }),
      )
    fire('touchstart', y, true)
    for (let i = 1; i <= 5; i++) fire('touchmove', y + (dy * i) / 5, true)
    fire('touchend', y + dy, false)
  }, distance)
}

/** Собирает необработанные ошибки страницы, чтобы в конце теста проверить, что их нет. */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

/** Начинает игру за готового персонажа (Ратибор) со стартового экрана (сохранения ещё нет). */
export async function startQuickGame(page: Page) {
  await page.getByTestId('menu-quick-start').click()
  await expect(page.locator('.dice-tray-button')).toBeVisible()
}

/** Открывает создание персонажа со стартового экрана (сохранения ещё нет). */
export async function openCharacterCreation(page: Page) {
  await page.getByTestId('menu-create').click()
  await expect(page.getByRole('heading', { name: 'Создание персонажа' })).toBeVisible()
}

/** После перезагрузки — стартовый экран: продолжает сохранённую игру. */
export async function continueGame(page: Page) {
  await page.getByTestId('menu-continue').click()
  await expect(page.locator('.dice-tray-button')).toBeVisible()
}

/** Автор действия истории — как в src/types/story.ts. */
export type ActionAuthor = { kind: 'player'; heroId: string } | { kind: 'engine' } | { kind: 'master' } | { kind: 'system' }

interface DebugStore {
  dispatch(event: unknown, author: ActionAuthor): string | null
  flush(): Promise<void>
  getState(): {
    active: { id: string; party: { heroId: string; character: unknown; inventory: { equipped: unknown } }[] } | null
    roster: { heroes: { id: string; sheet: { character: Record<string, unknown> } }[] }
  }
  importRecords(records: { heroes?: unknown[]; hall?: unknown[] }): Promise<void>
  createStory(request: { title: string; tone: string; adventureId: string; heroIds: string[] }): Promise<string | null>
}

/** Действие в открытой истории — как его совершили бы ведущий, движок или игрок. */
export async function act(page: Page, event: Record<string, unknown>, author: ActionAuthor) {
  const reason = await page.evaluate(
    ([e, a]) => (window as unknown as { __aiMaster: DebugStore }).__aiMaster.dispatch(e, a as ActionAuthor),
    [event, author] as const,
  )
  expect(reason, 'действие отклонено').toBeNull()
}

export const MASTER: ActionAuthor = { kind: 'master' }
export const ENGINE: ActionAuthor = { kind: 'engine' }

/** Дождаться записи всех изменений в IndexedDB (перед перезагрузкой). */
export async function flushSaves(page: Page) {
  await page.evaluate(() => (window as unknown as { __aiMaster: DebugStore }).__aiMaster.flush())
}

/** Перезагрузить страницу и продолжить последнюю историю. */
export async function reloadAndContinue(page: Page) {
  await flushSaves(page)
  await page.reload()
  await continueGame(page)
}

/** Экипировка героя открытой истории — из состояния игры. */
export async function equippedOfLead(page: Page) {
  return page.evaluate(() => (window as unknown as { __aiMaster: DebugStore }).__aiMaster.getState().active?.party[0].inventory.equipped)
}

/**
 * Добавляет в «Мои герои» копию первого героя (Ратибора) с другим id и именем и, если нужно,
 * другим владением доспехами. Нужен уже начатый быстрый старт.
 */
export async function addHeroCopy(page: Page, copy: { id: string; name: string; armor?: string[] }) {
  await page.evaluate(async (c) => {
    const store = (window as unknown as { __aiMaster: DebugStore }).__aiMaster
    const hero = structuredClone(store.getState().roster.heroes[0]) as unknown as {
      id: string
      storyId: string | null
      createdAt: number
      sheet: { character: Record<string, unknown> & { proficiencies: Record<string, unknown> } }
    }
    hero.id = c.id
    hero.storyId = null
    hero.createdAt = Date.now()
    hero.sheet.character.id = c.id
    hero.sheet.character.name = c.name
    if (c.armor) hero.sheet.character.proficiencies.armor = c.armor
    await store.importRecords({ heroes: [hero] })
    await store.flush()
  }, copy)
}

/**
 * Ответ ведущего в подменённом API заканчивается служебным end_turn (как требует промт): если запрос предлагает
 * инструмент end_turn, а в потоке нет своих вызовов инструментов, перед [DONE] добавляется end_turn с пустым списком
 * (или с переданными изменениями).
 */
export function withEndTurn(route: { request(): { postDataJSON(): unknown } }, payload: string, changes: unknown[] = []): string {
  const body = route.request().postDataJSON() as { tools?: { function: { name: string } }[] } | null
  if (!body?.tools?.some((t) => t.function.name === 'end_turn') || payload.includes('"tool_calls"')) return payload
  const call = {
    choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'end', type: 'function', function: { name: 'end_turn', arguments: JSON.stringify({ changes }) } }] }, finish_reason: null }],
  }
  return payload.includes('data: [DONE]') ? payload.replace('data: [DONE]', `data: ${JSON.stringify(call)}\n\ndata: [DONE]`) : `${payload}data: ${JSON.stringify(call)}\n\n`
}

/**
 * Шаг «Заклинания» при создании: в каждом списке выбрать первые доступные заклинания в нужном количестве
 * (список «Посвящённого в магию», если он на выбор, — волшебник).
 */
export async function fillSpellStep(page: Page) {
  const list = page.getByTestId('initiate-list')
  if ((await list.count()) > 0 && (await list.isEnabled()) && !(await list.inputValue())) await list.selectOption('wizard')
  const slots = page.locator('.spell-choice [data-slot]')
  for (let i = 0; i < (await slots.count()); i++) {
    const slot = slots.nth(i)
    const [chosen, total] = ((await slot.locator('.slot-count').textContent()) ?? '0 из 0').split(' из ').map(Number)
    for (let k = chosen; k < total; k++) await slot.locator('.spell-option-toggle[aria-checked="false"]:not([disabled])').first().click()
  }
}
