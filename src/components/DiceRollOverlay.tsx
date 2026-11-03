import { useEffect, useState } from 'react'
import { formatNotation } from '../engine/dice'
import type { RollRecord } from '../types/game'

const ROLL_MS = 700
const SHOW_MS = 2200

/** Контур кубика по числу граней (условно, для анимации). */
function dieShape(sides: number): string {
  switch (sides) {
    case 4:
      return '50,6 94,88 6,88'
    case 6:
      return '12,12 88,12 88,88 12,88'
    case 8:
      return '50,4 94,50 50,96 6,50'
    default:
      return '50,3 91,26 91,74 50,97 9,74 9,26'
  }
}

interface Props {
  roll: RollRecord
  onDone: () => void
}

/**
 * Анимация броска: кубик крутится, мелькают случайные грани, затем показывает результат.
 * Результат уже посчитан движком — мелькающие числа чисто декоративные.
 * Компонент монтируется заново для каждого броска (key = id броска).
 */
export function DiceRollOverlay({ roll, onDone }: Props) {
  const { result } = roll
  const sides = result.groups[0]?.sides ?? 20
  const finalFace = result.natural ?? result.total
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [settled, setSettled] = useState(reducedMotion)
  const [face, setFace] = useState(finalFace)

  useEffect(() => {
    if (settled) return
    const flicker = window.setInterval(() => setFace(1 + Math.floor(Math.random() * sides)), 70)
    const stop = window.setTimeout(() => {
      window.clearInterval(flicker)
      setFace(finalFace)
      setSettled(true)
    }, ROLL_MS)
    return () => {
      window.clearInterval(flicker)
      window.clearTimeout(stop)
    }
  }, [settled, sides, finalFace])

  useEffect(() => {
    if (!settled) return
    const hide = window.setTimeout(onDone, SHOW_MS)
    return () => window.clearTimeout(hide)
  }, [settled, onDone])

  const crit = settled && result.critical ? ` is-crit-${result.critical}` : ''

  return (
    <div className={`dice-overlay${settled ? ' is-settled' : ' is-rolling'}${crit}`} aria-hidden={!settled}>
      <div className="dice-overlay-die">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <polygon points={dieShape(sides)} />
        </svg>
        <span className="dice-overlay-face">{settled ? finalFace : face}</span>
      </div>
      {settled && (
        <div className="dice-overlay-caption" role="status">
          {roll.label && <span className="dice-overlay-label">{roll.label}</span>}
          <span>
            {formatNotation(result.notation)} = <strong>{result.total}</strong>
          </span>
          {result.critical === 'success' && <span className="dice-overlay-crit">Натуральная 20!</span>}
          {result.critical === 'failure' && <span className="dice-overlay-crit">Натуральная 1…</span>}
        </div>
      )}
    </div>
  )
}
