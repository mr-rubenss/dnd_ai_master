import { useDevLog, devLog, type DevLogEntry } from '../game/devLog'
import { PROMPT_PARTS } from '../game/masterPrompt'

const PURPOSES: Record<string, string> = {
  turn: 'Ход ведущего',
  rewrite: 'Переписать ответ',
  compact: 'Сжатие ленты',
  resummarize: 'Пересжатие сводки',
  'merge-facts': 'Объединение фактов',
  epilogue: 'Итог истории',
}
const PART_LABELS: Record<string, string> = { ...PROMPT_PARTS, fragment: 'Фрагмент ленты', story: 'История', rules: 'Правила и промт' }
const REASONS = { budget: 'запрос больше бюджета', 'context-error': 'ошибка «слишком длинный контекст»', size: 'разрослись сводка или факты' }

const n = (v: number) => v.toLocaleString('ru-RU')
const time = (at: number) => new Date(at).toLocaleTimeString('ru-RU')

function EntryView({ entry }: { entry: DevLogEntry }) {
  if (entry.kind === 'request') {
    const u = entry.usage
    const cached = u?.cachedInputTokens
    return (
      <li className="dev-log-entry" data-testid="dev-log-request" data-purpose={entry.purpose}>
        <strong>
          {time(entry.at)} · {PURPOSES[entry.purpose] ?? entry.purpose} · {entry.model}
        </strong>
        <span>
          Оценка ≈{n(entry.estimatedTokens)} ток.
          {u ? ` · пришло: вход ${n(u.inputTokens)}, ответ ${n(u.outputTokens)}` : ' · расход не сообщён'}
          {u && cached !== null && cached !== undefined
            ? ` · из кэша ${n(cached)} (${u.inputTokens ? Math.round((cached / u.inputTokens) * 100) : 0}%)`
            : ''}
        </span>
        <span data-testid="dev-log-parts">{entry.parts.map((p) => `${PART_LABELS[p.label] ?? p.label} ${n(p.tokens)}`).join(' · ')}</span>
        {entry.dropped > 0 && <span className="dev-log-warn">Не влезло в окно — убрано старых сообщений: {entry.dropped}</span>}
      </li>
    )
  }
  if (entry.kind === 'compaction')
    return (
      <li className="dev-log-entry" data-testid="dev-log-compaction">
        <strong>
          {time(entry.at)} · Сжатие памяти ({REASONS[entry.reason]}) · {entry.model}
        </strong>
        <span>
          Сжато сообщений: {entry.compacted} · запрос ≈{n(entry.tokensBefore)} → ≈{n(entry.tokensAfter)} ток. · сводка {n(entry.summaryChars)} симв.
          {entry.factsAdded ? ` · новых фактов: ${entry.factsAdded}` : ''}
          {entry.resummarized ? ' · сводка пересжата' : ''}
          {entry.factsMerged ? ' · факты объединены' : ''}
        </span>
      </li>
    )
  return (
    <li className="dev-log-entry is-error" data-testid="dev-log-error">
      <strong>{time(entry.at)} · Ошибка</strong>
      <span>{entry.text}</span>
    </li>
  )
}

/** Журнал разработчика: запросы к модели по частям, кэш, сжатия памяти. Без текстов сообщений и без ключа. */
export function DevLogView() {
  const entries = useDevLog()
  return (
    <details className="appearance-section dev-log" data-testid="dev-log">
      <summary>Журнал разработчика ({entries.length})</summary>
      <p className="appearance-hint">
        Размер каждой части запроса (оценка), сколько токенов поставщик взял из кэша, когда и сколько сжато. Только до перезагрузки страницы.
      </p>
      {entries.length === 0 ? (
        <p className="appearance-hint">Пока пусто — сделайте ход в игре.</p>
      ) : (
        <>
          <ol className="dev-log-list">
            {[...entries].reverse().map((e) => (
              <EntryView key={e.id} entry={e} />
            ))}
          </ol>
          <button type="button" className="secondary-button" onClick={devLog.clear}>
            Очистить
          </button>
        </>
      )}
    </details>
  )
}
