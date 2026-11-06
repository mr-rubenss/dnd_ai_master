// Выбор заклинаний: шаг «Заклинания» при создании, окно выбора для старых заклинателей и «Изменить подготовленные».
// Описание заклинания (SpellDetails) — общее с вкладкой «Магия».
import { useState } from 'react'
import { rulesData } from '../data'
import { ABILITY_NAMES, formatModifier, type Ability } from '../engine/abilities'
import {
  classSpellcasting,
  classSpellList,
  featureSpellIds,
  fixedInitiateList,
  INITIATE_CANTRIPS,
  INITIATE_LIST_NAMES,
  initiateListOf,
  bestInnateAbility,
  spellcastingStats,
  spellChoiceNeeds,
  spellLimits,
  speciesSpellGrants,
  type MagicSubject,
  type SpellChoice,
} from '../game/magic'
import { INITIATE_LISTS, INNATE_ABILITIES, type SpellDefinition } from '../types/spells'
import { componentsText, effectText, spellMeta } from './spellText'

const rules = rulesData

/** Описание заклинания: время, дистанция, компоненты, длительность, текст. */
export function SpellDetails({ spell, stats }: { spell: SpellDefinition; stats?: { saveDc: number; attackBonus: number } }) {
  const effect = effectText(spell, stats)
  return (
    <div className="spell-details">
      <dl className="fact-list">
        <dt>Время</dt>
        <dd>
          {spell.castingTime}
          {spell.ritual ? ' (или ритуал: +10 минут, без ячейки)' : ''}
        </dd>
        <dt>Дистанция</dt>
        <dd>{spell.range}</dd>
        <dt>Компоненты</dt>
        <dd>{componentsText(spell)}</dd>
        <dt>Длительность</dt>
        <dd>{spell.duration}</dd>
        {effect && (
          <>
            <dt>Эффект</dt>
            <dd>{effect}</dd>
          </>
        )}
      </dl>
      <p>{spell.description}</p>
    </div>
  )
}

/** Строка выбора: заклинание (флажок) и кнопка описания. */
function SpellOption({ spell, checked, disabled, onToggle }: { spell: SpellDefinition; checked: boolean; disabled: boolean; onToggle: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <li className={`spell-option${checked ? ' is-checked' : ''}`} data-spell={spell.id}>
      <div className="spell-option-row">
        <button type="button" role="checkbox" aria-checked={checked} disabled={disabled} className="spell-option-toggle" onClick={onToggle}>
          <span className="spell-option-mark" aria-hidden="true">
            {checked ? '✓' : ''}
          </span>
          <span className="spell-option-name">{spell.name}</span>
          <span className="spell-option-meta">{spellMeta(spell)}</span>
        </button>
        <button
          type="button"
          className="link-button spell-option-more"
          aria-expanded={open}
          aria-label={`Описание: ${spell.name}`}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Скрыть' : 'Описание'}
        </button>
      </div>
      {open && <SpellDetails spell={spell} />}
    </li>
  )
}

/** Список для выбора ровно `count` заклинаний. */
export function SpellOptionList({
  label,
  options,
  selected,
  count,
  onChange,
  slot,
  note,
}: {
  label: string
  options: SpellDefinition[]
  selected: string[]
  count: number
  onChange: (next: string[]) => void
  /** data-slot для тестов. */
  slot: string
  note?: string
}) {
  return (
    <section className="skill-slot spell-slot" aria-label={label} data-slot={slot}>
      <h4>
        {label}
        <span className={`slot-count${selected.length === count ? ' is-done' : ''}`}>
          {selected.length} из {count}
        </span>
      </h4>
      {note && <p className="hint">{note}</p>}
      <ul className="spell-options">
        {options.map((spell) => {
          const checked = selected.includes(spell.id)
          return (
            <SpellOption
              key={spell.id}
              spell={spell}
              checked={checked}
              disabled={!checked && selected.length >= count}
              onToggle={() => onChange(checked ? selected.filter((id) => id !== spell.id) : [...selected, spell.id])}
            />
          )
        })}
      </ul>
    </section>
  )
}

function AbilityChoice({ label, value, onChange, testId }: { label: string; value: Ability; onChange: (a: Ability) => void; testId: string }) {
  return (
    <label className="field spell-ability">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as Ability)} data-testid={testId}>
        {INNATE_ABILITIES.map((a) => (
          <option key={a} value={a}>
            {ABILITY_NAMES[a]}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Заклинания, которые выбирает игрок: класса, книги, «Посвящённого в магию», характеристика заклинаний вида. */
export function SpellChoiceForm({
  subject,
  choice,
  onChange,
}: {
  subject: Omit<MagicSubject, 'magic'>
  choice: SpellChoice
  onChange: (next: SpellChoice) => void
}) {
  const needs = spellChoiceNeeds(subject, rules)
  const sc = classSpellcasting(subject.classId, rules)
  const limits = spellLimits(subject.classId, subject.level, rules, subject.classOrder)
  const alwaysPrepared = featureSpellIds(subject.classId, rules)
  const className = rules.classes[subject.classId]?.name ?? ''
  const set = (patch: Partial<SpellChoice>) => onChange({ ...choice, ...patch })
  const fixedList = fixedInitiateList(subject.backgroundId, rules)
  const initiateList = initiateListOf(subject, choice, rules)
  const initiateAbility = choice.initiateAbility ?? bestInnateAbility(subject.abilities)
  const speciesAbility = choice.speciesAbility ?? bestInnateAbility(subject.abilities)
  const classLevelOne = classSpellList(subject.classId, 1, rules).filter((sp) => !alwaysPrepared.includes(sp.id))
  const book = choice.spellbook
  const species = rules.species[subject.speciesId]
  const grants = speciesSpellGrants(subject.speciesId, subject.speciesOption, rules)

  return (
    <div className="spell-choice">
      {needs.classSpells && sc && (
        <>
          {alwaysPrepared.length > 0 && (
            <p className="hint" data-testid="feature-spells">
              Всегда подготовлено умениями класса (не входит в число подготовленных):{' '}
              {(rules.classes[subject.classId]?.featureSpells ?? []).map((f) => `«${rules.spells[f.spellId]?.name}» (${f.feature})`).join(', ')}.
            </p>
          )}
          <p className="hint" data-testid="spell-stats">
            Характеристика заклинаний — <strong>{ABILITY_NAMES[sc.ability]}</strong>: Сл спасброска{' '}
            <strong>{spellcastingStats(subject, sc.ability).saveDc}</strong>, бонус атаки заклинанием{' '}
            <strong>{formatModifier(spellcastingStats(subject, sc.ability).attackBonus)}</strong>.
          </p>
          {limits.cantrips > 0 && (
            <SpellOptionList
              label={`Заговоры (${className})`}
              slot="cantrips"
              options={classSpellList(subject.classId, 0, rules)}
              selected={choice.cantrips}
              count={limits.cantrips}
              onChange={(cantrips) => set({ cantrips })}
            />
          )}
          {sc.spellbook ? (
            <>
              <SpellOptionList
                label="Книга заклинаний"
                slot="spellbook"
                note="Заклинания 1-го круга, записанные в книгу. Ритуалы из книги можно творить без подготовки."
                options={classLevelOne}
                selected={book}
                count={limits.spellbook}
                onChange={(spellbook) => set({ spellbook, prepared: choice.prepared.filter((id) => spellbook.includes(id)) })}
              />
              <SpellOptionList
                label="Подготовленные (из книги)"
                slot="prepared"
                options={classLevelOne.filter((s) => book.includes(s.id))}
                selected={choice.prepared}
                count={limits.prepared}
                onChange={(prepared) => set({ prepared })}
                note={book.length === 0 ? 'Сначала запишите заклинания в книгу.' : undefined}
              />
            </>
          ) : (
            <SpellOptionList
              label={`Подготовленные заклинания (${className})`}
              slot="prepared"
              options={classLevelOne}
              selected={choice.prepared}
              count={limits.prepared}
              onChange={(prepared) => set({ prepared })}
            />
          )}
        </>
      )}

      {needs.initiate && (
        <section className="creation-details" aria-label="Посвящённый в магию" data-testid="initiate-choice">
          <h3>Посвящённый в магию</h3>
          <p className="hint">
            {INITIATE_CANTRIPS} заговора и 1 заклинание 1-го круга из одного списка. Заклинание можно сотворить раз в день без ячейки (и ячейками, если они есть).
          </p>
          <div className="spell-initiate-fields">
            <label className="field">
              <span>Список заклинаний</span>
              <select
                value={initiateList ?? ''}
                disabled={Boolean(fixedList)}
                data-testid="initiate-list"
                onChange={(e) =>
                  set({ initiateList: (e.target.value || null) as SpellChoice['initiateList'], initiateCantrips: [], initiateSpell: null })
                }
              >
                {!initiateList && <option value="">— выберите —</option>}
                {INITIATE_LISTS.map((l) => (
                  <option key={l} value={l}>
                    {INITIATE_LIST_NAMES[l][0].toUpperCase() + INITIATE_LIST_NAMES[l].slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <AbilityChoice label="Характеристика заклинаний" value={initiateAbility} testId="initiate-ability" onChange={(initiateAbility) => set({ initiateAbility })} />
          </div>
          {fixedList && <p className="hint">Список задан предысторией.</p>}
          {initiateList && (
            <>
              <SpellOptionList
                label="Заговоры черты"
                slot="initiate-cantrips"
                options={classSpellList(initiateList, 0, rules)}
                selected={choice.initiateCantrips}
                count={INITIATE_CANTRIPS}
                onChange={(initiateCantrips) => set({ initiateCantrips })}
              />
              <SpellOptionList
                label="Заклинание 1-го круга черты"
                slot="initiate-spell"
                options={classSpellList(initiateList, 1, rules)}
                selected={choice.initiateSpell ? [choice.initiateSpell] : []}
                count={1}
                onChange={(next) => set({ initiateSpell: next.at(-1) ?? null })}
              />
            </>
          )}
        </section>
      )}

      {needs.species && (
        <section className="creation-details" aria-label="Магия вида" data-testid="species-magic">
          <h3>Магия вида: {species?.name}</h3>
          <p className="hint">
            {grants.map((g) => rules.spells[g.spellId]?.name).join(', ')} — без ячеек
            {grants.some((g) => g.uses) ? '; заклинание 1-го круга — число раз, равное бонусу мастерства, за долгий отдых' : ''}.
          </p>
          <AbilityChoice label="Характеристика заклинаний вида" value={speciesAbility} testId="species-ability" onChange={(speciesAbility) => set({ speciesAbility })} />
        </section>
      )}
    </div>
  )
}
