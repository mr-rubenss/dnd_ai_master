import { useEffect, useRef, useState, type FormEvent, type TouchEvent } from 'react'
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

/** На сколько пикселей потянуть шторку вниз, чтобы она закрылась. */
const SWIPE_CLOSE_PX = 80
const MOBILE_QUERY = '(max-width: 768px)'

interface Props {
  rolls: RollRecord[]
  /** Бросает кубики; возвращает текст ошибки или null. */
  onRoll: (notation: string, mode: RollMode) => string | null
}

/**
 * «Игровой стол»: круглая кнопка с d20 и бейджем последнего броска.
 * Открывает окно бросков — всплывающее над кнопкой на десктопе и шторку снизу на телефоне.
 */
export function DiceTray({ rolls, onRoll }: Props) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<RollMode>('normal')
  const [custom, setCustom] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [dragY, setDragY] = useState(0)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const logRef = useRef<HTMLOListElement>(null)
  const dragStart = useRef<number | null>(null)
  // Смещение дублируется в ref: touchend может прийти раньше, чем React применит последнее setDragY.
  const dragDistance = useRef(0)

  const close = (returnFocus = true) => {
    setOpen(false)
    setDragY(0)
    dragDistance.current = 0
    if (returnFocus) buttonRef.current?.focus()
  }

  // Закрытие по нажатию вне окна и по Esc.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) close(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    dialogRef.current?.focus()
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Свайп вниз закрывает шторку (только на телефоне и только когда журнал прокручен к началу).
  const onTouchStart = (event: TouchEvent) => {
    const fromLog = logRef.current?.contains(event.target as Node)
    if (!window.matchMedia(MOBILE_QUERY).matches || (fromLog && (logRef.current?.scrollTop ?? 0) > 0)) {
      dragStart.current = null
      return
    }
    dragStart.current = event.touches[0].clientY
    dragDistance.current = 0
  }
  const onTouchMove = (event: TouchEvent) => {
    if (dragStart.current === null) return
    dragDistance.current = Math.max(0, event.touches[0].clientY - dragStart.current)
    setDragY(dragDistance.current)
  }
  const onTouchEnd = () => {
    if (dragStart.current === null) return
    dragStart.current = null
    if (dragDistance.current > SWIPE_CLOSE_PX) {
      close()
    } else {
      dragDistance.current = 0
      setDragY(0)
    }
  }

  const rollQuick = (sides: number) => {
    // Преимущество и помеха имеют смысл только для d20.
    setError(onRoll(`1d${sides}`, sides === 20 ? mode : 'normal'))
  }

  const rollCustom = (event: FormEvent) => {
    event.preventDefault()
    event.stopPropagation() // форма вложена в форму ответа игрока
    if (custom.trim()) setError(onRoll(custom, mode))
  }

  const latest = rolls.at(-1)
  const badgeClass = latest?.result.critical === 'success' ? ' is-nat20' : latest?.result.critical === 'failure' ? ' is-nat1' : ''

  return (
    <div className={`dice-tray${open ? ' is-open' : ''}`} ref={wrapperRef}>
      <button
        ref={buttonRef}
        type="button"
        className="dice-tray-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="dice-tray-dialog"
        aria-label={latest ? `Игровой стол. Последний бросок: ${latest.result.total}` : 'Игровой стол'}
        title="Игровой стол"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="dice-tray-icon">
          <polygon points="12,1.5 21.5,7 21.5,17 12,22.5 2.5,17 2.5,7" />
          <polygon points="12,6 17,15 7,15" />
          <path d="M12 1.5 12 6 M21.5 7 17 15 M2.5 7 7 15 M12 22.5 7 15 M12 22.5 17 15 M2.5 17 7 15 M21.5 17 17 15" />
        </svg>
        {latest && <span className={`dice-tray-badge${badgeClass}`}>{latest.result.total}</span>}
      </button>

      {open && (
        <>
          <div className="dice-tray-backdrop" aria-hidden="true" onPointerDown={() => close(false)} />
          <div
            id="dice-tray-dialog"
            ref={dialogRef}
            className={`dice-tray-dialog${dragY > 0 ? ' is-dragging' : ''}`}
            role="dialog"
            aria-label="Игровой стол"
            tabIndex={-1}
            style={dragY > 0 ? { transform: `translateY(${dragY}px)` } : undefined}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchEnd}
          >
            <div className="dice-tray-handle" aria-hidden="true" />
            <header className="dice-tray-header">
              <h2>Игровой стол</h2>
              <button type="button" className="dice-tray-close" aria-label="Закрыть" onClick={() => close()}>
                ×
              </button>
            </header>

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
              <div className="dice-custom" role="group" aria-label="Своя формула">
                <input
                  value={custom}
                  onChange={(event) => {
                    setCustom(event.target.value)
                    setError(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') rollCustom(event)
                  }}
                  placeholder="1d20+5, 4d6kh3…"
                  aria-label="Своя формула броска"
                  aria-invalid={error !== null}
                  spellCheck={false}
                  autoComplete="off"
                  enterKeyHint="go"
                />
                <button type="button" disabled={!custom.trim()} onClick={rollCustom}>
                  Бросить
                </button>
              </div>
              {error && (
                <p className="dice-error" role="alert">
                  {error}
                </p>
              )}
            </div>

            {rolls.length === 0 ? (
              <p className="dice-empty">Бросков пока не было.</p>
            ) : (
              <ol className="dice-log" aria-label="Журнал бросков" ref={logRef}>
                {[...rolls].reverse().map((record, index) => (
                  <RollEntry key={record.id} record={record} isNew={index === 0} />
                ))}
              </ol>
            )}
          </div>
        </>
      )}
    </div>
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
