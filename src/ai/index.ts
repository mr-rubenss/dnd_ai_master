// ИИ-ведущий: точка входа для игры. Игра знает только общий интерфейс (types.ts) и `createMaster`;
// какой формат API и какой адаптер — решают настройки (settings.ts) и реестр ниже.
import { createOpenAiChatMaster } from './adapters/openaiChat.ts'
import { AiError } from './errors.ts'
import type { AiConnection, AiFormat, AiMaster, AiTransport } from './types.ts'

/** Реестр адаптеров: формат API → фабрика. Новый формат — новая строка здесь. */
const ADAPTERS: Record<AiFormat, (connection: AiConnection, transport: AiTransport) => AiMaster> = {
  'openai-chat': createOpenAiChatMaster,
}

export const defaultTransport = (): AiTransport => ({
  fetch: (...args) => globalThis.fetch(...args),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  maxRetries: 3,
})

/** Ведущий для подключения из настроек. Без адреса, модели или ключа — ошибка «Ведущий не настроен». */
export function createMaster(connection: AiConnection, transport: AiTransport = defaultTransport()): AiMaster {
  if (!connection.baseUrl.trim() || !connection.model.trim() || !connection.apiKey.trim()) throw new AiError('not-configured')
  return ADAPTERS[connection.format](connection, transport)
}

export { AiError, aiErrorMessage } from './errors.ts'
export type * from './types.ts'
export { AI_FORMATS } from './types.ts'
