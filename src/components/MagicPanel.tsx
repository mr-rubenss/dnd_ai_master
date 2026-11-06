// Вкладка «Магия» листа персонажа: характеристика заклинаний, Сл и бонус атаки, ячейки кружками (закрашены — потрачены),
// заговоры, заклинания по кругам, книга Волшебника, магия черт и вида. Нажатие раскрывает описание.
// «Изменить подготовленные» — с проверкой лимита класса. Окно выбора заклинаний для старых заклинателей — SpellChoiceDialog.
import { useId, useState, type FormEvent } from 'react'
import { rulesData } from '../data'
import { ABILITY_NAMES, formatModifier } from '../engine/abilities'
import {
  choiceFromMagic,
  classSpellcasting,
  classSpellList,
  knownSpells,
  magicFromChoice,
  magicProblems,
  preparedProblems,
  spellcastingStats,
  spellLimits,
  spellSlots,
  swapRuleText,
  type KnownSpell,
  type SpellChoice,
} from '../game/magic'
import type { Character } from '../types/character'
import type { CharacterMagic } from '../types/spells'
import { Flash } from './Flash'
import { SpellChoiceForm, SpellDetails, SpellOptionList } from './SpellPicker'
import { spellLevelText, spellMeta } from './spellText'

const rules = rulesData

function SpellRow({ known, character }: { known: KnownSpell; character: Character }) {
  const [open, setOpen] = useState(false)
  const { spell, innate } = known
  const stats = spellcastingStats(character, known.ability)
  const free = innate && innate.freeMax !== null ? `бесплатно: ${innate.freeMax - innate.freeUsed} из ${innate.freeMax} до долгого отдыха` : ''
  return (
    <li className={`magic-spell${open ? ' is-open' : ''}`} data-spell={spell.id}>
      <button type="button" className="magic-spell-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="magic-spell-name">{spell.name}</span>
        <span className="magic-spell-meta">
          {spellMeta(spell)}
          {known.inBookOnly ? ' · в книге, не подготовлено' : ''}
          {known.source !== 'class' ? ` · ${known.sourceName}` : ''}
          {free ? ` · ${free}` : ''}
        </span>
      </button>
      {open && <SpellDetails spell={spell} stats={stats} />}
    </li>
  )
}

/** Ячейки одного круга кружками: закрашены — потрачены. */
function SlotDots({ level, total, used, pact }: { level: number; total: number; used: number; pact: boolean }) {
  const label = `${pact ? 'Магия договора' : 'Ячейки'} ${level}-го круга: осталось ${total - used} из ${total}`
  return (
    <div className="slot-row" data-testid={`slots-${level}`}>
      <span className="slot-row-label">
        {pact ? `Договор · ${level}-й круг` : `${level}-й круг`}
      </span>
      <Flash value={used}>
        <span className="slot-dots" role="img" aria-label={label}>
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={`slot-dot${i < used ? ' is-spent' : ''}`} />
          ))}
        </span>
      </Flash>
      <span className="slot-row-left">
        {total - used}/{total}
      </span>
    </div>
  )
}

function PreparedEditor({ character, onSave, onCancel }: { character: Character; onSave: (prepared: string[]) => string | null; onCancel: () => void }) {
  const magic = character.magic!
  const [prepared, setPrepared] = useState(magic.prepared)
  const [error, setError] = useState<string | null>(null)
  const limits = spellLimits(character.classId, character.level, rules)
  const options = classSpellList(character.classId, 1, rules).filter((s) => !magic.spellbook || magic.spellbook.includes(s.id))
  const problem = preparedProblems(character.classId, character.level, prepared, rules, magic.spellbook)[0]
  return (
    <div className="prepared-editor" data-testid="prepared-editor">
      <p className="hint">{swapRuleText(character.classId, rules)} Пока отдыха в игре нет — подготовленные можно изменить здесь.</p>
      <SpellOptionList
        label={magic.spellbook ? 'Подготовленные (из книги)' : 'Подготовленные заклинания'}
        slot="prepared"
        options={options}
        selected={prepared}
        count={limits.prepared}
        onChange={setPrepared}
      />
      {(error ?? problem) && (
        <p className="equip-error" role="alert">
          {error ?? problem}
        </p>
      )}
      <div className="prepared-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Отмена
        </button>
        <button type="button" className="primary-button" disabled={Boolean(problem)} onClick={() => setError(onSave(prepared))}>
          Сохранить
        </button>
      </div>
    </div>
  )
}

interface Props {
  character: Character
  /** Изменить подготовленные; возвращает причину отказа или null. Нет — только чтение. */
  onPrepare?: (prepared: string[]) => string | null
  /** Открыть окно выбора заклинаний (старое сохранение). */
  onChooseSpells?: () => void
  needsChoice: boolean
}

export function MagicPanel({ character, onPrepare, onChooseSpells, needsChoice }: Props) {
  const [editing, setEditing] = useState(false)
  const sc = classSpellcasting(character.classId, rules)
  const known = knownSpells(character, rules)
  const classKnown = known.filter((k) => k.source === 'class')
  const innate = known.filter((k) => k.source !== 'class')
  const slots = spellSlots(character, rules)
  const cantrips = classKnown.filter((k) => k.spell.level === 0)
  const levels = [...new Set(classKnown.filter((k) => k.spell.level > 0).map((k) => k.spell.level))].sort()
  const sources = [
    ...(sc ? [{ name: character.className, ability: sc.ability }] : []),
    ...[...new Map(innate.map((k) => [k.sourceName, { name: k.sourceName, ability: k.ability }])).values()],
  ]

  return (
    <div className="magic-panel">
      {needsChoice && (
        <div className="magic-choice-banner" role="status">
          <p>Заклинания героя ещё не выбраны — так было в старых сохранениях.</p>
          {onChooseSpells && (
            <button type="button" className="primary-button" onClick={onChooseSpells} data-testid="choose-spells">
              Выбрать заклинания
            </button>
          )}
        </div>
      )}

      <section className="inventory-section" aria-label="Характеристика заклинаний">
        <h3>Заклинатель</h3>
        <ul className="magic-sources">
          {sources.map((s) => {
            const stats = spellcastingStats(character, s.ability)
            return (
              <li key={s.name} data-testid="magic-source">
                <strong>{s.name}</strong>: {ABILITY_NAMES[s.ability]} · Сл спасброска <span data-testid="spell-dc">{stats.saveDc}</span> · атака заклинанием{' '}
                <span data-testid="spell-attack">{formatModifier(stats.attackBonus)}</span>
              </li>
            )
          })}
        </ul>
      </section>

      {slots.length > 0 && (
        <section className="inventory-section" aria-label="Ячейки заклинаний">
          <h3>Ячейки</h3>
          {slots.map((s) => (
            <SlotDots key={s.level} {...s} />
          ))}
          <p className="hint">{slots[0].pact ? 'Ячейки магии договора восстанавливаются после короткого или долгого отдыха.' : 'Ячейки восстанавливаются после долгого отдыха.'}</p>
        </section>
      )}

      {cantrips.length > 0 && (
        <section className="inventory-section" aria-label="Заговоры">
          <h3>Заговоры</h3>
          <ul className="magic-spells">
            {cantrips.map((k) => (
              <SpellRow key={k.spell.id} known={k} character={character} />
            ))}
          </ul>
        </section>
      )}

      {levels.map((level) => (
        <section key={level} className="inventory-section" aria-label={`Заклинания: ${spellLevelText(level)}`}>
          <h3>{spellLevelText(level)}</h3>
          <ul className="magic-spells">
            {classKnown
              .filter((k) => k.spell.level === level)
              .map((k) => (
                <SpellRow key={k.spell.id} known={k} character={character} />
              ))}
          </ul>
        </section>
      ))}

      {sc && character.magic && sc.prepared[0] > 0 && onPrepare && (
        <section className="inventory-section" aria-label="Подготовка заклинаний">
          {editing ? (
            <PreparedEditor
              character={character}
              onCancel={() => setEditing(false)}
              onSave={(prepared) => {
                const reason = onPrepare(prepared)
                if (!reason) setEditing(false)
                return reason
              }}
            />
          ) : (
            <button type="button" className="secondary-button" onClick={() => setEditing(true)} data-testid="edit-prepared">
              Изменить подготовленные
            </button>
          )}
        </section>
      )}

      {innate.length > 0 && (
        <section className="inventory-section" aria-label="Магия черт и вида">
          <h3>Магия черт и вида</h3>
          <ul className="magic-spells">
            {innate.map((k) => (
              <SpellRow key={`${k.innate?.key}`} known={k} character={character} />
            ))}
          </ul>
        </section>
      )}

      {known.length === 0 && !needsChoice && <p className="hint">Заклинаний нет.</p>}
    </div>
  )
}

/** Окно выбора заклинаний для героя из старого сохранения. */
export function SpellChoiceDialog({
  character,
  onSubmit,
  onClose,
}: {
  character: Character
  onSubmit: (magic: CharacterMagic) => string | null | Promise<string | null>
  onClose: () => void
}) {
  const titleId = useId()
  const [choice, setChoice] = useState<SpellChoice>(() => choiceFromMagic(character.magic))
  const [error, setError] = useState<string | null>(null)
  const magic = { ...magicFromChoice(character, choice, rules), slotsUsed: character.magic?.slotsUsed ?? {} }
  const problems = magicProblems(character, magic, rules)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (problems.length) return
    const reason = await onSubmit(magic)
    setError(reason)
    if (!reason) onClose()
  }
  const left = problems.length
  return (
    <div className="hero-dialog-backdrop">
      <form className="panel hero-dialog spell-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={submit} data-testid="spell-dialog">
        <header className="hero-dialog-header">
          <span className="hero-portrait" aria-hidden="true">
            ✨
          </span>
          <div>
            <h3 id={titleId}>Заклинания: {character.name}</h3>
            <p className="hero-meta">
              {character.className} {character.level} ур. Теперь магия — часть листа персонажа: выберите, что знает герой.
            </p>
          </div>
        </header>
        <div className="spell-dialog-body">
          <SpellChoiceForm subject={character} choice={choice} onChange={setChoice} />
        </div>
        <footer className="spell-dialog-footer">
          <p className="creation-problems" role="status">
            {error ?? problems[0] ?? ''}
          </p>
          <div className="prepared-actions">
            <button type="button" className="secondary-button" onClick={onClose}>
              Позже
            </button>
            <button type="submit" className="primary-button" disabled={left > 0}>
              Сохранить
            </button>
          </div>
        </footer>
      </form>
    </div>
  )
}
