import { useId, useState } from 'react'
import { AI_FORMATS, AiError, createMaster } from '../ai'
import { CHECK_TITLES, runConnectionCheck, type CheckId, type CheckResult } from '../ai/check'
import {
  AI_PRESETS,
  aiConnection,
  DEFAULT_TARGET_TOKENS,
  MIN_CONTEXT_WINDOW,
  MIN_TARGET_TOKENS,
  isReasoningModel,
  settingsProblems,
  VERBOSITY, type AiPresetId, type AiProvider, type Verbosity } from '../ai/settings'
import { aiSettingsStore, useAiSettings } from '../ai/settingsStore'
import type { AiDiagnostics, AiFormat } from '../ai/types'
import { timeoutMessage } from '../ai/timed'
import { aiTimeouts } from '../ai/timeouts'
import { timedFor } from '../game/masterSession'
import { AiProgress, AiTaskError } from './AiTask'
import { DevLogView } from './DevLogView'
import { useAiTask } from './useAiTask'

const STATUS_LABELS: Record<CheckResult['status'], string> = { ok: 'Да', warn: 'Частично', fail: 'Нет', skipped: '—' }
const PROVIDERS: { id: AiProvider; name: string }[] = [
  ...(Object.keys(AI_PRESETS) as AiPresetId[]).map((id) => ({ id, name: AI_PRESETS[id].name })),
  { id: 'custom', name: 'Свой' },
]

/** Вкладка «Ведущий»: поставщик модели, адрес API, модель, ключ, длина ответов и проверка подключения. */
export function MasterSettings() {
  const { settings, apiKey } = useAiSettings()
  const [showKey, setShowKey] = useState(false)
  const task = useAiTask()
  const checking = task.state.status === 'running'
  const [results, setResults] = useState<CheckResult[] | null>(null)
  const [diagnostics, setDiagnostics] = useState<AiDiagnostics | null>(null)
  const [copied, setCopied] = useState(false)
  const id = useId()
  const update = aiSettingsStore.update
  const problems = settingsProblems(settings, apiKey)
  const preset = settings.provider === 'custom' ? null : AI_PRESETS[settings.provider]


  /** Проверка подключения и «Диагностика» — со сроками, индикатором и «Отменить» (общий AiProgress). */
  const check = async () => {
    setResults([])
    setDiagnostics(null)
    const model = aiConnection(settings, apiKey).model
    await task.run(`Проверяю: ${CHECK_TITLES.key.toLowerCase()}…`, async ({ signal, setStage }) => {
      const master = timedFor(createMaster(aiConnection(settings, apiKey)), 'check', model, { signal })
      const order = Object.keys(CHECK_TITLES) as CheckId[]
      await runConnectionCheck(
        master,
        (r) => {
          setResults(r)
          const next = order[r.length]
          if (next) setStage(`Проверяю: ${CHECK_TITLES[next].toLowerCase()}…`)
        },
        signal,
      )
    })
  }

  const diagnose = async () => {
    setDiagnostics(null)
    setResults(null)
    setCopied(false)
    const result = await task.run('Диагностика: жду сырой ответ сервера…', async ({ signal }) => {
      // У диагностики свой срок: общий из конфига, по истечении — понятная ошибка.
      const limit = aiTimeouts('default').totalMs
      const controller = new AbortController()
      const onAbort = () => controller.abort()
      signal.addEventListener('abort', onAbort, { once: true })
      let timedOut = false
      const timer = window.setTimeout(() => {
        timedOut = true
        controller.abort()
      }, limit)
      try {
        const d = await createMaster(aiConnection(settings, apiKey)).diagnose({ maxLines: 20, signal: controller.signal })
        if (timedOut) throw new AiError('timeout', { message: timeoutMessage('total', limit) })
        return d
      } finally {
        window.clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
      }
    })
    if (result.status === 'done') setDiagnostics(result.value)
  }

  const copyDiagnostics = async () => {
    if (!diagnostics) return
    try {
      await navigator.clipboard.writeText(diagnosticsText(diagnostics))
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="master-settings">
      <section className="appearance-section" aria-labelledby={`${id}-provider`}>
        <h3 id={`${id}-provider`}>Поставщик модели</h3>
        <div className="segmented appearance-segmented" role="radiogroup" aria-labelledby={`${id}-provider`}>
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={settings.provider === p.id}
              className={settings.provider === p.id ? 'is-active' : ''}
              onClick={() => (update({ provider: p.id }), setResults(null))}
              data-testid={`provider-${p.id}`}
            >
              {p.name}
            </button>
          ))}
        </div>

        {preset ? (
          <dl className="master-preset" data-testid="preset-info">
            <dt>Адрес API</dt>
            <dd>{preset.baseUrl}</dd>
            <dt>Модель</dt>
            <dd>{preset.model}</dd>
          </dl>
        ) : (
          <>
            <label className="appearance-label" htmlFor={`${id}-format`}>
              Формат API
            </label>
            <select
              id={`${id}-format`}
              className="appearance-select"
              value={settings.format}
              onChange={(e) => update({ format: e.target.value as AiFormat })}
              data-testid="api-format"
            >
              {(Object.keys(AI_FORMATS) as AiFormat[]).map((f) => (
                <option key={f} value={f}>
                  {AI_FORMATS[f]}
                </option>
              ))}
            </select>
            <label className="appearance-label" htmlFor={`${id}-url`}>
              Адрес API (base URL)
            </label>
            <input
              id={`${id}-url`}
              className="text-input"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://api.example.com/v1"
              value={settings.baseUrl}
              onChange={(e) => update({ baseUrl: e.target.value })}
              data-testid="api-base-url"
            />
            <p className="appearance-hint">Запросы идут на «адрес/chat/completions». Сюда же можно указать адрес своего прокси.</p>
            <label className="appearance-label" htmlFor={`${id}-model`}>
              Модель
            </label>
            <input
              id={`${id}-model`}
              className="text-input"
              autoComplete="off"
              spellCheck={false}
              placeholder="Например, gpt-4o-mini"
              value={settings.model}
              onChange={(e) => update({ model: e.target.value })}
              data-testid="api-model"
            />
          </>
        )}

        <label className="appearance-label" htmlFor={`${id}-key`}>
          Ключ API
        </label>
        <div className="api-key-row">
          <input
            id={`${id}-key`}
            className="text-input"
            type={showKey ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-…"
            value={apiKey}
            onChange={(e) => aiSettingsStore.setApiKey(e.target.value)}
            data-testid="api-key"
          />
          <button
            type="button"
            className="secondary-button"
            onClick={() => setShowKey((v) => !v)}
            aria-pressed={showKey}
            data-testid="api-key-toggle"
          >
            {showKey ? 'Скрыть' : 'Показать'}
          </button>
        </div>
        <p className="appearance-hint">
          Ключ хранится только в этом браузере и отправляется только по адресу API{preset ? ` (${preset.baseUrl})` : ''}. В игру, сайт и журналы он не
          попадает.
        </p>
      </section>

      <section className="appearance-section" aria-labelledby={`${id}-verbosity`}>
        <h3 id={`${id}-verbosity`}>Длина ответов ведущего</h3>
        <div className="segmented appearance-segmented" role="radiogroup" aria-labelledby={`${id}-verbosity`}>
          {(Object.keys(VERBOSITY) as Verbosity[]).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={settings.verbosity === v}
              className={settings.verbosity === v ? 'is-active' : ''}
              onClick={() => update({ verbosity: v })}
              data-testid={`verbosity-${v}`}
            >
              {VERBOSITY[v].name}
            </button>
          ))}
        </div>
      </section>

      <section className="appearance-section" aria-labelledby={`${id}-memory`}>
        <h3 id={`${id}-memory`}>Память ведущего</h3>
        <p className="appearance-hint">
          Когда запрос к модели становится больше целевого размера, ведущий в фоне сжимает старые события в сводку «Что было раньше»,
          а важное записывает в журнал фактов. Вся лента остаётся в истории.
        </p>
        <label className="appearance-label" htmlFor={`${id}-window`}>
          Окно контекста модели, токенов
        </label>
        {preset ? (
          <p className="appearance-hint" data-testid="context-window-preset">
            {preset.name}: {formatTokens(preset.contextWindow)} токенов.
          </p>
        ) : (
          <input
            id={`${id}-window`}
            className="text-input"
            type="number"
            inputMode="numeric"
            min={MIN_CONTEXT_WINDOW}
            step={1000}
            value={settings.contextWindow || ''}
            onChange={(e) => update({ contextWindow: Math.round(Number(e.target.value)) || 0 })}
            data-testid="context-window"
          />
        )}
        <label className="appearance-label" htmlFor={`${id}-target`}>
          Целевой размер запроса, токенов
        </label>
        <input
          id={`${id}-target`}
          className="text-input"
          type="number"
          inputMode="numeric"
          min={MIN_TARGET_TOKENS}
          step={1000}
          value={settings.targetTokens || ''}
          onChange={(e) => update({ targetTokens: Math.round(Number(e.target.value)) || 0 })}
          data-testid="target-tokens"
        />
        <p className="appearance-hint">
          Меньше — дешевле запросы и чаще сжатие; по умолчанию {formatTokens(DEFAULT_TARGET_TOKENS)}. Не больше окна контекста.
        </p>
        <label className="appearance-label" htmlFor={`${id}-compact-model`}>
          Модель для сжатия памяти
        </label>
        <input
          id={`${id}-compact-model`}
          className="text-input"
          autoComplete="off"
          spellCheck={false}
          placeholder={`Та же, что у ведущего (${aiConnection(settings, '').model || 'модель'})`}
          value={settings.compactModel}
          onChange={(e) => update({ compactModel: e.target.value })}
          data-testid="compact-model"
        />
        <p className="appearance-hint">Можно указать более дешёвую модель того же поставщика.</p>
      </section>

      <section className="appearance-section" aria-labelledby={`${id}-check`}>
        <h3 id={`${id}-check`}>Подключение</h3>
        {problems.length > 0 && (
          <ul className="master-problems" data-testid="master-problems">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <div className="master-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => void check()}
            disabled={checking || problems.length > 0}
            data-testid="check-connection"
          >
            {checking ? 'Проверяю…' : 'Проверить подключение'}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void diagnose()}
            disabled={checking || problems.length > 0}
            data-testid="diagnose"
          >
            Диагностика
          </button>
        </div>
        {isReasoningModel(aiConnection(settings, apiKey).model) && (
          <p className="hint proposal-warning" data-testid="reasoning-model-warning">
            «{aiConnection(settings, apiKey).model}» похожа на рассуждающую модель: перед ответом она долго «думает». Ведущий будет отвечать
            медленнее и дороже; для игры лучше обычная модель.
          </p>
        )}
        <AiProgress state={task.state} onCancel={task.cancel} />
        <AiTaskError state={task.state}>
          <button type="button" className="secondary-button" onClick={() => void check()}>
            Попробовать ещё раз
          </button>
        </AiTaskError>
        {results && (
          <ul className="check-results" aria-live="polite" data-testid="check-results">
            {(Object.keys(CHECK_TITLES) as CheckId[]).map((checkId) => {
              const r = results.find((x) => x.id === checkId)
              const status = r?.status ?? (checking ? 'pending' : 'skipped')
              return (
                <li key={checkId} className={`check-result is-${status}`} data-testid={`check-${checkId}`} data-status={status}>
                  <span className="check-status">{r ? STATUS_LABELS[r.status] : '…'}</span>
                  <span className="check-text">
                    <strong>{CHECK_TITLES[checkId]}</strong>
                    {r && <span>{r.detail}</span>}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        {diagnostics && (
          <div className="diagnostics" data-testid="diagnostics">
            <p className="appearance-hint">
              Тестовый запрос со стримингом и сырой ответ сервера — без ключа и без заголовка Authorization. Скопируйте и пришлите, если
              проверка не проходит. Браузер показывает только те заголовки, которые сервер разрешил (CORS).
            </p>
            <pre className="diagnostics-text" data-testid="diagnostics-text">
              {diagnosticsText(diagnostics)}
            </pre>
            <button type="button" className="secondary-button" onClick={() => void copyDiagnostics()} data-testid="diagnostics-copy">
              {copied ? 'Скопировано' : 'Скопировать'}
            </button>
          </div>
        )}
      </section>

      <DevLogView />
    </div>
  )
}

const formatTokens = (n: number) => n.toLocaleString('ru-RU')

/** Диагностика одним текстом: запрос, статус, заголовки, первые строки ответа. */
function diagnosticsText(d: AiDiagnostics): string {
  return [
    `Запрос: ${d.request}`,
    d.status === null ? `Ответа нет: ${d.error ?? 'неизвестная ошибка'}` : `HTTP ${d.status} ${d.statusText}`.trim(),
    '',
    'Заголовки ответа:',
    ...(d.headers.length ? d.headers.map(([n, v]) => `${n}: ${v}`) : ['(нет доступных)']),
    '',
    `Первые строки ответа (${d.lines.length}):`,
    ...(d.lines.length ? d.lines : ['(пусто)']),
    ...(d.error && d.status !== null ? ['', d.error] : []),
  ].join('\n')
}
