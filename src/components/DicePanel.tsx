import { useState, type FormEvent } from 'react'
import { formatNotation, type RollMode } from '../engine/dice'
import type { RollRecord } from '../types/game'

const QUICK_DICE = [4, 6, 8, 10, 12, 20, 100]

const MODE_OPTIONS: { mode: RollMode; label: string; title: string }[] = [
  { mode: 'normal', label: 'Обычный', title: 'Обычный бросок' },
  { mode: 'advantage', label: 'Преим.', title: 'Преимущество: 2к20, берётся больший' },
  { mode: 'disadvantage', label: 'Помеха', title: 'Помеха: 2к20, берётся меньший' },
]

const MODE_TAGS: Record<RollMode, string | null> = {
  normal: null,
  advantage: 'преим.',
  disadvantage: 'помеха',
}

interface Props {
  rolls: RollRecord[]
  /** Бросает кубики; возвращает текст ошибки или null. */
  onRoll: (notation: string, mode: RollMode) => string | null
}

/** Журнал бросков с быстрыми кнопками. Сворачивается. */
export function DicePanel({ rolls, onRoll }: Props) {
  const [open, setOpen] = useState(true)
  const [mode, setMode] = useState<RollMode>('normal')
  const [custom, setCustom] = useState('')
  const [error, setError] = useState<string | null>(null)

  const rollQuick = (sides: number) => {
    // Преимущество и помеха имеют смысл только для d20.
    setError(onRoll(`1d${sides}`, sides === 20 ? mode : 'normal'))
  }

  const rollCustom = (event: FormEvent) => {
    event.preventDefault()
    if (!custom.trim()) return
    setError(onRoll(custom, mode))
  }

  const latest = rolls.at(-1)

  return (
    <section className={`panel dice-panel${open ? ' is-open' : ''}`} aria-label="Броски кубиков">
      <button type="button" className="dice-toggle" aria-expanded={open} aria-controls="dice-content" onClick={() => setOpen((v) => !v)}>
        <span>Броски</span>
        <span className="dice-toggle-meta">
          {!open && latest && <span>последний: {latest.result.total} · </span>}
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div id="dice-content" className="dice-content">
          <div className="dice-controls">
            <div className="dice-modes" role="radiogroup" aria-label="Режим броска d20">
              {MODE_OPTIONS.map((option) => (
                <button
                  key={option.mode}
                  type="button"
                  role="radio"
                  aria-checked={mode === option.mode}
                  className={mode === option.mode ? 'is-active' : undefined}
                  title={option.title}
                  aria-label={option.title}
                  onClick={() => setMode(option.mode)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="dice-quick">
              {QUICK_DICE.map((sides) => (
                <button key={sides} type="button" onClick={() => rollQuick(sides)} title={`Бросить 1к${sides}`}>
                  к{sides}
                </button>
              ))}
            </div>
            <form className="dice-custom" onSubmit={rollCustom}>
              <input
                value={custom}
                onChange={(event) => {
                  setCustom(event.target.value)
                  setError(null)
                }}
                placeholder="1d20+5, 4d6kh3…"
                aria-label="Своя формула броска"
                aria-invalid={error !== null}
                spellCheck={false}
                autoComplete="off"
              />
              <button type="submit" disabled={!custom.trim()}>
                Бросить
              </button>
            </form>
            {error && (
              <p className="dice-error" role="alert">
                {error}
              </p>
            )}
          </div>

          {rolls.length === 0 ? (
            <p className="dice-empty">Бросков пока не было.</p>
          ) : (
            <ol className="dice-log" aria-label="Журнал бросков">
              {[...rolls].reverse().map((record, index) => (
                <RollEntry key={record.id} record={record} isNew={index === 0} />
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  )
}

function RollEntry({ record, isNew }: { record: RollRecord; isNew: boolean }) {
  const { result } = record
  const time = new Date(record.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const tag = MODE_TAGS[result.mode]
  const critClass = result.critical ? ` is-crit-${result.critical}` : ''

  return (
    <li className={`roll-entry${critClass}${isNew ? ' is-new' : ''}`}>
      <div className="roll-head">
        <span className="roll-label">
          {record.label ?? formatNotation(result.notation)}
          {record.label && <span className="roll-notation"> {formatNotation(result.notation)}</span>}
          {tag && <span className="roll-tag">{tag}</span>}
        </span>
        <time className="roll-time">{time}</time>
      </div>
      <div className="roll-body">
        <span className="roll-dice">
          {result.groups.map((group, gi) => (
            <span key={gi} className="roll-group">
              {(gi > 0 || group.sign < 0) && <span className="roll-op">{group.sign < 0 ? '−' : '+'}</span>}
              {group.dice.map((die, di) => {
                const nat = die.sides === 20 && die.kept && (die.value === 20 || die.value === 1)
                return (
                  <span
                    key={di}
                    className={`die-chip${die.kept ? '' : ' is-dropped'}${nat ? (die.value === 20 ? ' is-nat20' : ' is-nat1') : ''}`}
                    title={`к${die.sides}${die.kept ? '' : ' — отброшен'}`}
                  >
                    {die.value}
                  </span>
                )
              })}
            </span>
          ))}
          {result.modifier !== 0 && (
            <span className="roll-mod">
              {result.modifier < 0 ? '−' : '+'} {Math.abs(result.modifier)}
            </span>
          )}
        </span>
        <span className="roll-total" aria-label={`Итог ${result.total}`}>
          {result.total}
        </span>
      </div>
      {result.critical && (
        <div className="roll-crit">{result.critical === 'success' ? 'Натуральная 20!' : 'Натуральная 1'}</div>
      )}
    </li>
  )
}
