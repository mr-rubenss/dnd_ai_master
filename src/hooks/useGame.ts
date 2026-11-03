import { useSyncExternalStore } from 'react'
import { appStore } from '../game/appInstance'
import type { AppState } from '../game/appStore'

/** Состояние приложения: истории, герои, открытая история. Компонент перерисовывается при каждом изменении. */
export function useAppState(): AppState {
  return useSyncExternalStore(appStore.subscribe, appStore.getState)
}

export { appStore }
