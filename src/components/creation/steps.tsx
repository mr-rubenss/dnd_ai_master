import { Fragment } from 'react'
import { itemCatalog, rulesData } from '../../data'
import { ABILITIES, ABILITY_ABBREVIATIONS, ABILITY_NAMES, abilityModifier, formatModifier } from '../../engine/abilities'
import { SKILL_DEFINITIONS, type SkillId } from '../../engine/skills'
import {
  abilityPool,
  assignScore,
  backgroundBonuses,
  chooseAbilityMethod,
  chooseBackground,
  chooseClass,
  chooseSpecies,
  expertiseCount,
  finalScores,
  grantedSkills,
  MAX_NAME_LENGTH,
  proficientSkills,
  recommendedAssignment,
  skillSlots,
  type CreationDraft,
} from '../../game/creation'
import type { EquipmentOption } from '../../types/rules'
import { ChoiceChip, OptionCard } from './OptionCard'

export interface StepProps {
  draft: CreationDraft
  update: (next: CreationDraft) => void
}

const data = rulesData
const abilityList = (abilities: readonly string[]) =>
  abilities.map((a) => ABILITY_NAMES[a as keyof typeof ABILITY_NAMES]).join(', ')
const skillList = (skills: readonly SkillId[]) => skills.map((s) => SKILL_DEFINITIONS[s].name).join(', ')

function Details({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="creation-details" aria-label={title}>
      <h3>{title}</h3>
      {children}
    </section>
  )
}

// ---------- Класс ----------

export function ClassStep({ draft, update }: StepProps) {
  const selected = draft.classId ? data.classes[draft.classId] : undefined
  return (
    <>
      <div className="option-grid" role="radiogroup" aria-label="Класс">
        {Object.values(data.classes).map((cls) => (
          <OptionCard
            key={cls.id}
            optionId={cls.id}
            selected={draft.classId === cls.id}
            onSelect={() => update(chooseClass(draft, cls.id))}
            title={cls.name}
            meta={`к${cls.hitDie} · ${abilityList(cls.primary)}`}
          >
            {cls.description}
          </OptionCard>
        ))}
      </div>
      {selected && (
        <Details title={selected.name}>
          <dl className="fact-list">
            <dt>Кость хитов</dt>
            <dd>к{selected.hitDie} (на 1-м уровне — {selected.hitDie} + модификатор Телосложения)</dd>
            <dt>Основные характеристики</dt>
            <dd>{abilityList(selected.primary)}</dd>
            <dt>Спасброски</dt>
            <dd>{abilityList(selected.savingThrows)}</dd>
            <dt>Навыки</dt>
            <dd>
              {selected.skillChoices.count} на выбор
              {selected.skillChoices.from === 'any' ? ' из любых' : `: ${skillList(selected.skillChoices.from)}`}
            </dd>
            <dt>Доспехи</dt>
            <dd>{selected.armorTraining}</dd>
          </dl>
          <ul className="feature-list">
            {selected.features.map((f) => (
              <li key={f.name}>
                <strong>{f.name}.</strong> {f.description}
              </li>
            ))}
          </ul>
        </Details>
      )}
    </>
  )
}

// ---------- Предыстория ----------

export function BackgroundStep({ draft, update }: StepProps) {
  const selected = draft.backgroundId ? data.backgrounds[draft.backgroundId] : undefined
  const feat = selected ? data.feats[selected.feat] : undefined
  return (
    <>
      <div className="option-grid" role="radiogroup" aria-label="Предыстория">
        {Object.values(data.backgrounds).map((bg) => (
          <OptionCard
            key={bg.id}
            optionId={bg.id}
            selected={draft.backgroundId === bg.id}
            onSelect={() => update(chooseBackground(draft, bg.id, data))}
            title={bg.name}
            meta={`${abilityList(bg.abilities)} · ${data.feats[bg.feat].name}`}
          >
            {bg.description}
          </OptionCard>
        ))}
      </div>
      {selected && feat && (
        <Details title={selected.name}>
          <dl className="fact-list">
            <dt>Черта</dt>
            <dd>
              <strong>{feat.name}</strong>
              {selected.featNote && ` (${selected.featNote})`}. {feat.description}
            </dd>
            <dt>Навыки</dt>
            <dd>{skillList(selected.skills)}</dd>
            <dt>Инструменты</dt>
            <dd>{selected.tool}</dd>
          </dl>

          <h4>Прибавки к характеристикам</h4>
          <div className="segmented" role="radiogroup" aria-label="Способ прибавок">
            <button
              type="button"
              role="radio"
              aria-checked={draft.bonusMode === 'two-one'}
              className={draft.bonusMode === 'two-one' ? 'is-active' : undefined}
              onClick={() => update({ ...draft, bonusMode: 'two-one' })}
            >
              +2 и +1
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={draft.bonusMode === 'one-one-one'}
              className={draft.bonusMode === 'one-one-one' ? 'is-active' : undefined}
              onClick={() => update({ ...draft, bonusMode: 'one-one-one', bonusPlus2: null, bonusPlus1: null })}
            >
              +1 к трём
            </button>
          </div>
          {draft.bonusMode === 'two-one' ? (
            <div className="bonus-rows">
              {(['bonusPlus2', 'bonusPlus1'] as const).map((key) => (
                <div key={key} className="bonus-row" role="radiogroup" aria-label={key === 'bonusPlus2' ? 'Прибавка +2' : 'Прибавка +1'}>
                  <span className="bonus-label">{key === 'bonusPlus2' ? '+2' : '+1'}</span>
                  {selected.abilities.map((ability) => {
                    const other = key === 'bonusPlus2' ? draft.bonusPlus1 : draft.bonusPlus2
                    return (
                      <ChoiceChip
                        key={ability}
                        value={ability}
                        checked={draft[key] === ability}
                        disabled={other === ability}
                        onToggle={() => update({ ...draft, [key]: draft[key] === ability ? null : ability })}
                      >
                        {ABILITY_NAMES[ability]}
                      </ChoiceChip>
                    )
                  })}
                </div>
              ))}
            </div>
          ) : (
            <p className="hint">+1 к {abilityList(selected.abilities)}.</p>
          )}
        </Details>
      )}
    </>
  )
}

// ---------- Вид ----------

export function SpeciesStep({ draft, update }: StepProps) {
  const selected = draft.speciesId ? data.species[draft.speciesId] : undefined
  const option = selected?.choice?.options.find((o) => o.id === draft.speciesOption)
  return (
    <>
      <div className="option-grid" role="radiogroup" aria-label="Вид">
        {Object.values(data.species).map((sp) => (
          <OptionCard
            key={sp.id}
            optionId={sp.id}
            selected={draft.speciesId === sp.id}
            onSelect={() => update(chooseSpecies(draft, sp.id))}
            title={sp.name}
            meta={`${sp.size} · ${sp.speed} фт.`}
          >
            {sp.description}
          </OptionCard>
        ))}
      </div>
      {selected && (
        <Details title={selected.name}>
          <dl className="fact-list">
            <dt>Размер</dt>
            <dd>{selected.size}</dd>
            <dt>Скорость</dt>
            <dd>{option?.speed ?? selected.speed} футов</dd>
            <dt>Тёмное зрение</dt>
            <dd>{(option?.darkvision ?? selected.darkvision) > 0 ? `${option?.darkvision ?? selected.darkvision} футов` : 'нет'}</dd>
          </dl>
          <ul className="feature-list">
            {selected.traits.map((t) => (
              <li key={t.name}>
                <strong>{t.name}.</strong> {t.description}
              </li>
            ))}
          </ul>

          {selected.choice && (
            <>
              <h4>{selected.choice.label}</h4>
              <div className="option-grid option-grid--compact" role="radiogroup" aria-label={selected.choice.label}>
                {selected.choice.options.map((o) => (
                  <OptionCard
                    key={o.id}
                    optionId={o.id}
                    selected={draft.speciesOption === o.id}
                    onSelect={() => update({ ...draft, speciesOption: o.id })}
                    title={o.name}
                  >
                    {o.description}
                  </OptionCard>
                ))}
              </div>
            </>
          )}

          {selected.originFeat && (
            <>
              <h4>Черта происхождения (Разносторонность)</h4>
              <div className="option-grid option-grid--compact" role="radiogroup" aria-label="Черта происхождения">
                {Object.values(data.feats).map((f) => (
                  <OptionCard
                    key={f.id}
                    optionId={f.id}
                    selected={draft.originFeat === f.id}
                    onSelect={() => update({ ...draft, originFeat: f.id, featSkills: [] })}
                    title={f.name}
                  >
                    {f.description}
                  </OptionCard>
                ))}
              </div>
            </>
          )}
        </Details>
      )}
    </>
  )
}

// ---------- Характеристики ----------

export function AbilitiesStep({ draft, update }: StepProps) {
  const pool = abilityPool(draft)
  const bonuses = backgroundBonuses(draft, data)
  const scores = finalScores(draft, data)
  const cls = draft.classId ? data.classes[draft.classId] : undefined
  const usedBy = new Map(ABILITIES.filter((a) => draft.assignment[a] !== undefined).map((a) => [draft.assignment[a]!, a]))

  return (
    <>
      <div className="segmented" role="radiogroup" aria-label="Способ определения характеристик">
        <button
          type="button"
          role="radio"
          aria-checked={draft.abilityMethod === 'standard'}
          className={draft.abilityMethod === 'standard' ? 'is-active' : undefined}
          onClick={() => update(chooseAbilityMethod(draft, 'standard'))}
        >
          Стандартный набор
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={draft.abilityMethod === 'roll'}
          className={draft.abilityMethod === 'roll' ? 'is-active' : undefined}
          onClick={() => update(chooseAbilityMethod(draft, 'roll'))}
        >
          Бросок 4к6
        </button>
      </div>
      <p className="hint">
        {draft.abilityMethod === 'standard'
          ? 'Распределите значения 15, 14, 13, 12, 10 и 8 между характеристиками.'
          : 'Для каждого значения брошено 4к6, худший кубик отброшен. Распределите шесть результатов.'}
      </p>

      {draft.abilityMethod === 'roll' && draft.rolls && (
        <ol className="ability-rolls" aria-label="Результаты бросков">
          {draft.rolls.map((r, i) => (
            <li key={i}>
              <span className="ability-roll-dice">
                {r.groups[0].dice.map((d, j) => (
                  <span key={j} className={`die-chip${d.kept ? '' : ' is-dropped'}`}>
                    {d.value}
                  </span>
                ))}
              </span>
              <strong>{r.total}</strong>
            </li>
          ))}
        </ol>
      )}

      {cls && (
        <button type="button" className="link-button" onClick={() => update({ ...draft, assignment: recommendedAssignment(cls, pool) })}>
          Расставить под класс «{cls.name}»
        </button>
      )}

      <div className="ability-table-wrap">
      <table className="ability-table">
        <colgroup>
          <col className="col-name" />
          <col className="col-value" />
          <col className="col-bonus" />
          <col className="col-final" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">
              <span className="visually-hidden">Характеристика</span>
            </th>
            <th scope="col">Значение</th>
            <th scope="col" title="Прибавка предыстории">
              Приб.
            </th>
            <th scope="col">Итог</th>
          </tr>
        </thead>
        <tbody>
          {ABILITIES.map((ability) => {
            const index = draft.assignment[ability]
            const final = scores?.[ability] ?? (index !== undefined ? Math.min(20, pool[index] + (bonuses[ability] ?? 0)) : undefined)
            return (
              <tr key={ability} data-ability={ability}>
                <th scope="row">
                  {ABILITY_NAMES[ability]}
                  {cls?.primary.includes(ability) && (
                    <span className="primary-mark" title="Основная характеристика класса">
                      ★
                    </span>
                  )}
                </th>
                <td>
                  <select
                    aria-label={`Значение: ${ABILITY_NAMES[ability]}`}
                    value={index ?? ''}
                    onChange={(e) => update(assignScore(draft, ability, e.target.value === '' ? null : Number(e.target.value)))}
                  >
                    <option value="">—</option>
                    {pool.map((value, i) => (
                      <option key={i} value={i}>
                        {value}
                        {usedBy.has(i) && usedBy.get(i) !== ability ? ` (${ABILITY_ABBREVIATIONS[usedBy.get(i)!]})` : ''}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="bonus-cell">{bonuses[ability] ? `+${bonuses[ability]}` : ''}</td>
                <td className="final-cell">
                  {final !== undefined ? (
                    <>
                      <strong>{final}</strong> <span>({formatModifier(abilityModifier(final))})</span>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>
    </>
  )
}

// ---------- Навыки ----------

export function SkillsStep({ draft, update }: StepProps) {
  const granted = grantedSkills(draft, data)
  const slots = skillSlots(draft, data)
  const takenElsewhere = (key: string) =>
    new Set<SkillId>([...granted, ...slots.filter((s) => s.key !== key).flatMap((s) => draft[s.key])])
  const needExpertise = expertiseCount(draft, data)
  const proficient = proficientSkills(draft, data)

  return (
    <>
      {granted.length > 0 && (
        <p className="hint">
          Предыстория даёт: <strong>{skillList(granted)}</strong>.
        </p>
      )}
      {slots.map((slot) => {
        const chosen = draft[slot.key]
        const blocked = takenElsewhere(slot.key)
        return (
          <section key={slot.key} className="skill-slot" aria-label={slot.label} data-slot={slot.key}>
            <h4>
              {slot.label}
              <span className={`slot-count${chosen.length === slot.count ? ' is-done' : ''}`}>
                {chosen.length} из {slot.count}
              </span>
            </h4>
            <div className="chip-row">
              {slot.options.map((skill) => {
                const checked = chosen.includes(skill)
                const disabled = !checked && (blocked.has(skill) || chosen.length >= slot.count)
                return (
                  <ChoiceChip
                    key={skill}
                    value={skill}
                    checked={checked}
                    disabled={disabled}
                    onToggle={() => {
                      const next = checked ? chosen.filter((s) => s !== skill) : [...chosen, skill]
                      update({ ...draft, [slot.key]: next, expertise: draft.expertise.filter((s) => s !== skill || !checked) })
                    }}
                  >
                    {SKILL_DEFINITIONS[skill].name}
                    {blocked.has(skill) && !checked && <span className="chip-note"> ✓</span>}
                  </ChoiceChip>
                )
              })}
            </div>
          </section>
        )
      })}

      {needExpertise > 0 && (
        <section className="skill-slot" aria-label="Компетентность" data-slot="expertise">
          <h4>
            Компетентность (бонус мастерства ×2)
            <span className={`slot-count${draft.expertise.length === needExpertise ? ' is-done' : ''}`}>
              {draft.expertise.length} из {needExpertise}
            </span>
          </h4>
          <div className="chip-row">
            {proficient.map((skill) => {
              const checked = draft.expertise.includes(skill)
              return (
                <ChoiceChip
                  key={skill}
                  value={skill}
                  checked={checked}
                  disabled={!checked && draft.expertise.length >= needExpertise}
                  onToggle={() =>
                    update({ ...draft, expertise: checked ? draft.expertise.filter((s) => s !== skill) : [...draft.expertise, skill] })
                  }
                >
                  {SKILL_DEFINITIONS[skill].name}
                </ChoiceChip>
              )
            })}
          </div>
        </section>
      )}
    </>
  )
}

// ---------- Снаряжение ----------

function EquipmentContents({ option }: { option: EquipmentOption }) {
  if (option.items.length === 0) return <>Только золото: {option.gold} зм.</>
  return (
    <>
      {option.items.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && ', '}
          {line.packId !== undefined ? (
            <span title={data.packs[line.packId].contents.map((c) => `${itemCatalog[c.itemId].name}${c.quantity > 1 ? ` ×${c.quantity}` : ''}`).join(', ')}>
              {data.packs[line.packId].name}
            </span>
          ) : (
            <>
              {itemCatalog[line.itemId].name}
              {(line.quantity ?? 1) > 1 && ` ×${line.quantity}`}
            </>
          )}
        </Fragment>
      ))}
      {option.gold > 0 && `, ${option.gold} зм`}
    </>
  )
}

export function EquipmentStep({ draft, update }: StepProps) {
  const cls = draft.classId ? data.classes[draft.classId] : undefined
  const background = draft.backgroundId ? data.backgrounds[draft.backgroundId] : undefined
  return (
    <>
      {cls && (
        <section className="equipment-choice" aria-label={`Снаряжение класса ${cls.name}`}>
          <h4>Класс: {cls.name}</h4>
          <div className="option-grid option-grid--wide" role="radiogroup" aria-label="Снаряжение класса">
            {cls.equipment.map((option) => (
              <OptionCard
                key={option.id}
                optionId={`class-${option.id}`}
                selected={draft.classEquipment === option.id}
                onSelect={() => update({ ...draft, classEquipment: option.id })}
                title={`Вариант ${option.id}`}
              >
                <EquipmentContents option={option} />
              </OptionCard>
            ))}
          </div>
        </section>
      )}
      {background && (
        <section className="equipment-choice" aria-label={`Снаряжение предыстории ${background.name}`}>
          <h4>Предыстория: {background.name}</h4>
          <div className="option-grid option-grid--wide" role="radiogroup" aria-label="Снаряжение предыстории">
            {background.equipment.map((option) => (
              <OptionCard
                key={option.id}
                optionId={`background-${option.id}`}
                selected={draft.backgroundEquipment === option.id}
                onSelect={() => update({ ...draft, backgroundEquipment: option.id })}
                title={`Вариант ${option.id}`}
              >
                <EquipmentContents option={option} />
              </OptionCard>
            ))}
          </div>
        </section>
      )}
      <p className="hint">Наведите на название набора, чтобы увидеть его содержимое. Доспех, щит и оружие наденутся автоматически.</p>
    </>
  )
}

// ---------- Имя и внешность ----------

export function DetailsStep({ draft, update }: StepProps) {
  return (
    <div className="details-form">
      <label className="field">
        <span>Имя</span>
        <input
          value={draft.name}
          maxLength={MAX_NAME_LENGTH}
          onChange={(e) => update({ ...draft, name: e.target.value })}
          placeholder="Например, Мирослава"
          autoComplete="off"
        />
      </label>
      <label className="field">
        <span>Внешность и характер</span>
        <textarea
          value={draft.appearance}
          maxLength={600}
          rows={5}
          onChange={(e) => update({ ...draft, appearance: e.target.value })}
          placeholder="Рост, черты лица, одежда, манеры… Ведущий будет опираться на это описание."
        />
      </label>
    </div>
  )
}
