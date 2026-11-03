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

/** Начинает игру за готового персонажа (Ратибор) с экрана создания. */
export async function startQuickGame(page: Page) {
  await page.getByRole('button', { name: /^Быстрый старт/ }).click()
  await expect(page.locator('.dice-tray-button')).toBeVisible()
}
