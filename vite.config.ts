/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { themeCss } from './src/theme/css.ts'
import { darkFantasy } from './src/theme/darkFantasy.ts'
import { parseTheme } from './src/theme/schema.ts'

// GitHub Pages публикует сайт по адресу https://<user>.github.io/<repo>/,
// поэтому base должен совпадать с именем репозитория.
const REPO_NAME = 'dnd_ai_master'

/**
 * Тема оформления встраивается в index.html как `<style>` с CSS-переменными: стили получают токены
 * до загрузки скриптов, без мигания. Источник — объект темы в src/theme/ (проверяется схемой).
 */
function themePlugin(): Plugin {
  return {
    name: 'ai-master-theme',
    transformIndexHtml: () => [{ tag: 'style', attrs: { id: 'theme' }, children: themeCss(parseTheme(darkFantasy)), injectTo: 'head-prepend' }],
  }
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react(), themePlugin()],
  base: command === 'build' ? `/${REPO_NAME}/` : '/',
  test: {
    // Модульные тесты — только в src/; e2e-тесты (e2e/*.spec.ts) запускает Playwright.
    include: ['src/**/*.test.ts'],
    // Стили нужны тестам темы как текст (import.meta.glob с ?raw): без `css: true` Vitest отдаёт CSS пустым.
    css: true,
  },
}))
