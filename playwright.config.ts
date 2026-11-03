import { defineConfig, devices } from '@playwright/test'

const PORT = 4173
const CI = Boolean(process.env.CI)

// E2E-тесты проверяют собранный сайт (dist/) — тот же, что публикуется на GitHub Pages.
// Перед запуском нужна сборка: `npm run build`, затем `npm run test:e2e`.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}/dnd_ai_master/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      // Локальные запросы — мимо системного прокси (в облачных окружениях он может перехватывать localhost).
      args: ['--no-proxy-server'],
    },
  },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    // Размеры и сенсорный ввод iPhone 13, но движок Chromium (он же установлен в CI).
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
  webServer: {
    command: 'node e2e/serve.mjs',
    url: `http://127.0.0.1:${PORT}/dnd_ai_master/`,
    reuseExistingServer: !CI,
    env: { PORT: String(PORT) },
  },
})
