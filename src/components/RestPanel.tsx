// Отдых: кнопка у поля ввода и окно выбора (короткий с костями хитов или долгий); в листе — кости хитов и умения
// с применениями. Правила — src/game/rest.ts, решение «безопасно ли здесь» — за ведущим.
import { useId, useState, type FormEvent } from 'react'
import { rulesData } from '../data'
import { abilityModifier, formatModifier } from '../engine/abilities'
import { featureResources, hitDiceOf, REST_NAMES } from '../game/rest'
import type { Character } from '../types/character'
import type { RestKind } from '../types/story'

/** Кости хитов и умения с применениями — в начале вкладки «Характеристики». */
export function ResourcesSection({ character }: { character: Character }) {
  const hd = hitDiceOf(character, rulesData)
  const features = featureResources(character, rulesData)
  return (
    <section className="inventory-section resources" aria-label="Кости хитов и умения">
      <div className="slot-row" data-testid="hit-dice">
        <span className="slot-row-label">Кости хитов (к{hd.die})</span>
        <span className="slot-dots" role="img" aria-label={`Кости хитов: осталось ${hd.left} из ${hd.total}`}>
          {Array.from({ length: hd.total }, (_, i) => (
            <span key={i} className={`slot-dot${i >= hd.left ? ' is-spent' : ''}`} />
          ))}
        </span>
        <span className="slot-row-left">
          {hd.left}/{hd.total}
        </span>
      </div>
      {features.map((f) => (
        <div key={f.resource.id} className="slot-row" data-testid={`feature-${f.resource.id}`} title={f.resource.description}>
          <span className="slot-row-label">{f.resource.name}</span>
          {f.resource.pool ? (
            <span className="slot-pool" role="img" aria-label={`${f.resource.name}: в запасе ${f.left} из ${f.max}`}>
              запас
            </span>
          ) : (
            <span className="slot-dots" role="img" aria-label={`${f.resource.name}: осталось ${f.left} из ${f.max}`}>
              {Array.from({ length: f.max }, (_, i) => (
                <span key={i} className={`slot-dot${i < f.used ? ' is-spent' : ''}`} />
              ))}
            </span>
          )}
          <span className="slot-row-left">
            {f.left}/{f.max} · {f.resource.shortRest ? 'короткий отдых' : 'долгий отдых'}
          </span>
        </div>
      ))}
    </section>
  )
}

/** Кнопка «Отдых» у поля ввода. */
export function RestButton({ disabled, onClick, pending }: { disabled: boolean; onClick: () => void; pending: boolean }) {
  return (
    <button
      type="button"
      className="rest-button"
      aria-label={pending ? 'Отдых: ждём ведущего' : 'Отдых'}
      title={pending ? 'Ведущий решает, удастся ли отдохнуть' : 'Отдых'}
      disabled={disabled}
      onClick={onClick}
      data-testid="rest-button"
    >
      <span aria-hidden="true">⛺</span>
    </button>
  )
}

/** Окно отдыха: короткий (1 час, кости хитов) или долгий (8 часов). */
export function RestDialog({
  character,
  onRest,
  onClose,
}: {
  character: Character
  onRest: (kind: RestKind, hitDice: number) => string | null
  onClose: () => void
}) {
  const titleId = useId()
  const [kind, setKind] = useState<RestKind>('short')
  const hd = hitDiceOf(character, rulesData)
  const [dice, setDice] = useState(Math.min(hd.left, character.hp < character.maxHp ? 1 : 0))
  const [error, setError] = useState<string | null>(null)
  const con = abilityModifier(character.abilities.con)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const reason = onRest(kind, kind === 'short' ? dice : 0)
    setError(reason)
    if (!reason) onClose()
  }
  return (
    <div className="hero-dialog-backdrop">
      <form className="panel hero-dialog rest-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={submit} data-testid="rest-dialog">
        <header className="hero-dialog-header">
          <span className="hero-portrait" aria-hidden="true">
            ⛺
          </span>
          <div>
            <h3 id={titleId}>Отдых</h3>
            <p className="hero-meta">
              Хиты {character.hp}/{character.maxHp}. Ведущий решит, удастся ли отдохнуть здесь, — отдых могут прервать.
            </p>
          </div>
        </header>
        <div className="rest-dialog-body">
          <div className="segmented rest-kinds" role="radiogroup" aria-label="Вид отдыха">
            {(['short', 'long'] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'is-active' : undefined} onClick={() => setKind(k)}>
                {REST_NAMES[k]}
              </button>
            ))}
          </div>
          {kind === 'short' ? (
            <>
              <p className="hint">Восстанавливаются ячейки магии договора и умения «до короткого отдыха» («Второе дыхание» — одно применение).</p>
              <label className="field rest-dice">
                <span>
                  Потратить костей хитов (к{hd.die} {formatModifier(con)} каждая; осталось {hd.left} из {hd.total})
                </span>
                <input type="number" min={0} max={hd.left} value={dice} onChange={(e) => setDice(Math.max(0, Math.min(hd.left, Number(e.target.value) || 0)))} data-testid="rest-hit-dice" />
              </label>
            </>
          ) : (
            <p className="hint">
              Восстанавливаются все хиты и кости хитов, все ячейки и бесплатные сотворения, все умения; снимается один уровень
              Истощения. После отдыха можно сменить подготовленные заклинания.
            </p>
          )}
          {error && (
            <p className="equip-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="prepared-actions rest-dialog-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="primary-button">
            Отдыхать
          </button>
        </footer>
      </form>
    </div>
  )
}
