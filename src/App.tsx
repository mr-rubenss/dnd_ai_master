import { useCallback, useEffect, useRef, useState } from 'react'
import { CharacterCreation } from './components/creation/CharacterCreation'
import { HeroesScreen } from './components/HeroesScreen'
import { StartMenu } from './components/StartMenu'
import { DiceRollOverlay } from './components/DiceRollOverlay'
import { DiceTray } from './components/DiceTray'
import { InventoryPanel } from './components/InventoryPanel'
import { MapPanel } from './components/MapPanel'
import { NarrationLog } from './components/NarrationLog'
import { PlayerInput } from './components/PlayerInput'
import { itemCatalog, locations, startingSheet } from './data'
import { DiceError, roll, type RollMode } from './engine/dice'
import { changeEquipment, diceRolled, messageAdded, type EquipmentChange } from './game/state'
import { deleteHero } from './game/heroes'
import { endStory, quickStart, renameEverywhere, saveHero, startStory } from './game/session'
import { gameStore, heroStore, useGameState, useHeroRoster } from './hooks/useGame'
import type { GameState } from './types/game'

// Заглушка ответа ведущего, пока ИИ не подключён.
const STUB_REPLY = 'Ведущий задумчиво молчит… (ИИ-ведущий пока не подключён — это заглушка.)'

type Screen = 'menu' | 'creation' | 'game' | 'heroes'

function App() {
  const state = useGameState()
  const roster = useHeroRoster()
  // При запуске всегда стартовый экран: продолжить, мои герои, создать героя или быстрый старт.
  const [screen, setScreen] = useState<Screen>('menu')
  const [heroesTab, setHeroesTab] = useState<'heroes' | 'hall'>('heroes')
  const current: Screen = screen === 'game' && !state ? 'menu' : screen
  const stores = { game: gameStore, heroes: heroStore }

  /** Если идёт история — спросить, можно ли её прервать. Её герой вернётся в «Мои герои». */
  const confirmInterrupt = () =>
    !state ||
    window.confirm(
      `Начать новую историю? Текущая история «${state.story.title}» (герой — ${state.character.name}) будет прервана, ` +
        'а герой вернётся в «Мои герои». Одновременно можно вести только одну историю.',
    )

  /** Выполнить действие сессии; при отказе — показать причину. */
  const run = (action: () => string | null): boolean => {
    const reason = action()
    if (reason) window.alert(reason)
    return !reason
  }

  const startHero = (heroId: string) => {
    if (confirmInterrupt() && run(() => startStory(stores, heroId))) setScreen('game')
  }

  const openHeroes = (tab: 'heroes' | 'hall' = 'heroes') => {
    setHeroesTab(tab)
    setScreen('heroes')
  }

  const finishStory = () => {
    if (!state) return
    const ok = window.confirm(
      `Завершить историю «${state.story.title}»? ${state.character.name} отправится в «Зал славы» с итогом пути. ` +
        'Продолжить эту историю будет нельзя.',
    )
    if (ok && run(() => endStory(stores, 'completed'))) openHeroes('hall')
  }

  return (
    <div className={`app${current === 'game' ? '' : ' app--page'}`}>
      <header className="app-header">
        <h1>ИИ-Мастер</h1>
        {current !== 'menu' && (
          <div className="header-actions">
            {current === 'game' && (
              <button type="button" className="header-button" onClick={finishStory} data-testid="finish-story">
                Завершить историю
              </button>
            )}
            <button type="button" className="header-button" onClick={() => setScreen('menu')}>
              В меню
            </button>
          </div>
        )}
      </header>
      {current === 'menu' && (
        <StartMenu
          save={state}
          heroCount={roster.heroes.length}
          onContinue={() => setScreen('game')}
          onHeroes={() => openHeroes()}
          onCreate={() => setScreen('creation')}
          onQuickStart={() => confirmInterrupt() && run(() => quickStart(stores, startingSheet)) && setScreen('game')}
        />
      )}
      {current === 'heroes' && (
        <HeroesScreen
          key={heroesTab}
          roster={roster}
          game={state}
          initialTab={heroesTab}
          onCreate={() => setScreen('creation')}
          onStart={startHero}
          onContinue={() => setScreen('game')}
          onRename={(heroId, name) => renameEverywhere(stores, heroId, name)}
          onDelete={(heroId) => heroStore.update((r) => deleteHero(r, heroId, state?.story.title))}
        />
      )}
      {current === 'creation' && (
        <CharacterCreation
          onStart={(sheet) => {
            if (confirmInterrupt() && run(() => saveHero(stores, sheet) ?? startStory(stores, sheet.character.id))) setScreen('game')
          }}
          onSave={(sheet) => run(() => saveHero(stores, sheet)) && openHeroes()}
        />
      )}
      {/* key: новая история монтирует экран заново, сбрасывая локальное состояние (ожидание ответа, анимации). */}
      {current === 'game' && state && <GameScreen key={state.story.id} state={state} />}
    </div>
  )
}

function GameScreen({ state }: { state: GameState }) {
  const location = locations[state.location.id]
  const [waiting, setWaiting] = useState(false)
  const timerRef = useRef<number | undefined>(undefined)
  const [animatedRollId, setAnimatedRollId] = useState<string | null>(null)
  const animatedRoll = animatedRollId ? state.rolls.find((r) => r.id === animatedRollId) : undefined
  const hideRoll = useCallback(() => setAnimatedRollId(null), [])

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  const handleSend = (text: string) => {
    gameStore.dispatch(messageAdded('player', text))
    setWaiting(true)
    timerRef.current = window.setTimeout(() => {
      gameStore.dispatch(messageAdded('master', STUB_REPLY))
      setWaiting(false)
    }, 600)
  }

  const handleRoll = (notation: string, mode: RollMode): string | null => {
    try {
      const action = diceRolled(roll(notation, { mode }))
      gameStore.dispatch(action)
      setAnimatedRollId(action.roll.id)
      return null
    } catch (error) {
      if (error instanceof DiceError) return error.message
      throw error
    }
  }

  const handleEquipChange = (change: EquipmentChange): string | null => {
    const result = changeEquipment(state, itemCatalog, change)
    if (!result.ok) return result.reason
    gameStore.dispatch(result.action)
    return null
  }

  return (
    <>
      <div className="layout">
        <main className="main-column">
          <MapPanel location={location} player={state.location.player} doors={state.location.doors} />
          <section className="panel story-panel">
            <NarrationLog messages={state.messages} />
            <PlayerInput onSend={handleSend} disabled={waiting} leading={<DiceTray rolls={state.rolls} onRoll={handleRoll} />} />
          </section>
        </main>
        <InventoryPanel character={state.character} inventory={state.inventory} catalog={itemCatalog} onEquipChange={handleEquipChange} />
      </div>
      {animatedRoll && <DiceRollOverlay key={animatedRoll.id} roll={animatedRoll} onDone={hideRoll} />}
    </>
  )
}

export default App
