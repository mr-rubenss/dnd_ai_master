import { useCallback, useEffect, useRef, useState } from 'react'
import { SettingsButton, SettingsPanel, type SettingsTab } from './components/SettingsPanel'
import { CharacterCreation } from './components/creation/CharacterCreation'
import { DiceRollOverlay } from './components/DiceRollOverlay'
import { DiceTray } from './components/DiceTray'
import { EpilogueDialog } from './components/EpilogueDialog'
import { HeroesScreen } from './components/HeroesScreen'
import { InventoryPanel } from './components/InventoryPanel'
import { MapPanel } from './components/MapPanel'
import { NarrationLog } from './components/NarrationLog'
import { NewStoryScreen } from './components/NewStoryScreen'
import { PlayerInput } from './components/PlayerInput'
import { StartMenu } from './components/StartMenu'
import { StoriesScreen } from './components/StoriesScreen'
import { AiError } from './ai'
import { calibrationStore } from './ai/calibrationStore'
import { settingsProblems } from './ai/settings'
import { useAiSettings } from './ai/settingsStore'
import { adventures, defaultAdventure, itemCatalog, rulesData, startingSheet } from './data'
import { DiceError, roll, type RollMode } from './engine/dice'
import { draftEpilogue } from './game/epilogue'
import { rewritableMessageId, streamingText } from './game/masterSuggestions'
import { runMasterRewrite, runMasterTurn } from './game/masterTurn'
import { devLog } from './game/devLog'
import { compactionNeeded, compactMemory, writeEpilogueSummary } from './game/memory'
import { masterSession, type MasterSession } from './game/masterSession'
import { currentLocation, ENGINE, equipmentEvent, leadMember, MASTER, player, type EquipmentChange } from './game/storyActions'
import { appStore, useAppState } from './hooks/useGame'
import type { StoryState } from './types/story'

// Заглушка ответа ведущего, пока ИИ не подключён.
/** Ответ, пока ведущий не настроен (нет ключа API и т. п.). */
const STUB_REPLY = 'Ведущий задумчиво молчит… (ИИ-ведущий не подключён: укажите ключ API в «Настройки» → «Ведущий».)'

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
  /** Окно итога завершённой истории. */
  const [epilogueOpen, setEpilogueOpen] = useState(false)
  /** Экран настроек (шестерёнка в шапке): открытая вкладка или null. */
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null)
  const closeSettings = useCallback(() => setSettingsTab(null), [])
  const aiState = useAiSettings()
  /** Ведущий пишет черновик итога истории. */
  const [writingEpilogue, setWritingEpilogue] = useState(false)
  const current: Screen = screen === 'game' && !app.active ? 'menu' : screen
  const readOnly = app.active?.status === 'completed'
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
    setEpilogueOpen(false)
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
    const confirmed = window.confirm(
      `Завершить историю «${active.title}»? Дальше она будет доступна только для чтения, а герои освободятся для новых историй ` +
        '(погибшие уйдут в «Зал славы»). Итог истории попадёт в «Летопись» героев.',
    )
    if (!confirmed) return
    let epilogue = draftEpilogue(active, Date.now())
    // Черновик краткого содержания пишет ведущий — по сводке памяти и журналу фактов; не вышло — черновик из журнала.
    if (settingsProblems(aiState.settings, aiState.apiKey).length === 0) {
      setWritingEpilogue(true)
      try {
        const session = masterSession(aiState.settings, aiState.apiKey)
        const summary = await writeEpilogueSummary(session.master, active, session.turn)
        epilogue = { ...epilogue, summary }
      } catch (error) {
        devLog.add({ kind: 'error', text: `Итог истории от ведущего не получен: ${error instanceof Error ? error.message : String(error)}` })
      } finally {
        setWritingEpilogue(false)
      }
    }
    if (ok(await appStore.completeStory(epilogue))) setEpilogueOpen(true)
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
        <div className="header-actions">
          <SettingsButton onClick={() => setSettingsTab('appearance')} />
          {current !== 'menu' && (
            <>
              {current === 'game' && !readOnly && (
                <button type="button" className="header-button" onClick={finishStory} data-testid="finish-story" disabled={writingEpilogue}>
                  {writingEpilogue ? 'Ведущий пишет итог…' : 'Завершить историю'}
                </button>
              )}
              <button
                type="button"
                className="header-button"
                onClick={() => {
                  setEpilogueOpen(false)
                  setScreen('menu')
                }}
              >
                В меню
              </button>
            </>
          )}
        </div>
      </header>
      {settingsTab && <SettingsPanel initialTab={settingsTab} onClose={closeSettings} />}
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
      {current === 'game' && app.active && <GameScreen key={app.active.id} story={app.active} onShowEpilogue={() => setEpilogueOpen(true)} />}
      {current === 'game' && app.active?.epilogue && epilogueOpen && (
        <EpilogueDialog
          story={app.active}
          catalog={itemCatalog}
          onSave={(text) => appStore.editEpilogue(app.active!.id, text)}
          onClose={() => setEpilogueOpen(false)}
        />
      )}
    </div>
  )
}

function GameScreen({ story, onShowEpilogue }: { story: StoryState; onShowEpilogue: () => void }) {
  const lead = leadMember(story)
  /** Завершённая история — только для чтения. */
  const readOnly = story.status === 'completed'
  const location = currentLocation(story)
  const [waiting, setWaiting] = useState(false)
  const timerRef = useRef<number | undefined>(undefined)
  const [animatedRollId, setAnimatedRollId] = useState<string | null>(null)
  const animatedRoll = animatedRollId ? story.rolls.find((r) => r.id === animatedRollId) : undefined
  const hideRoll = useCallback(() => setAnimatedRollId(null), [])

  const ai = useAiSettings()
  /** Текст ведущего, пока он приходит потоком ('' — ведущий думает), или null. */
  const [streamText, setStreamText] = useState<string | null>(null)
  const [aiNotice, setAiNotice] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  /** Фоновое сжатие памяти ведущего: идёт ли и как его остановить. */
  const [compacting, setCompacting] = useState(false)
  const compactingRef = useRef<Promise<void> | null>(null)
  const compactAbortRef = useRef<AbortController | null>(null)

  useEffect(
    () => () => {
      window.clearTimeout(timerRef.current)
      abortRef.current?.abort()
      compactAbortRef.current?.abort()
    },
    [],
  )

  /** Что делает ведущий сейчас (и что повторит «Повторить» после ошибки): ход или переписывание ответа. */
  const [replacingId, setReplacingId] = useState<string | null>(null)
  const lastRequestRef = useRef<{ kind: 'turn' } | { kind: 'rewrite'; messageId: string }>({ kind: 'turn' })

  /**
   * Ход ведущего через общий интерфейс src/ai/: поставщик модели выбран в настройках.
   * rewriteId — «Переписать ответ»: новый текст последнего ответа, без инструментов (игра не меняется).
   */
  const askMaster = async (rewriteId: string | null = null) => {
    lastRequestRef.current = rewriteId ? { kind: 'rewrite', messageId: rewriteId } : { kind: 'turn' }
    setAiError(null)
    setWaiting(true)
    setReplacingId(rewriteId)
    setStreamText('')
    const finish = () => {
      setWaiting(false)
      setStreamText(null)
      setAiNotice(null)
      setReplacingId(null)
    }
    if (settingsProblems(ai.settings, ai.apiKey).length > 0) {
      timerRef.current = window.setTimeout(() => {
        const event = rewriteId
          ? ({ type: 'masterRewritten', messageId: rewriteId, text: STUB_REPLY } as const)
          : ({ type: 'masterNarrated', messageId: crypto.randomUUID(), text: STUB_REPLY } as const)
        appStore.dispatch(event, MASTER)
        finish()
      }, 600)
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    // Поток копится целиком, а игроку показывается без строки подсказок «Варианты: …».
    let streamed = ''
    const onText = (delta: string) => {
      setAiNotice(null)
      streamed += delta
      setStreamText(streamingText(streamed))
    }
    const onRetry = ({ delayMs }: { delayMs: number }) =>
      setAiNotice(`Превышен лимит запросов — повторяю через ${Math.ceil(delayMs / 1000)} с…`)
    const session = masterSession(ai.settings, ai.apiKey)
    const context = { catalog: itemCatalog, rules: rulesData }
    const common = { verbosity: ai.settings.verbosity, context, ...session.turn, signal: controller.signal, onText, onRetry }
    let ok = false
    try {
      // Ошибка «слишком длинный контекст» — сжатие памяти и один повтор.
      for (let attempt = 0; ; attempt++) {
        try {
          const current = appStore.getState().active ?? story
          if (rewriteId) {
            const result = await runMasterRewrite(session.master, current, common)
            if (result && result.messageId === rewriteId) {
              const reason = await appStore.dispatchTo(
                story.id,
                { type: 'masterRewritten', messageId: rewriteId, text: result.text, ...(result.suggestions.length ? { suggestions: result.suggestions } : {}) },
                MASTER,
              )
              if (reason) setAiError(reason)
            }
          } else {
            const { text, suggestions } = await runMasterTurn(session.master, current, {
              ...common,
              // Инструменты: ведущий меняет игру только через них, движок проверяет каждый вызов.
              runtime: {
                getStory: () => (appStore.getState().active?.id === story.id ? appStore.getState().active! : current),
                commit: (event, author) => appStore.dispatchTo(story.id, event, author),
                tools: { catalog: itemCatalog, now: () => Date.now(), newId: () => crypto.randomUUID() },
                onRound: () => {
                  streamed = ''
                  setStreamText('')
                },
              },
            })
            if (text)
              await appStore.dispatchTo(
                story.id,
                { type: 'masterNarrated', messageId: crypto.randomUUID(), text, ...(suggestions.length ? { suggestions } : {}) },
                MASTER,
              )
          }
          ok = true
          break
        } catch (error) {
          if (!(error instanceof AiError && error.kind === 'context-length' && attempt === 0) || controller.signal.aborted) throw error
          calibrationStore.underestimated(session.model)
          streamed = ''
          setStreamText('')
          setAiNotice('Запрос не поместился в память модели — ведущий сжимает старые события и пробует снова…')
          await compactNow('context-error', session, true)
          setAiNotice(null)
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return
      setAiError(error instanceof AiError ? error.message : 'Ведущий не ответил из-за неизвестной ошибки.')
    } finally {
      if (!controller.signal.aborted) finish()
    }
    // Сжатие памяти — в фоне после ответа, игрок не ждёт.
    if (ok) void compactNow('budget', session, false)
  }

  /**
   * Сжатие памяти ведущего (src/game/memory.ts). Фоновое — только если пора (запрос больше бюджета, разрослись
   * сводка или факты); принудительное — после ошибки «слишком длинный контекст». Ошибка сжатия не ломает игру:
   * запрос всё равно уйдёт, а при риске превысить окно самые старые сообщения из него просто уберутся.
   */
  const compactNow = async (reason: 'budget' | 'context-error', session: MasterSession, force: boolean) => {
    if (compactingRef.current) return compactingRef.current
    const active = appStore.getState().active
    if (!active || active.id !== story.id) return
    const options = { verbosity: ai.settings.verbosity, context: { catalog: itemCatalog, rules: rulesData }, ...session.compact, force }
    if (!force && !compactionNeeded(active, options)) return
    const controller = new AbortController()
    compactAbortRef.current = controller
    const run = (async () => {
      setCompacting(true)
      try {
        const result = await compactMemory(
          session.compactor,
          {
            getStory: () => {
              const now = appStore.getState().active
              if (!now || now.id !== story.id) throw new AiError('aborted')
              return now
            },
            commit: (event, author) => appStore.dispatchTo(story.id, event, author),
            tools: { catalog: itemCatalog, now: () => Date.now(), newId: () => crypto.randomUUID() },
            now: () => Date.now(),
          },
          { ...options, signal: controller.signal },
        )
        const sizeOnly = !force && result.compacted === 0
        devLog.add({ kind: 'compaction', model: session.compactModel, reason: force ? reason : sizeOnly ? 'size' : 'budget', ...result })
      } catch (error) {
        if (controller.signal.aborted) return
        devLog.add({ kind: 'error', text: `Сжатие памяти не удалось: ${error instanceof Error ? error.message : String(error)}` })
      } finally {
        setCompacting(false)
        compactingRef.current = null
      }
    })()
    compactingRef.current = run
    return run
  }

  const retryMaster = () => {
    const last = lastRequestRef.current
    // Переписать можно, только если ответ всё ещё последний; иначе — обычный ход.
    void askMaster(last.kind === 'rewrite' && rewritableMessageId(story.messages) === last.messageId ? last.messageId : null)
  }

  /** Подсказки последнего ответа ведущего (если он последний в ленте). */
  const lastMessage = story.messages.at(-1)
  const suggestions = lastMessage?.author === 'master' && !waiting ? (lastMessage.suggestions ?? []) : []

  const handleSend = (text: string) => {
    appStore.dispatch({ type: 'playerSpoke', heroId: lead.heroId, messageId: crypto.randomUUID(), text }, player(lead.heroId))
    void askMaster()
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
            <NarrationLog
              messages={story.messages}
              pending={streamText}
              replacingId={replacingId}
              onRewrite={readOnly ? undefined : (messageId) => void askMaster(messageId)}
              rewriteDisabled={waiting}
            />
            {compacting && !waiting && (
              <p className="master-notice memory-notice" role="status" data-testid="memory-compacting">
                Ведущий записывает в память старые события…
              </p>
            )}
            {aiNotice && (
              <p className="master-notice" role="status" data-testid="master-notice">
                {aiNotice}
              </p>
            )}
            {aiError && (
              <div className="master-error" role="alert" data-testid="master-error">
                <p>{aiError}</p>
                <button type="button" className="item-action is-primary" onClick={retryMaster} disabled={waiting}>
                  Повторить
                </button>
              </div>
            )}
            {readOnly ? (
              <div className="story-ended" data-testid="story-read-only">
                <p>История завершена — только чтение.</p>
                <button type="button" className="item-action is-primary" onClick={onShowEpilogue}>
                  Итог истории
                </button>
              </div>
            ) : (
              <PlayerInput onSend={handleSend} disabled={waiting} suggestions={suggestions} leading={<DiceTray rolls={story.rolls} onRoll={handleRoll} />} />
            )}
          </section>
        </main>
        <InventoryPanel
          character={lead.character}
          inventory={lead.inventory}
          catalog={itemCatalog}
          onEquipChange={readOnly ? undefined : handleEquipChange}
          journal={{ memory: story.memory, facts: story.world.facts }}
        />
      </div>
      {animatedRoll && <DiceRollOverlay key={animatedRoll.id} roll={animatedRoll} onDone={hideRoll} />}
    </>
  )
}

export default App
