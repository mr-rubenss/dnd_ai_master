// Общие фикстуры e2e. Импортируйте `test` и `expect` отсюда, а не из @playwright/test.
import { test as base } from '@playwright/test'

export { expect } from '@playwright/test'

/**
 * На телефоне подставляем широкий шрифт интерфейса (DejaVu Sans / Verdana), как в CI и на многих
 * Android-устройствах: узкий системный шрифт разработчика скрывает переполнение по ширине.
 */
const WIDE_FONT_CSS = `:root { --font-ui: 'DejaVu Sans', Verdana, 'Liberation Sans', sans-serif !important; }`

export const test = base.extend({
  // Параметр назван provide (а не use), чтобы линтер не путал его с React-хуком.
  page: async ({ page, isMobile }, provide) => {
    // Отладочный доступ к хранилищу (window.__aiMaster): тесты отправляют действия как ведущий или движок.
    await page.addInitScript(() => localStorage.setItem('ai-master:debug', '1'))
    if (isMobile) {
      await page.addInitScript((css) => {
        const inject = () => {
          const style = document.createElement('style')
          style.dataset.e2e = 'wide-font'
          style.textContent = css
          document.head.appendChild(style)
        }
        if (document.head) inject()
        else document.addEventListener('DOMContentLoaded', inject, { once: true })
      }, WIDE_FONT_CSS)
    }
    await provide(page)
  },
})
