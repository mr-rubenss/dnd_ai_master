import { useEffect, useId, useRef, useState } from 'react'
import { AI_FORMATS, createMaster } from '../ai'
import { CHECK_TITLES, runConnectionCheck, type CheckId, type CheckResult } from '../ai/check'
import { AI_PRESETS, aiConnection, settingsProblems, VERBOSITY, type AiPresetId, type AiProvider, type Verbosity } from '../ai/settings'
import { aiSettingsStore, useAiSettings } from '../ai/settingsStore'
import type { AiDiagnostics, AiFormat } from '../ai/types'

const STATUS_LABELS: Record<CheckResult['status'], string> = { ok: 'Да', warn: 'Частично', fail: 'Нет', skipped: '—' }
const PROVIDERS: { id: AiProvider; name: string }[] = [
  ...(Object.keys(AI_PRESETS) as AiPresetId[]).map((id) => ({ id, name: AI_PRESETS[id].name })),
  { id: 'custom', name: 'Свой' },
]

/** Вкладка «Ведущий»: поставщик модели, адрес API, модель, ключ, длина ответов и проверка подключения. */
export function MasterSettings() {
  const { settings, apiKey } = useAiSettings()
  const [showKey, setShowKey] = useState(false)
  const [checking, setChecking] = useState(false)
  const [results, setResults] = useState<CheckResult[] | null>(null)
  const [diagnostics, setDiagnostics] = useState<AiDiagnostics | null>(null)
  const [copied, setCopied] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const id = useId()
  const update = aiSettingsStore.update
  const problems = settingsProblems(settings, apiKey)
  const preset = settings.provider === 'custom' ? null : AI_PRESETS[settings.provider]

  useEffect(() => () => abortRef.current?.abort(), [])

  const check = async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setChecking(true)
    setResults([])
    try {
      const master = createMaster(aiConnection(settings, apiKey))
      await runConnectionCheck(master, setResults, controller.signal)
    } finally {
      if (!controller.signal.aborted) setChecking(false)
    }
  }

  const diagnose = async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setChecking(true)
    setDiagnostics(null)
    setCopied(false)
    try {
      setDiagnostics(await createMaster(aiConnection(settings, apiKey)).diagnose({ maxLines: 20, signal: controller.signal }))
    } finally {
      if (!controller.signal.aborted) setChecking(false)
    }
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
    </div>
  )
}

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
