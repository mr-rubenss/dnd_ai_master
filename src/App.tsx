import { useCallback, useEffect, useRef, useState } from 'react'
import { CharacterCreation } from './components/creation/CharacterCreation'
import { DiceRollOverlay } from './components/DiceRollOverlay'
import { DiceTray } from './components/DiceTray'
import { HeroesScreen } from './components/HeroesScreen'
import { InventoryPanel } from './components/InventoryPanel'
import { MapPanel } from './components/MapPanel'
import { NarrationLog } from './components/NarrationLog'
import { NewStoryScreen } from './components/NewStoryScreen'
import { PlayerInput } from './components/PlayerInput'
import { StartMenu } from './components/StartMenu'
import { StoriesScreen } from './components/StoriesScreen'
import { adventures, defaultAdventure, itemCatalog, startingSheet } from './data'
import { DiceError, roll, type RollMode } from './engine/dice'
import { currentLocation, ENGINE, equipmentEvent, leadMember, MASTER, player, type EquipmentChange } from './game/storyActions'
import { appStore, useAppState } from './hooks/useGame'
import type { StoryState } from './types/story'

// Заглушка ответа ведущего, пока ИИ не подключён.
const STUB_REPLY = 'Ведущий задумчиво молчит… (ИИ-ведущий пока не подключён — это заглушка.)'

type Screen = 'menu' | 'stories' | 'new-story' | 'creation' | 'heroes' | 'game'

function App() {
  const app = useAppState()
  // При запуске всегда стартовый экран.
  const [screen, setScreen] = useState<Screen>('menu')
  const [heroesTab, setHeroesTab] = useState<'heroes' | 'hall'>('heroes')
  /** Герой, выбранный для новой истории заранее. */
  const [storyHeroId, setStoryHeroId] = useState<string | null>(null)
  /** Куда вернуться после создания героя. */
  const [afterCreation, setAfterCreation] = useState<'heroes' | 'new-story'>('heroes')
  const current: Screen = screen === 'game' && !app.active ? 'menu' : screen
  const latest = app.stories.find((s) => s.status === 'active') ?? null

  useEffect(() => {
    void appStore.init()
  }, [])

  /** Показать причину отказа, если она есть. */
  const ok = (reason: string | null) => {
    if (reason) window.alert(reason)
    return !reason
  }

  const openStory = async (storyId: string) => {
    if (ok(await appStore.openStory(storyId))) setScreen('game')
  }

  const newStory = (heroId: string | null = null) => {
    setStoryHeroId(heroId)
    setScreen('new-story')
  }

  const openHeroes = (tab: 'heroes' | 'hall' = 'heroes') => {
    setHeroesTab(tab)
    setScreen('heroes')
  }

  const createHero = (returnTo: 'heroes' | 'new-story') => {
    setAfterCreation(returnTo)
    setScreen('creation')
  }

  const finishStory = async () => {
    const active = app.active
    if (!active) return
    const names = active.party.map((m) => m.character.name).join(', ')
    const confirmed = window.confirm(
      `Завершить историю «${active.title}»? Герои (${names}) отправятся в «Зал славы» с итогом пути. Продолжить эту историю будет нельзя.`,
    )
    if (confirmed && ok(await appStore.completeActive('completed'))) openHeroes('hall')
  }

  if (!app.ready) {
    return (
      <div className="app app--page">
        <header className="app-header">
          <h1>ИИ-Мастер</h1>
        </header>
        <p className="loading-note" role="status">
          Загрузка историй…
        </p>
      </div>
    )
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
          latest={latest}
          storyCount={app.stories.length}
          heroCount={app.roster.heroes.length}
          onContinue={openStory}
          onStories={() => setScreen('stories')}
          onHeroes={() => openHeroes()}
          onCreate={() => createHero('heroes')}
          onQuickStart={async () => {
            if (ok(await appStore.quickStart(startingSheet, defaultAdventure.id))) setScreen('game')
          }}
        />
      )}
      {current === 'stories' && (
        <StoriesScreen
          stories={app.stories}
          onNew={() => newStory()}
          onContinue={openStory}
          onRename={(id, title) => appStore.renameStory(id, title)}
          onDelete={(id) => appStore.deleteStory(id)}
        />
      )}
      {current === 'new-story' && (
        <NewStoryScreen
          key={storyHeroId ?? 'none'}
          heroes={app.roster.heroes}
          adventures={Object.values(adventures)}
          defaultAdventureId={defaultAdventure.id}
          initialHeroId={storyHeroId}
          onCreateHero={() => createHero('new-story')}
          onStart={async (request) => {
            const reason = await appStore.createStory(request)
            if (!reason) setScreen('game')
            return reason
          }}
        />
      )}
      {current === 'heroes' && (
        <HeroesScreen
          key={heroesTab}
          roster={app.roster}
          stories={app.stories}
          readStory={(id) => appStore.readStory(id)}
          initialTab={heroesTab}
          onCreate={() => createHero('heroes')}
          onStart={(heroId) => newStory(heroId)}
          onContinue={openStory}
          onRename={(heroId, name) => appStore.renameHero(heroId, name)}
          onDelete={(heroId) => appStore.deleteHero(heroId)}
        />
      )}
      {current === 'creation' && (
        <CharacterCreation
          onStart={async (sheet) => {
            if (ok(await appStore.saveHero(sheet))) newStory(sheet.character.id)
          }}
          onSave={async (sheet) => {
            if (!ok(await appStore.saveHero(sheet))) return
            if (afterCreation === 'new-story') newStory(sheet.character.id)
            else openHeroes()
          }}
        />
      )}
      {/* key: другая история монтирует экран заново, сбрасывая локальное состояние (ожидание ответа, анимации). */}
      {current === 'game' && app.active && <GameScreen key={app.active.id} story={app.active} />}
    </div>
  )
}

function GameScreen({ story }: { story: StoryState }) {
  const lead = leadMember(story)
  const location = currentLocation(story)
  const [waiting, setWaiting] = useState(false)
  const timerRef = useRef<number | undefined>(undefined)
  const [animatedRollId, setAnimatedRollId] = useState<string | null>(null)
  const animatedRoll = animatedRollId ? story.rolls.find((r) => r.id === animatedRollId) : undefined
  const hideRoll = useCallback(() => setAnimatedRollId(null), [])

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  const handleSend = (text: string) => {
    appStore.dispatch({ type: 'playerSpoke', heroId: lead.heroId, messageId: crypto.randomUUID(), text }, player(lead.heroId))
    setWaiting(true)
    timerRef.current = window.setTimeout(() => {
      appStore.dispatch({ type: 'masterNarrated', messageId: crypto.randomUUID(), text: STUB_REPLY }, MASTER)
      setWaiting(false)
    }, 600)
  }

  const handleRoll = (notation: string, mode: RollMode): string | null => {
    try {
      const record = { id: crypto.randomUUID(), timestamp: Date.now(), result: roll(notation, { mode }) }
      const reason = appStore.dispatch({ type: 'diceRolled', roll: record }, ENGINE)
      if (reason) return reason
      setAnimatedRollId(record.id)
      return null
    } catch (error) {
      if (error instanceof DiceError) return error.message
      throw error
    }
  }

  const handleEquipChange = (change: EquipmentChange): string | null => {
    const result = equipmentEvent(lead, itemCatalog, change)
    if (!result.ok) return result.reason
    return appStore.dispatch(result.event, player(lead.heroId))
  }

  return (
    <>
      <div className="layout">
        <main className="main-column">
          <MapPanel location={location} player={lead.position} doors={story.world.doors[location.id] ?? {}} />
          <section className="panel story-panel">
            <NarrationLog messages={story.messages} />
            <PlayerInput onSend={handleSend} disabled={waiting} leading={<DiceTray rolls={story.rolls} onRoll={handleRoll} />} />
          </section>
        </main>
        <InventoryPanel character={lead.character} inventory={lead.inventory} catalog={itemCatalog} onEquipChange={handleEquipChange} />
      </div>
      {animatedRoll && <DiceRollOverlay key={animatedRoll.id} roll={animatedRoll} onDone={hideRoll} />}
    </>
  )
}

export default App
