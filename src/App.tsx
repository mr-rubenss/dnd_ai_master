import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SettingsButton, SettingsPanel, type SettingsTab } from './components/SettingsPanel'
import { CharacterCreation } from './components/creation/CharacterCreation'
import { DiceRollOverlay } from './components/DiceRollOverlay'
import { DiceTray } from './components/DiceTray'
import { EpilogueDialog } from './components/EpilogueDialog'
import { HeroesScreen } from './components/HeroesScreen'
import { InventoryPanel } from './components/InventoryPanel'
import { SpellChoiceDialog, type SheetCompletion } from './components/MagicPanel'
import { RestButton, RestDialog } from './components/RestPanel'
import { changeNames, REST_NAMES, restBlocker, restEvents } from './game/rest'
import { changeList, ledgerOf, turnDelta } from './game/turnChanges'
import type { RestKind } from './types/story'
import { needsSheetCompletion } from './game/sheetCompletion'
import { GameClock } from './components/GameClock'
import { MapPanel } from './components/MapPanel'
import type { HeroMovement, MapActions, MapVision } from './components/LocationMap'
import type { MarkEditor } from './components/MapMarks'
import { marksOf } from './game/marks'
import { EXIT_STUCK_TURNS, exitLockProblem, missingMapNote, trailOf, travelNote, travelPlan, travelText } from './game/travel'
import { exploredCells, newlyExplored, partyVision } from './game/vision'
import { useAppearance } from './theme/appearanceStore'
import { approachCell, heroBlocker, heroMovePlan, heroReachable } from './game/heroMove'
import { walkPath } from './game/mapView'
import { MAP_REACTIONS, moveReportEvent, moveSignificance, pendingMoveText, reactionDue } from './game/mapEvents'
import type { CellPosition } from './types/location'
import { NarrationLog } from './components/NarrationLog'
import { NewStoryScreen } from './components/NewStoryScreen'
import { PlayerInput, type InputMode } from './components/PlayerInput'
import { StartMenu } from './components/StartMenu'
import { StoriesScreen } from './components/StoriesScreen'
import { AiError } from './ai'
import { calibrationStore } from './ai/calibrationStore'
import { settingsProblems } from './ai/settings'
import { useAiSettings } from './ai/settingsStore'
import { adventures, defaultAdventure, itemCatalog, priceList, rulesData, startingSheet } from './data'
import { DiceError, roll, type RollMode } from './engine/dice'
import { draftEpilogue } from './game/epilogue'
import { lastNarrative, rewritableMessageId, streamingText } from './game/masterSuggestions'
import { runMasterRewrite, runMasterTurn } from './game/masterTurn'
import { devLog } from './game/devLog'
import { compactionNeeded, compactMemory, writeEpilogueSummary } from './game/memory'
import { masterSession, timedFor, type MasterSession } from './game/masterSession'
import { AiProgress, AiTaskError } from './components/AiTask'
import { useAiTask } from './components/useAiTask'
import { ReportButton, ReportDialog, ReportOffer } from './components/TestReport'
import { useCrashOffer } from './components/reportCollect'
import { reportStore, useReportUi } from './components/reportStore'
import { traceStore } from './game/turnTrace'
import { currentLocation, ENGINE, equipmentEvent, leadMember, MASTER, MAX_MOVE_TEXT, player, SYSTEM, type EquipmentChange } from './game/storyActions'
import { appStore, useAppState } from './hooks/useGame'
import type { StoryEpilogue, StoryEvent, StoryState } from './types/story'

// Заглушка ответа ведущего, пока ИИ не подключён.
/** Ответ, пока ведущий не настроен (нет ключа API и т. п.). */
const STUB_REPLY = 'Ведущий задумчиво молчит… (ИИ-ведущий не подключён: укажите ключ API в «Настройки» → «Ведущий».)'

/** Время для действий (вынесено из компонента: в обработчиках событий, не при отрисовке). */
const timestamp = () => Date.now()

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
  const epilogueTask = useAiTask()
  const [pendingEpilogue, setPendingEpilogue] = useState<{ story: StoryState; draft: StoryEpilogue } | null>(null)
  const writingEpilogue = pendingEpilogue !== null
  const current: Screen = screen === 'game' && !app.active ? 'menu' : screen
  const readOnly = app.active?.status === 'completed'
  const latest = app.stories.find((s) => s.status === 'active') ?? null
  /** Тестовый отчёт: окно и предложение после сбоя (необработанная ошибка). */
  const reportUi = useReportUi()
  useCrashOffer()
  const reportStoryId = current === 'game' && app.active ? app.active.id : (app.stories[0]?.id ?? null)

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
    const draft = draftEpilogue(active, timestamp())
    if (settingsProblems(aiState.settings, aiState.apiKey).length === 0) await writeEpilogue(active, draft)
    else await complete(draft)
  }

  const complete = async (epilogue: StoryEpilogue) => {
    setPendingEpilogue(null)
    epilogueTask.reset()
    if (ok(await appStore.completeStory(epilogue))) setEpilogueOpen(true)
  }

  /**
   * Черновик краткого содержания пишет ведущий — по сводке памяти и журналу фактов (индикатор, «Отменить», тайм-аут).
   * Отменено — черновик из журнала; ошибка или тайм-аут — выбор: попробовать ещё раз или без ведущего.
   */
  const writeEpilogue = async (story: StoryState, draft: StoryEpilogue) => {
    setPendingEpilogue({ story, draft })
    const session = masterSession(aiState.settings, aiState.apiKey)
    const result = await epilogueTask.run('Ведущий пишет итог истории для летописи…', ({ signal, setReceived }) =>
      writeEpilogueSummary(
        timedFor(session.master, 'epilogue', session.model, { signal, onProgress: (p) => setReceived(p.textChars) }),
        story,
        { ...session.turn, signal },
      ),
    )
    if (result.status === 'done') await complete({ ...draft, summary: result.value })
    else if (result.status === 'cancelled') await complete(draft)
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
        {current === 'game' && app.active && <GameClock story={app.active} />}
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
      <ReportOffer />
      {reportUi.open && <ReportDialog storyId={reportStoryId} />}
      {pendingEpilogue && (
        <div className="ai-task-overlay" role="dialog" aria-modal="true" aria-label="Итог истории" data-testid="epilogue-writing">
          <div className="ai-task-dialog panel">
            <h2>Итог истории</h2>
            <AiProgress state={epilogueTask.state} onCancel={epilogueTask.cancel} note="«Отменить» — итог будет черновиком из журнала, его можно поправить." />
            <AiTaskError state={epilogueTask.state}>
              <button type="button" className="primary-button" onClick={() => void writeEpilogue(pendingEpilogue.story, pendingEpilogue.draft)}>
                Попробовать ещё раз
              </button>
              <button type="button" className="secondary-button" onClick={() => void complete(pendingEpilogue.draft)}>
                Без ведущего
              </button>
            </AiTaskError>
          </div>
        </div>
      )}
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
          onReport={() => reportStore.open()}
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
          onChooseSpells={(heroId, completion) => appStore.chooseHeroSpells(heroId, completion)}
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
  /** Игрок нажал «Отменить» у «Мастер думает…» (а не ушёл с экрана). */
  const cancelledRef = useRef(false)
  /** Идёт настоящий запрос к модели (у заглушки отменять нечего). */
  const [canCancel, setCanCancel] = useState(false)
  const cancelMaster = () => {
    cancelledRef.current = true
    abortRef.current?.abort()
  }
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

  /**
   * Защита от тихого сбоя перехода: игрок нажал «Выйти», карты за выходом нет — ждём, что ведущий создаст её и переведёт
   * отряд. Если за EXIT_STUCK_TURNS ходов ведущего карта не сменилась — сообщение и «Повторить» (только в памяти вкладки).
   */
  const exitWatchRef = useRef<{ from: string; exitId: string; turns: number } | null>(null)
  const [travelStuck, setTravelStuck] = useState<{ exitId: string; name: string } | null>(null)
  const watchExit = () => {
    const w = exitWatchRef.current
    const now = appStore.getState().active
    if (!w || !now || now.id !== story.id) return
    if (now.world.currentLocationId !== w.from) {
      exitWatchRef.current = null
      setTravelStuck(null)
      return
    }
    w.turns++
    if (w.turns >= EXIT_STUCK_TURNS) setTravelStuck({ exitId: w.exitId, name: currentLocation(now).exits?.find((e) => e.id === w.exitId)?.name ?? w.exitId })
  }
  // Отряд перешёл (ведущим или движком) — ждать больше нечего.
  useEffect(() => {
    if (exitWatchRef.current && exitWatchRef.current.from !== location.id) {
      exitWatchRef.current = null
      setTravelStuck(null)
    }
  }, [location.id])

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
      setCanCancel(false)
      setWaiting(false)
      setStreamText(null)
      setAiNotice(null)
      setReplacingId(null)
    }
    // Вопрос вне игры: ответ — тоже вне игры; игра не меняется (ни отдыха, ни строки изменений, ни сжатия памяти).
    const outOfGame = !rewriteId && Boolean(appStore.getState().active?.outOfGame)
    // Запись хода для тестового отчёта: запросы, сырые ответы модели, инструменты (только в памяти вкладки).
    const recorder = traceStore.start(appStore.getState().active ?? story, rewriteId ? 'rewrite' : 'turn', itemCatalog)
    if (settingsProblems(ai.settings, ai.apiKey).length > 0) {
      recorder.stub()
      timerRef.current = window.setTimeout(() => {
        const event = rewriteId
          ? ({ type: 'masterRewritten', messageId: rewriteId, text: STUB_REPLY } as const)
          : ({ type: 'masterNarrated', messageId: crypto.randomUUID(), text: STUB_REPLY, ...(outOfGame ? { ooc: true } : {}) } as const)
        appStore.dispatch(event, MASTER)
        // Без ведущего решать некому: отдых, о котором попросил игрок, просто проходит.
        if (!rewriteId && !outOfGame) completePendingRest()
        if (!rewriteId && !outOfGame) watchExit()
        finish()
      }, 600)
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    cancelledRef.current = false
    setCanCancel(true)
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
    // Сроки ответа (src/ai/timeouts.ts): нет кусков потока или ответа слишком долго — запрос обрывается с объяснением.
    const master = timedFor(session.master, rewriteId ? 'rewrite' : 'turn', session.model, { signal: controller.signal })
    const context = { catalog: itemCatalog, rules: rulesData, prices: priceList }
    const common = { verbosity: ai.settings.verbosity, context, ...session.turn, signal: controller.signal, onText, onRetry, trace: recorder.hooks }
    let ok = false
    try {
      // Ошибка «слишком длинный контекст» — сжатие памяти и один повтор.
      for (let attempt = 0; ; attempt++) {
        try {
          const current = appStore.getState().active ?? story
          if (rewriteId) {
            const result = await runMasterRewrite(master, current, common)
            if (result && result.messageId === rewriteId) {
              const reason = await appStore.dispatchTo(
                story.id,
                { type: 'masterRewritten', messageId: rewriteId, text: result.text, ...(result.suggestions.length ? { suggestions: result.suggestions } : {}) },
                MASTER,
              )
              if (reason) setAiError(reason)
            }
          } else {
            const { text, suggestions, changes, verification, claims } = await runMasterTurn(master, current, {
              ...common,
              // Инструменты: ведущий меняет игру только через них, движок проверяет каждый вызов.
              runtime: {
                getStory: () => (appStore.getState().active?.id === story.id ? appStore.getState().active! : current),
                commit: (event, author) => appStore.dispatchTo(story.id, event, author),
                tools: { catalog: itemCatalog, rules: rulesData, prices: priceList, now: () => Date.now(), newId: () => crypto.randomUUID() },
                // Журнал разработчика: каждый вызов инструмента и его итог — чтобы видеть, где потерялось изменение.
                onTool: (call, outcome) => {
                  recorder.tool(call, outcome)
                  devLog.add({ kind: 'tool', name: call.name, ok: outcome.ok, detail: String(outcome.result.error ?? outcome.result.message ?? '') })
                },
                onRound: () => {
                  streamed = ''
                  setStreamText('')
                },
              },
            })
            if (text)
              await appStore.dispatchTo(
                story.id,
                outOfGame
                  ? { type: 'masterNarrated', messageId: crypto.randomUUID(), text, ooc: true }
                  : { type: 'masterNarrated', messageId: crypto.randomUUID(), text, ...(suggestions.length ? { suggestions } : {}) },
                MASTER,
              )
            // Строка изменений за ход — после ответа ведущего: игрок видит, что рассказ отразился в листе.
            if (changes.length) await appStore.dispatchTo(story.id, { type: 'turnSummarized', messageId: crypto.randomUUID(), changes }, ENGINE)
            recorder.finish(verification, claims)
            if (verification.status !== 'skipped') devLog.add({ kind: 'verify', ...verification })
            if (claims) devLog.add({ kind: 'claims', problems: claims })
            // Ведущий не разрешил и не прервал отдых — отряд отдыхает (но не после ответа вне игры).
            if (!outOfGame) completePendingRest()
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
      const message = error instanceof AiError ? error.message : 'Ведущий не ответил из-за неизвестной ошибки.'
      recorder.fail(cancelledRef.current ? 'Отменено игроком.' : controller.signal.aborted ? 'Прервано (игрок ушёл с экрана).' : `${message}${error instanceof AiError ? ` [${error.kind}${error.stage ? `, ${error.stage}` : ''}]` : ` [${error instanceof Error ? error.message : String(error)}]`}`)
      if (!(error instanceof AiError) && !controller.signal.aborted) console.error('Ход ведущего не удался.', error)
      if (cancelledRef.current) setAiError('Ответ ведущего отменён. Всё, что ведущий успел сделать инструментами, сохранено.')
      else if (controller.signal.aborted) return
      else setAiError(message)
    } finally {
      if (!controller.signal.aborted || cancelledRef.current) finish()
    }
    // Сжатие памяти — в фоне после ответа, игрок не ждёт.
    // Ход закончился (ответом или ошибкой ведущего) — карта сменилась или нет? Отмену игроком не считаем.
    if (!outOfGame && !rewriteId && !cancelledRef.current) watchExit()
    if (ok && !outOfGame) void compactNow('budget', session, false)
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
    const options = { verbosity: ai.settings.verbosity, context: { catalog: itemCatalog, rules: rulesData, prices: priceList }, ...session.compact, force }
    if (!force && !compactionNeeded(active, options)) return
    const controller = new AbortController()
    compactAbortRef.current = controller
    const run = (async () => {
      setCompacting(true)
      try {
        const result = await compactMemory(
          timedFor(session.compactor, 'compact', session.compactModel, { signal: controller.signal }),
          {
            getStory: () => {
              const now = appStore.getState().active
              if (!now || now.id !== story.id) throw new AiError('aborted')
              return now
            },
            commit: (event, author) => appStore.dispatchTo(story.id, event, author),
            tools: { catalog: itemCatalog, rules: rulesData, prices: priceList, now: () => Date.now(), newId: () => crypto.randomUUID() },
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
  const lastMessage = lastNarrative(story.messages)
  const suggestions = lastMessage?.author === 'master' && !waiting ? (lastMessage.suggestions ?? []) : []

  /** Окно «Отдых». */
  const [restOpen, setRestOpen] = useState(false)

  /** Завершить отдых, о котором попросил игрок: броски движка, итог и строка изменений «что восстановилось». */
  const completePendingRest = () => {
    const current = appStore.getState().active
    if (!current || current.id !== story.id || !current.pendingRest) return
    const { kind, hitDice } = current.pendingRest
    const events = restEvents(current, kind, hitDice, { rules: rulesData, now: () => Date.now(), newId: () => crypto.randomUUID() })
    for (const event of events) {
      const reason = appStore.dispatch(event, ENGINE)
      if (reason) {
        setAiError(`Отдых не удался: ${reason}`)
        return
      }
    }
    const after = appStore.getState().active!
    const names = changeNames(rulesData)
    const changes = changeList(turnDelta(ledgerOf(current, itemCatalog), ledgerOf(after, itemCatalog)), after, itemCatalog, new Map(), names.spells, names.features)
    if (changes.length) appStore.dispatch({ type: 'turnSummarized', messageId: crypto.randomUUID(), changes }, ENGINE)
  }

  /** Игрок просит отдых: реплика в ленте, просьба (pendingRest) — и ведущий решает, безопасно ли здесь. */
  const handleRest = (kind: RestKind, hitDice: number): string | null => {
    const reason = appStore.dispatch({ type: 'restRequested', kind, hitDice: hitDice > 0 ? { [lead.heroId]: hitDice } : {} }, player(lead.heroId))
    if (reason) return reason
    const text = `Отдыхаем: ${REST_NAMES[kind].toLowerCase()}${hitDice > 0 ? `, трачу костей хитов: ${hitDice}` : ''}.`
    appStore.dispatch({ type: 'playerSpoke', heroId: lead.heroId, messageId: crypto.randomUUID(), text }, player(lead.heroId))
    void askMaster()
    return null
  }

  const handleSend = (text: string, mode: InputMode = 'action') => {
    // Накопленные перемещения по карте уходят ведущему вместе с репликой (вопрос вне игры их не забирает).
    const active = appStore.getState().active ?? story
    const move = mode === 'action' ? pendingMoveText(active, currentLocation(active), lead.heroId, MAP_REACTIONS) : null
    appStore.dispatch(
      {
        type: 'playerSpoke',
        heroId: lead.heroId,
        messageId: crypto.randomUUID(),
        text,
        ...(mode === 'question' ? { ooc: true } : {}),
        ...(move ? { move: move.slice(0, MAX_MOVE_TEXT) } : {}),
      },
      player(lead.heroId),
    )
    void askMaster()
  }

  /**
   * Значимое перемещение (правила — src/data/map-reactions.json) — короткая реакция ведущего сразу, без реплики игрока,
   * не чаще одной за cooldownSeconds. Иначе (или пока ведущий отвечает) перемещение копится до следующей реплики.
   */
  const waitingRef = useRef(false)
  const lastReactionRef = useRef<number | null>(null)
  const reactRef = useRef<(before: StoryState, heroId: string) => void>(() => {})
  useEffect(() => {
    waitingRef.current = waiting
    reactRef.current = (before, heroId) => {
      const after = appStore.getState().active
      if (!after || after.id !== story.id || after.outOfGame || waitingRef.current) return
      const where = currentLocation(after)
      const significance = moveSignificance(before, after, heroId, where, MAP_REACTIONS)
      if (!significance.rules.length) return
      const now = Date.now()
      if (!reactionDue(lastReactionRef.current, now, MAP_REACTIONS)) {
        devLog.add({ kind: 'map', rules: significance.rules, sent: false })
        return
      }
      const report = moveReportEvent(after, where, heroId, significance, MAP_REACTIONS, crypto.randomUUID())
      if (appStore.dispatch({ ...report, note: report.note.slice(0, MAX_MOVE_TEXT) }, ENGINE)) return
      lastReactionRef.current = now
      devLog.add({ kind: 'map', rules: significance.rules, sent: true })
      void askMaster()
    }
  })

  const handleRoll = (notation: string, mode: RollMode): string | null => {
    try {
      const record = { id: crypto.randomUUID(), timestamp: Date.now(), result: roll(notation, { mode }), manual: true }
      const reason = appStore.dispatch({ type: 'diceRolled', roll: record }, ENGINE)
      if (reason) return reason
      setAnimatedRollId(record.id)
      return null
    } catch (error) {
      if (error instanceof DiceError) return error.message
      throw error
    }
  }

  // Старое сохранение заклинателя: магия теперь часть листа — при загрузке предлагаем выбрать заклинания.
  const [spellDialog, setSpellDialog] = useState(() => !readOnly && needsSheetCompletion(lead.character, rulesData))
  const chooseSpells = ({ order, magic, weaponMasteries, languages, invocations }: SheetCompletion): string | null => {
    const as = player(lead.heroId)
    const heroId = lead.heroId
    if (order) {
      const armor = rulesData.classes[lead.character.classId]?.order?.options.find((o) => o.id === order)?.armor ?? []
      const reason = appStore.dispatch({ type: 'classOrderChosen', heroId, order, armor: [...armor] }, as)
      if (reason) return reason
    }
    const steps: StoryEvent[] = [
      ...(magic ? [{ type: 'spellsChosen' as const, heroId, magic }] : []),
      ...(invocations ? [{ type: 'invocationsChosen' as const, heroId, invocations }] : []),
      ...(weaponMasteries ? [{ type: 'weaponMasteriesChosen' as const, heroId, weapons: weaponMasteries }] : []),
      ...(languages ? [{ type: 'languagesChosen' as const, heroId, languages }] : []),
    ]
    for (const event of steps) {
      const reason = appStore.dispatch(event, as)
      if (reason) return reason
    }
    return null
  }
  const changeMasteries = (weapons: string[]) => appStore.dispatch({ type: 'weaponMasteriesChosen', heroId: lead.heroId, weapons }, player(lead.heroId))
  const prepareSpells = (prepared: string[]) => appStore.dispatch({ type: 'preparedSpellsChanged', heroId: lead.heroId, prepared }, player(lead.heroId))

  // Карта: игрок двигает своего героя (действие heroMoved через хранилище) и выбирает действия в меню у НПС и предметов.
  const movement = useMemo<HeroMovement | undefined>(() => {
    if (readOnly) return undefined
    const heroId = lead.heroId
    const doors = story.world.doors[location.id] ?? {}
    const blocker = heroBlocker(location, story, heroId)
    // quiet — перемещение — часть действия из меню («Подойти»): реплика уйдёт следом, реакция не нужна.
    const moveTo = (to: CellPosition, quiet = false) => {
      const before = appStore.getState().active ?? story
      const reason = appStore.dispatch({ type: 'heroMoved', heroId, to }, player(heroId))
      if (!reason && !quiet) reactRef.current(before, heroId)
      return reason
    }
    return {
      plan: (to) => heroMovePlan(location, story, heroId, to),
      reachable: () => heroReachable(location, story, heroId),
      path: (from, to) => walkPath(location, from, to, doors, (c) => blocker(c) !== null),
      move: moveTo,
      approach: (area) => {
        const near = approachCell(location, story, heroId, area)
        if (!near) return 'Не подойти: путь перекрыт.'
        return near.plan.path.length ? moveTo(near.cell, true) : null
      },
    }
  }, [readOnly, lead.heroId, location, story])
  // «Выйти» через выход карты: герой идёт к выходу; карта за ним есть — отряд переходит (действия движка) и ведущий
  // описывает новое место; карты ещё нет — ведущий получает событие, создаёт её (create_location) и переводит (travel).
  const leaveVia = (exitId: string): string | null => {
    const before = appStore.getState().active ?? story
    const heroId = lead.heroId
    const from = currentLocation(before)
    const exit = from.exits?.find((e) => e.id === exitId)
    if (!exit) return 'Такого выхода здесь нет.'
    const locked = exitLockProblem(before, from, exit)
    if (locked) return locked
    const hero = before.party.find((m) => m.heroId === heroId)!
    if (hero.position.x !== exit.x || hero.position.y !== exit.y) {
      const plan = heroMovePlan(from, before, heroId, exit)
      const near = typeof plan === 'string' ? approachCell(from, before, heroId, { x: exit.x, y: exit.y, w: 1, h: 1 }) : null
      const to = typeof plan === 'string' ? near?.cell : exit
      if (!to) return typeof plan === 'string' ? plan : 'Не дойти до выхода.'
      if (to.x !== hero.position.x || to.y !== hero.position.y) {
        const reason = appStore.dispatch({ type: 'heroMoved', heroId, to }, player(heroId))
        if (reason) return reason
      }
    }
    const now = appStore.getState().active ?? before
    const name = hero.character.name
    const target = exit.to ? now.world.locations[exit.to] : undefined
    let report: { text: string; note: string }
    if (!target) {
      report = { text: `${name}: уходит через «${exit.name}».`, note: missingMapNote(from, exit, name) }
      exitWatchRef.current = { from: from.id, exitId: exit.id, turns: 0 }
      setTravelStuck(null)
    }
    else {
      const plan = travelPlan(now, exit.id)
      if (typeof plan === 'string') return plan
      for (const event of plan.events) {
        const reason = appStore.dispatch(event, ENGINE)
        if (reason) return reason
      }
      report = { text: travelText(plan, name), note: travelNote(plan, name) }
    }
    const reason = appStore.dispatch({ type: 'heroMoveReported', heroId, messageId: crypto.randomUUID(), rules: ['exit'], text: report.text, note: report.note.slice(0, MAX_MOVE_TEXT) }, ENGINE)
    if (reason) return reason
    devLog.add({ kind: 'map', rules: ['exit'], sent: true })
    void askMaster()
    return null
  }
  /** «Повторить» у сообщения «Карта не сменилась»: снова просим ведущего создать место за выходом и перевести отряд. */
  const retryExit = () => {
    const stuck = travelStuck
    const now = appStore.getState().active
    if (!stuck || !now) return
    const from = currentLocation(now)
    const exit = from.exits?.find((e) => e.id === stuck.exitId)
    setTravelStuck(null)
    if (!exit) return
    const name = leadMember(now).character.name
    const reason = appStore.dispatch(
      { type: 'heroMoveReported', heroId: lead.heroId, messageId: crypto.randomUUID(), rules: ['exit'], text: `${name}: снова уходит через «${exit.name}».`, note: missingMapNote(from, exit, name, true).slice(0, MAX_MOVE_TEXT) },
      ENGINE,
    )
    if (reason) return setAiError(reason)
    exitWatchRef.current = { from: from.id, exitId: exit.id, turns: 0 }
    void askMaster()
  }
  const mapActions = useMemo<MapActions>(() => ({ send: (text) => handleSend(text), leave: leaveVia, disabled: waiting || readOnly }), [waiting, readOnly]) // eslint-disable-line react-hooks/exhaustive-deps

  // Видимость: что отряд видит сейчас (линия видимости, свет, тёмное зрение) и туман войны (исследованное копится
  // действием areaExplored — и при выключенном тумане, чтобы включить его можно было в любой момент).
  const appearance = useAppearance()
  const seenNow = useMemo(() => partyVision(location, story, rulesData), [location, story])
  useEffect(() => {
    if (readOnly) return
    const cells = newlyExplored(story, location, seenNow)
    if (cells.length) void appStore.dispatchTo(story.id, { type: 'areaExplored', locationId: location.id, cells }, SYSTEM)
  }, [seenNow, story, location, readOnly])
  const vision = useMemo<MapVision | undefined>(() => {
    if (!appearance.settings.fogOfWar) return undefined
    const explored = exploredCells(story, location)
    for (const k of seenNow) explored.add(k)
    return { visible: seenNow, explored }
  }, [appearance.settings.fogOfWar, story, location, seenNow])

  // Путь отряда над картой: локации по порядку прихода.
  const trailNames = useMemo(() => trailOf(story).map((id) => story.world.locations[id]?.name ?? id), [story])

  // Метки игрока: ставит, правит и убирает игрок своего героя (действия хранилища; проверки — src/game/marks.ts).
  const mapMarks = useMemo(() => marksOf(story.world, location.id), [story.world, location.id])
  const markEditor = useMemo<MarkEditor | undefined>(() => {
    if (readOnly) return undefined
    const heroId = lead.heroId
    return {
      place: (cell, icon, text) =>
        appStore.dispatch(
          { type: 'markPlaced', mark: { id: crypto.randomUUID(), heroId, locationId: location.id, x: cell.x, y: cell.y, icon, text, at: Date.now() } },
          player(heroId),
        ),
      edit: (markId, icon, text) => appStore.dispatch({ type: 'markEdited', markId, icon, text }, player(heroId)),
      remove: (markId) => appStore.dispatch({ type: 'markRemoved', markId }, player(heroId)),
    }
  }, [readOnly, lead.heroId, location.id])

  const companions = useMemo(
    () => story.party.filter((m) => m.heroId !== lead.heroId && !m.fallen).map((m) => ({ id: m.heroId, name: m.character.name, position: m.position })),
    [story.party, lead.heroId],
  )

  const handleEquipChange = (change: EquipmentChange): string | null => {
    const result = equipmentEvent(lead, itemCatalog, change)
    if (!result.ok) return result.reason
    return appStore.dispatch(result.event, player(lead.heroId))
  }

  return (
    <>
      <div className="layout">
        <main className="main-column">
          <MapPanel location={location} player={lead.position} doors={story.world.doors[location.id] ?? {}} movement={movement} actions={mapActions} ping={story.ping} vision={vision} shownArea={story.shownArea} companions={companions} marks={mapMarks} markEditor={markEditor} trail={trailNames} />
          <section className="panel story-panel">
            <NarrationLog
              messages={story.messages}
              pending={streamText}
              replacingId={replacingId}
              onRewrite={readOnly ? undefined : (messageId) => void askMaster(messageId)}
              rewriteDisabled={waiting}
              onCancel={canCancel ? cancelMaster : undefined}
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
            {travelStuck && !waiting && (
              <div className="master-error" role="alert" data-testid="travel-stuck">
                <p>
                  Карта не сменилась: ведущий не создал место за выходом «{travelStuck.name}» и не перевёл отряд. Можно попросить ещё раз.
                </p>
                <button type="button" className="item-action is-primary" onClick={retryExit}>
                  Повторить
                </button>
              </div>
            )}
            {aiError && (
              <div className="master-error" role="alert" data-testid="master-error">
                <p>{aiError}</p>
                <button type="button" className="item-action is-primary" onClick={retryMaster} disabled={waiting}>
                  Повторить
                </button>
                {/* Сбой ведущего — игра сама предлагает отчёт. */}
                <ReportButton className="item-action" hint={`Ошибка ведущего: ${aiError}`} testId="report-from-error" />
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
              <PlayerInput
                onSend={handleSend}
                disabled={waiting}
                suggestions={suggestions}
                aside={<ReportButton />}
                leading={
                  <>
                    <DiceTray rolls={story.rolls} onRoll={handleRoll} />
                    <RestButton
                      pending={Boolean(story.pendingRest)}
                      disabled={waiting || Boolean(story.pendingRest) || story.party.every((m) => restBlocker(m))}
                      onClick={() => setRestOpen(true)}
                    />
                  </>
                }
              />
            )}
          </section>
        </main>
        <InventoryPanel
          character={lead.character}
          inventory={lead.inventory}
          catalog={itemCatalog}
          onEquipChange={readOnly ? undefined : handleEquipChange}
          journal={{ memory: story.memory, facts: story.world.facts }}
          onPrepareSpells={readOnly ? undefined : prepareSpells}
          onChangeMasteries={readOnly ? undefined : changeMasteries}
          onChooseSpells={readOnly ? undefined : () => setSpellDialog(true)}
        />
      </div>
      {restOpen && !readOnly && <RestDialog character={lead.character} onRest={handleRest} onClose={() => setRestOpen(false)} />}
      {spellDialog && !readOnly && needsSheetCompletion(lead.character, rulesData) && (
        <SpellChoiceDialog character={lead.character} onSubmit={chooseSpells} onClose={() => setSpellDialog(false)} />
      )}
      {animatedRoll && <DiceRollOverlay key={animatedRoll.id} roll={animatedRoll} onDone={hideRoll} />}
    </>
  )
}

export default App
