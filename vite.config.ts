/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { appearanceBootData } from './src/theme/appearance.ts'
import { bootAppearance } from './src/theme/boot.ts'
import { themeCss } from './src/theme/css.ts'
import { darkFantasy } from './src/theme/darkFantasy.ts'
import { DESIGN_THEMES_DIR, loadDesignThemes } from './src/theme/designThemes.ts'
import { parseTheme } from './src/theme/schema.ts'

// GitHub Pages публикует сайт по адресу https://<user>.github.io/<repo>/,
// поэтому base должен совпадать с именем репозитория.
const REPO_NAME = 'dnd_ai_master'

/** Читает темы дизайнера из design/themes/ и проверяет их; ошибка останавливает сборку. */
function readDesignThemes() {
  const dir = resolve(import.meta.dirname, DESIGN_THEMES_DIR)
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }))
    : []
  return { dir, themes: loadDesignThemes(files, [darkFantasy.id]) }
}

const VIRTUAL_THEMES = 'virtual:design-themes'

/**
 * Скрипт в <head>: применяет сохранённые настройки оформления (тема, акцент, шрифт, размер, плотность…)
 * до первой отрисовки — без вспышки темы по умолчанию. Тот же код (`bootAppearance`) работает и в приложении.
 */
function bootScript() {
  const data = JSON.stringify(appearanceBootData([darkFantasy, ...readDesignThemes().themes])).replace(/</g, '\\u003c')
  const env = `{ root: document.documentElement, storage: (function () { try { return localStorage } catch (e) { return null } })(), search: location.search, reducedMotion: !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) }`
  return `try { (${bootAppearance.toString()})(${data}, ${env}) } catch (e) {}`
}

/**
 * Темы оформления.
 * - Тема по умолчанию встраивается в index.html как `<style>` с CSS-переменными: стили получают токены
 *   до загрузки скриптов, без мигания.
 * - Темы дизайнера (design/themes/*.json) проверяются `parseTheme` и попадают в реестр через виртуальный модуль
 *   `virtual:design-themes` (уже проверенные — zod в браузер не идёт). Некорректный файл ломает сборку.
 */
function themePlugin(): Plugin {
  const resolved = `\0${VIRTUAL_THEMES}`
  return {
    name: 'ai-master-theme',
    buildStart() {
      const { dir } = readDesignThemes()
      if (existsSync(dir)) this.addWatchFile(dir)
    },
    resolveId: (id) => (id === VIRTUAL_THEMES ? resolved : undefined),
    load(id) {
      if (id !== resolved) return
      const { dir, themes } = readDesignThemes()
      if (existsSync(dir)) for (const name of readdirSync(dir)) this.addWatchFile(join(dir, name))
      return `export default ${JSON.stringify(themes)}`
    },
    transformIndexHtml: () => [
      { tag: 'style', attrs: { id: 'theme' }, children: themeCss(parseTheme(darkFantasy)), injectTo: 'head-prepend' },
      { tag: 'script', attrs: { id: 'appearance-boot' }, children: bootScript(), injectTo: 'head-prepend' },
    ],
  }
}

/** Версия игры для тестового отчёта: номер из package.json, коммит сборки и дата. */
function appVersion(): string {
  const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string }
  let commit = 'без git'
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: import.meta.dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    // Сборка вне репозитория — без коммита.
  }
  return `${pkg.version} (${commit}, сборка ${new Date().toISOString().slice(0, 10)})`
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react(), themePlugin()],
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  base: command === 'build' ? `/${REPO_NAME}/` : '/',
  test: {
    // Модульные тесты — только в src/; e2e-тесты (e2e/*.spec.ts) запускает Playwright.
    include: ['src/**/*.test.ts'],
    // Стили нужны тестам темы как текст (import.meta.glob с ?raw): без `css: true` Vitest отдаёт CSS пустым.
    css: true,
  },
}))
