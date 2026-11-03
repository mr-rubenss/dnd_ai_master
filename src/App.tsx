import { useCallback, useEffect, useRef, useState } from 'react'
import { DiceRollOverlay } from './components/DiceRollOverlay'
import { DiceTray } from './components/DiceTray'
import { InventoryPanel } from './components/InventoryPanel'
import { MapPanel } from './components/MapPanel'
import { NarrationLog } from './components/NarrationLog'
import { PlayerInput } from './components/PlayerInput'
import { itemCatalog, locations } from './data'
import { DiceError, roll, type RollMode } from './engine/dice'
import { diceRolled, messageAdded } from './game/state'
import { gameStore, useGameState } from './hooks/useGame'

// Заглушка ответа ведущего, пока ИИ не подключён.
const STUB_REPLY = 'Ведущий задумчиво молчит… (ИИ-ведущий пока не подключён — это заглушка.)'

function App() {
  const state = useGameState()
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

  const handleNewGame = () => {
    if (window.confirm('Начать новую игру? Текущий прогресс будет потерян.')) {
      window.clearTimeout(timerRef.current)
      setWaiting(false)
      gameStore.newGame()
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>ИИ-Мастер</h1>
        <button type="button" className="header-button" onClick={handleNewGame}>
          Новая игра
        </button>
      </header>
      <div className="layout">
        <main className="main-column">
          <MapPanel location={location} player={state.location.player} />
          <section className="panel story-panel">
            <NarrationLog messages={state.messages} />
            <PlayerInput
              onSend={handleSend}
              disabled={waiting}
              leading={<DiceTray rolls={state.rolls} onRoll={handleRoll} />}
            />
          </section>
        </main>
        <InventoryPanel character={state.character} inventory={state.inventory} catalog={itemCatalog} />
      </div>
      {animatedRoll && <DiceRollOverlay key={animatedRoll.id} roll={animatedRoll} onDone={hideRoll} />}
    </div>
  )
}

export default App
