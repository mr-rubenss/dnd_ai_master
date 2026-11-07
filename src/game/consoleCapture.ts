// Ошибки консоли для тестового отчёта: console.error/console.warn, необработанные исключения и отклонённые
// промисы — последние CONSOLE_LIMIT записей, только в памяти вкладки. О сбое (исключение, отклонённый промис)
// сообщает подписчикам — игра предлагает составить отчёт. Ключ из текстов убирается при сборке отчёта.

export interface ConsoleEntry {
  at: number
  level: 'error' | 'warn' | 'exception' | 'rejection'
  text: string
}

export const CONSOLE_LIMIT = 50
/** Длина одной записи (стек целиком не нужен). */
export const CONSOLE_ENTRY_CHARS = 2000

/** Текст аргумента консоли: ошибка — имя, сообщение и начало стека; объект — JSON. */
export function describe(value: unknown): string {
  if (value instanceof Error) return [`${value.name}: ${value.message}`, value.stack?.split('\n').slice(1, 6).join('\n')].filter(Boolean).join('\n')
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

export function createConsoleCapture(now: () => number = Date.now) {
  let entries: ConsoleEntry[] = []
  const crashListeners = new Set<(entry: ConsoleEntry) => void>()

  const capture = {
    get: () => entries,
    clear() {
      entries = []
    },
    add(level: ConsoleEntry['level'], parts: unknown[]) {
      const text = parts.map(describe).join(' ').slice(0, CONSOLE_ENTRY_CHARS)
      const entry = { at: now(), level, text }
      entries = [...entries, entry].slice(-CONSOLE_LIMIT)
      if (level === 'exception' || level === 'rejection') crashListeners.forEach((l) => l(entry))
    },
    /** Сбой (необработанное исключение) — для предложения составить отчёт. */
    onCrash(listener: (entry: ConsoleEntry) => void) {
      crashListeners.add(listener)
      return () => crashListeners.delete(listener)
    },
    /** Перехватить консоль и необработанные ошибки окна (один раз, при запуске). */
    install(target: Window & typeof globalThis = window) {
      const original = { error: target.console.error.bind(target.console), warn: target.console.warn.bind(target.console) }
      target.console.error = (...args: unknown[]) => {
        capture.add('error', args)
        original.error(...args)
      }
      target.console.warn = (...args: unknown[]) => {
        capture.add('warn', args)
        original.warn(...args)
      }
      target.addEventListener('error', (event) => capture.add('exception', [event.error ?? event.message]))
      target.addEventListener('unhandledrejection', (event) => capture.add('rejection', [event.reason]))
    },
  }
  return capture
}

export type ConsoleCapture = ReturnType<typeof createConsoleCapture>

export const consoleCapture = createConsoleCapture()
