// Отдых: кнопка у поля ввода и окно выбора (короткий с костями хитов или долгий); в листе — кости хитов и умения
// с применениями («Умения»), языки, приёмы оружия и воззвания. Правила — src/game/rest.ts и features.ts,
// решение «безопасно ли здесь» — за ведущим.
import { useId, useState, type FormEvent } from 'react'
import { rulesData } from '../data'
import { abilityModifier, formatModifier } from '../engine/abilities'
import { limitedUses } from '../game/features'
import { invocationLabel } from '../game/invocations'
import { languageNames } from '../game/languages'
import { hitDiceOf, REST_NAMES } from '../game/rest'
import { masteryRule, masterySwapText } from '../game/weaponMastery'
import { MASTERY_LABELS } from './itemText'
import { WeaponMasteryPicker } from './OriginPickers'
import type { Character } from '../types/character'
import type { RestKind } from '../types/story'

/** Кости хитов и «Умения» — все применения (класс, вид, воззвания, бесплатные сотворения) — в начале вкладки «Характеристики». */
export function ResourcesSection({ character }: { character: Character }) {
  const hd = hitDiceOf(character, rulesData)
  const uses = limitedUses(character, rulesData)
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
      {uses.length > 0 && (
        <>
          <h3 className="resources-heading">Умения</h3>
          {uses.map((u) => (
            <div key={u.key} className="slot-row" data-testid={`feature-${u.key}`} title={u.description}>
              <span className="slot-row-label">
                {u.name}
                <small className="slot-row-source">{u.sourceName}</small>
              </span>
              {u.pool ? (
                <span className="slot-pool" role="img" aria-label={`${u.name}: в запасе ${u.left} из ${u.max}`}>
                  запас
                </span>
              ) : (
                <span className="slot-dots" role="img" aria-label={`${u.name}: осталось ${u.left} из ${u.max}`}>
                  {Array.from({ length: u.max }, (_, i) => (
                    <span key={i} className={`slot-dot${i < u.used ? ' is-spent' : ''}`} />
                  ))}
                </span>
              )}
              <span className="slot-row-left">
                {u.left}/{u.max} · {u.recovery}
              </span>
            </div>
          ))}
        </>
      )}
    </section>
  )
}

/** Языки, приёмы оружия (смена после долгого отдыха) и таинственные воззвания. */
export function OriginSection({ character, onChangeMasteries }: { character: Character; onChangeMasteries?: (weapons: string[]) => string | null }) {
  const [changing, setChanging] = useState(false)
  const rule = masteryRule(character.classId, rulesData)
  const catalog = rulesData.catalog
  return (
    <section className="inventory-section origin" aria-label="Языки и приёмы">
      <dl className="fact-list">
        <dt>Языки</dt>
        <dd data-testid="languages-value">{character.languages?.length ? languageNames(character.languages, rulesData) : 'не выбраны'}</dd>
        {rule && (
          <>
            <dt>Приёмы оружия</dt>
            <dd data-testid="masteries-value">
              {character.weaponMasteries?.length
                ? character.weaponMasteries
                    .map((id) => {
                      const m = catalog[id]?.weapon?.mastery
                      return `${catalog[id]?.name ?? id}${m ? ` (${MASTERY_LABELS[m]})` : ''}`
                    })
                    .join(', ')
                : 'не выбраны'}
              {character.masterySwapReady && onChangeMasteries && character.weaponMasteries?.length ? (
                <>
                  {' '}
                  <button type="button" className="link-button" onClick={() => setChanging(true)} data-testid="change-masteries">
                    Сменить после отдыха
                  </button>
                </>
              ) : null}
            </dd>
          </>
        )}
        {character.invocations?.length ? (
          <>
            <dt>Воззвания</dt>
            <dd data-testid="invocations-value">
              {character.invocations.map((x) => (
                <span key={x.id} className="invocation-line" title={rulesData.invocations[x.id]?.description}>
                  {invocationLabel(x, rulesData)}
                </span>
              ))}
            </dd>
          </>
        ) : null}
      </dl>
      {changing && onChangeMasteries && <MasteryChangeDialog character={character} onSave={onChangeMasteries} onClose={() => setChanging(false)} />}
    </section>
  )
}

/** Смена приёмов оружия после долгого отдыха. */
function MasteryChangeDialog({ character, onSave, onClose }: { character: Character; onSave: (weapons: string[]) => string | null; onClose: () => void }) {
  const titleId = useId()
  const [weapons, setWeapons] = useState(character.weaponMasteries ?? [])
  const [error, setError] = useState<string | null>(null)
  const rule = masteryRule(character.classId, rulesData)!
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const reason = onSave(weapons)
    setError(reason)
    if (!reason) onClose()
  }
  return (
    <div className="hero-dialog-backdrop">
      <form className="panel hero-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={submit} data-testid="mastery-dialog">
        <header className="hero-dialog-header">
          <div>
            <h3 id={titleId}>Приёмы оружия</h3>
            <p className="hero-meta">{masterySwapText(rule)}</p>
          </div>
        </header>
        <div className="rest-dialog-body">
          <WeaponMasteryPicker subject={character} value={weapons} onChange={setWeapons} note={masterySwapText(rule)} />
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
            Сохранить
          </button>
        </footer>
      </form>
    </div>
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
