// Видимость на карте: туман войны (неисследованное закрыто, исследованное, но не видимое — затемнено, НПС там не
// видны), исследованное сохраняется, переключатель в панели оформления показывает всю карту.
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { act, collectPageErrors, expectNoHorizontalScroll, flushSaves, MASTER, reloadAndContinue, startQuickGame } from './helpers'

const LOC = 'drunken-griffin'
const npc = (page: Page, id: string) => page.getByTestId(`npc-${id}`)

test('туман войны: кладовая скрыта, открытая дверь открывает вид, закрытая — затемняет; переключатель показывает всё', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page)
  await page.goto('./')
  await startQuickGame(page)
  // Кладовая за запертой дверью не исследована: туман и ни сундука, ни того, кто там стоит.
  await expect(page.getByTestId('fog-hidden')).toHaveCount(1)
  await expect(page.getByTestId('object-storage-chest')).toHaveCount(0)
  await act(page, { type: 'npcAdded', locationId: LOC, npc: { id: 'rat-catcher', name: 'Крысолов', x: 17, y: 3 } }, MASTER)
  await expect(npc(page, 'rat-catcher')).toHaveCount(0)
  await expect(npc(page, 'gunnar')).toBeVisible()
  await testInfo.attach('туман войны', { body: await page.locator('.map-board').screenshot(), contentType: 'image/png' })

  // Дверь открыли, герой подошёл к ней — кладовую видно, Крысолов на виду.
  await act(page, { type: 'doorChanged', locationId: LOC, doorId: 'storage-door', state: 'open' }, MASTER)
  await act(page, { type: 'heroMoved', heroId: 'ratibor', to: { x: 14, y: 1 } }, { kind: 'engine' })
  await expect(npc(page, 'rat-catcher')).toHaveCount(1)
  await expect(page.getByTestId('object-storage-chest')).toHaveCount(1)

  // Дверь закрыли — кладовая исследована, но не видна: затемнена, Крысолова не видно, сундук остался (обстановку помним).
  await act(page, { type: 'doorChanged', locationId: LOC, doorId: 'storage-door', state: 'closed' }, MASTER)
  await expect(npc(page, 'rat-catcher')).toHaveCount(0)
  await expect(page.getByTestId('fog-dimmed')).toHaveCount(1)
  await expect(page.getByTestId('object-storage-chest')).toHaveCount(1)

  // Исследованное — в истории: после перезагрузки сундук на карте, кладовая затемнена.
  await flushSaves(page)
  await reloadAndContinue(page)
  await expect(page.getByTestId('object-storage-chest')).toHaveCount(1)
  await expect(page.getByTestId('fog-dimmed')).toHaveCount(1)

  // Переключатель в панели оформления: вся карта, все НПС.
  await page.getByTestId('settings-open').click()
  const panel = page.getByTestId('settings-panel')
  await expect(panel.getByTestId('fog-of-war')).toBeChecked()
  await panel.getByTestId('fog-of-war').uncheck()
  await expect(page.locator('html')).toHaveAttribute('data-fog', 'off')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('map-fog')).toHaveCount(0)
  await expect(npc(page, 'rat-catcher')).toHaveCount(1)
  await expectNoHorizontalScroll(page)
  expect(errors).toEqual([])
})

test('магическая тьма: НПС в ней не видны (и тёмное зрение не помогает), убрали тьму — видны', async ({ page }) => {
  await page.goto('./')
  await startQuickGame(page)
  // Магическая тьма над залом у камина: Брама и Лиару за ней не видно.
  await act(page, { type: 'effectAdded', locationId: LOC, effect: { id: 'fx-dark', kind: 'darkness', x: 0, y: 6, w: 4, h: 4 } }, MASTER)
  await expect(npc(page, 'bram')).toHaveCount(0)
  await expect(npc(page, 'liara')).toHaveCount(0)
  await expect(npc(page, 'tobias')).toBeVisible()
  await act(page, { type: 'effectRemoved', locationId: LOC, effectId: 'fx-dark' }, MASTER)
  await expect(npc(page, 'bram')).toBeVisible()
})
