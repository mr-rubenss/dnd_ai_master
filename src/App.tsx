import { useEffect, useRef, useState } from 'react'
import { InventoryPanel } from './components/InventoryPanel'
import { MapPanel } from './components/MapPanel'
import { NarrationLog } from './components/NarrationLog'
import { PlayerInput } from './components/PlayerInput'
import { mockInventory, mockLocation, mockMessages } from './data/mock'
import type { ChatMessage } from './types/game'

// Заглушка ответа ведущего, пока ИИ не подключён.
const STUB_REPLY = 'Ведущий задумчиво молчит… (ИИ-ведущий пока не подключён — это заглушка.)'

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>(mockMessages)
  const [waiting, setWaiting] = useState(false)
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  const handleSend = (text: string) => {
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), author: 'player', text }])
    setWaiting(true)
    timerRef.current = window.setTimeout(() => {
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), author: 'master', text: STUB_REPLY }])
      setWaiting(false)
    }, 600)
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>ИИ-Мастер</h1>
      </header>
      <div className="layout">
        <main className="main-column">
          <MapPanel location={mockLocation} />
          <section className="panel story-panel">
            <NarrationLog messages={messages} />
            <PlayerInput onSend={handleSend} disabled={waiting} />
          </section>
        </main>
        <InventoryPanel inventory={mockInventory} />
      </div>
    </div>
  )
}

export default App
