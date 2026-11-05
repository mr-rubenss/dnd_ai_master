import type { CheckCard } from '../types/game'

const MODE_LABELS = { normal: '', advantage: 'с преимуществом', disadvantage: 'с помехой' } as const

/** Карточка проверки в ленте: кто и зачем бросает, кубики, модификатор, итог против Сл и результат. */
export function CheckCardView({ card }: { card: CheckCard }) {
  const r = card.result
  const natural = r.roll?.natural ?? null
  const crit = natural === 20 ? ' is-nat20' : natural === 1 ? ' is-nat1' : ''
  const reasons = [...r.advantageReasons.map((x) => `преимущество: ${x}`), ...r.disadvantageReasons.map((x) => `помеха: ${x}`)]
  return (
    <article className={`check-card${r.success ? ' is-success' : ' is-failure'}${crit}`} data-testid="check-card" data-success={r.success}>
      <header className="check-card-head">
        <span className="check-card-label">
          {card.heroName}: {r.label}
        </span>
        <span className="check-card-dc">Сл {r.dc}</span>
      </header>
      <p className="check-card-reason">{card.reason}</p>
      <div className="check-card-roll">
        {r.roll ? (
          <>
            <span className="check-card-dice" aria-label="Кубики">
              {r.roll.groups[0].dice.map((d, i) => (
                <span
                  key={i}
                  className={`die-chip${d.kept ? '' : ' is-dropped'}${d.kept && d.value === 20 ? ' is-nat20' : ''}${d.kept && d.value === 1 ? ' is-nat1' : ''}`}
                >
                  {d.value}
                </span>
              ))}
            </span>
            <span className="check-card-mod">
              {r.modifier >= 0 ? '+' : '−'} {Math.abs(r.modifier)}
            </span>
            <span className="check-card-total" data-testid="check-total">
              = {r.total}
            </span>
          </>
        ) : (
          <span className="check-card-auto">Автоматический провал: {r.autoFailReason}</span>
        )}
        <span className="check-card-outcome">{r.success ? 'Успех' : 'Провал'}</span>
      </div>
      {(r.mode !== 'normal' || reasons.length > 0) && (
        <p className="check-card-mode">
          {MODE_LABELS[r.mode]}
          {reasons.length > 0 && ` (${reasons.join('; ')})`}
        </p>
      )}
    </article>
  )
}
