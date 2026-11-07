// Сбор тестового отчёта из хранилищ игры: история и её журнал действий, записи ходов вкладки, ошибки консоли,
// настройки ведущего (ключ — только чтобы вычистить его из текста). Сам отчёт — src/game/testReport.ts.
import { useEffect } from 'react'
import { aiSettingsStore } from '../ai/settingsStore'
import { itemCatalog } from '../data'
import { appStore } from '../hooks/useGame'
import { consoleCapture } from '../game/consoleCapture'
import { DM_PROMPT } from '../game/masterPrompt'
import { buildTestReport, textVersion, type DeviceInfo } from '../game/testReport'
import { traceStore } from '../game/turnTrace'
import { reportStore } from './reportStore'

export const APP_VERSION = __APP_VERSION__

function deviceInfo(): DeviceInfo {
  const nav = window.navigator
  return {
    userAgent: nav.userAgent,
    platform: (nav as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || nav.platform || '',
    language: nav.language,
    screen: `${window.screen.width}×${window.screen.height}`,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    pixelRatio: window.devicePixelRatio,
    touch: nav.maxTouchPoints > 0,
  }
}

/** Собрать отчёт по истории (открытой или последней). */
export async function collectReport(description: string, storyId: string | null): Promise<string> {
  const story = storyId ? await appStore.readStory(storyId) : null
  const actions = story ? await appStore.readActions(story.id) : []
  const ai = aiSettingsStore.get()
  return buildTestReport({
    now: Date.now(),
    version: APP_VERSION,
    prompt: { version: textVersion(DM_PROMPT), chars: DM_PROMPT.length },
    device: deviceInfo(),
    description,
    story,
    actions,
    traces: story ? traceStore.of(story.id) : [],
    consoleErrors: consoleCapture.get(),
    settings: ai.settings,
    apiKey: ai.apiKey,
    catalog: itemCatalog,
  })
}

/** Подписка на сбои: необработанное исключение или отклонённый промис — предложить отчёт. */
export function useCrashOffer() {
  useEffect(() => {
    const off = consoleCapture.onCrash((entry) => reportStore.offer(entry.text.split('\n')[0].slice(0, 200)))
    return () => {
      off()
    }
  }, [])
}
