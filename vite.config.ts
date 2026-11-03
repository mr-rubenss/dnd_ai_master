/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages публикует сайт по адресу https://<user>.github.io/<repo>/,
// поэтому base должен совпадать с именем репозитория.
const REPO_NAME = 'dnd_ai_master'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? `/${REPO_NAME}/` : '/',
  test: {
    // Модульные тесты — только в src/; e2e-тесты (e2e/*.spec.ts) запускает Playwright.
    include: ['src/**/*.test.ts'],
  },
}))
