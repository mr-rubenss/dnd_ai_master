import { useCallback, useEffect, useRef, useState } from 'react'
import { CharacterCreation } from './components/creation/CharacterCreation'
import { StartMenu } from './components/StartMenu'
import { DiceRollOverlay } from './components/DiceRollOverlay'
import { DiceTray } from './components/DiceTray'
import { InventoryPanel } from './components/InventoryPanel'
import { MapPanel } from './components/MapPanel'
import { NarrationLog } from './components/NarrationLog'
import { PlayerInput } from './components/PlayerInput'
import { itemCatalog, locations, startingSheet } from './data'
import { DiceError, roll, type RollMode } from './engine/dice'
import { diceRolled, messageAdded } from './game/state'
import { gameStore, useGameState } from './hooks/useGame'
import type { CharacterSheet } from './types/character'
import type { GameState } from './types/game'

// Заглушка ответа ведущего, пока ИИ не подключён.
const STUB_REPLY = 'Ведущий задумчиво молчит… (ИИ-ведущий пока не подключён — это заглушка.)'

type Screen = 'menu' | 'creation' | 'game'

const REPLACE_WARNING = 'Начать новую игру? Текущая игра будет потеряна — пока можно вести только одну историю.'

function App() {
  const state = useGameState()
  // При запуске всегда стартовый экран: продолжить, создать героя или быстрый старт.
  const [screen, setScreen] = useState<Screen>('menu')
  const current: Screen = screen === 'game' && !state ? 'menu' : screen

  /** Если есть сохранение — спросить, можно ли его заменить. */
  const confirmReplace = () => !state || window.confirm(REPLACE_WARNING)

  const startGame = (sheet: CharacterSheet) => {
    gameStore.startGame(sheet)
    setScreen('game')
  }

  return (
    <div className={`app${current === 'game' ? '' : ' app--page'}`}>
      <header className="app-header">
        <h1>ИИ-Мастер</h1>
        {current !== 'menu' && (
          <button type="button" className="header-button" onClick={() => setScreen('menu')}>
            В меню
          </button>
        )}
      </header>
      {current === 'menu' && (
        <StartMenu
          save={state}
          onContinue={() => setScreen('game')}
          onCreate={() => confirmReplace() && setScreen('creation')}
          onQuickStart={() => confirmReplace() && startGame(startingSheet)}
        />
      )}
      {/* Подтверждение замены уже получено в меню; игра заменяется только при старте нового героя. */}
      {current === 'creation' && <CharacterCreation onStart={startGame} />}
      {/* key: новая игра монтирует экран заново, сбрасывая локальное состояние (ожидание ответа, анимации). */}
      {current === 'game' && state && <GameScreen key={state.character.id} state={state} />}
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

  return (
    <>
      <div className="layout">
        <main className="main-column">
          <MapPanel location={location} player={state.location.player} />
          <section className="panel story-panel">
            <NarrationLog messages={state.messages} />
            <PlayerInput onSend={handleSend} disabled={waiting} leading={<DiceTray rolls={state.rolls} onRoll={handleRoll} />} />
          </section>
        </main>
        <InventoryPanel character={state.character} inventory={state.inventory} catalog={itemCatalog} />
      </div>
      {animatedRoll && <DiceRollOverlay key={animatedRoll.id} roll={animatedRoll} onDone={hideRoll} />}
    </>
  )
}

export default App
