// Выбор приёмов оружия, языков и таинственных воззваний — при создании, в окне «Дополните лист» и (приёмы)
// после долгого отдыха. Правила — src/game/weaponMastery.ts, languages.ts, invocations.ts.
import { rulesData } from '../data'
import { classLanguages, COMMON, STANDARD_CHOICES, standardLanguages } from '../game/languages'
import { availableInvocations, invocationCount, tomeOptions, type InvocationSubject } from '../game/invocations'
import { masteryCount, masteryKindText, masteryOptions, masteryRule, masterySwapText } from '../game/weaponMastery'
import type { Character, InvocationChoice } from '../types/character'
import { ChoiceChip, OptionCard } from './creation/OptionCard'
import { MASTERY_LABELS } from './itemText'
import { SpellOptionList } from './SpellPicker'

const rules = rulesData

/** Выбор видов оружия для «Приёмов оружия». locked — виды, которые нельзя снять (после отдыха Воин меняет один). */
export function WeaponMasteryPicker({
  subject,
  value,
  onChange,
  note,
}: {
  subject: Pick<Character, 'classId' | 'level' | 'classOrder'>
  value: string[]
  onChange: (next: string[]) => void
  note?: string
}) {
  const rule = masteryRule(subject.classId, rules)
  if (!rule) return null
  const count = masteryCount(subject, rules)
  const options = masteryOptions(subject, rules)
  return (
    <section className="skill-slot" aria-label="Приёмы оружия" data-slot="weapon-masteries" data-testid="weapon-masteries">
      <h4>
        Приёмы оружия: {masteryKindText(rule)}
        <span className={`slot-count${value.length === count ? ' is-done' : ''}`}>
          {value.length} из {count}
        </span>
      </h4>
      <p className="hint">{note ?? `Вы используете свойство приёма выбранных видов оружия (эффекты в бою — позже). ${masterySwapText(rule)}`}</p>
      <div className="chip-row">
        {options.map((item) => {
          const checked = value.includes(item.id)
          return (
            <ChoiceChip
              key={item.id}
              value={item.id}
              checked={checked}
              disabled={!checked && value.length >= count}
              onToggle={() => onChange(checked ? value.filter((id) => id !== item.id) : [...value, item.id])}
            >
              {item.name}
              {item.weapon?.mastery && <span className="chip-note"> · {MASTERY_LABELS[item.weapon.mastery]}</span>}
            </ChoiceChip>
          )
        })}
      </div>
    </section>
  )
}

/** Языки: Общий известен всем, два обычных на выбор; у класса — свои («Друидический») и ещё на выбор (Плут). */
export function LanguagePicker({
  classId,
  standard,
  extra,
  onChange,
}: {
  classId: string
  standard: string[]
  extra: string[]
  onChange: (next: { standard: string[]; extra: string[] }) => void
}) {
  const cls = classLanguages(classId, rules)
  const fixedNames = cls.fixed.map((id) => rules.languages[id]?.name).filter(Boolean)
  const all = Object.values(rules.languages).filter((l) => l.id !== COMMON && !cls.fixed.includes(l.id))
  return (
    <section className="languages" aria-label="Языки" data-testid="languages">
      <h4>Языки</h4>
      <p className="hint">
        Общий знают все{fixedNames.length ? `; от класса: ${fixedNames.join(', ')}` : ''}. Герой понимает речь и тексты только на известных языках.
      </p>
      <section className="skill-slot" aria-label="Обычные языки" data-slot="languages">
        <h4>
          Обычные языки
          <span className={`slot-count${standard.length === STANDARD_CHOICES ? ' is-done' : ''}`}>
            {standard.length} из {STANDARD_CHOICES}
          </span>
        </h4>
        <div className="chip-row">
          {standardLanguages(rules).map((l) => {
            const checked = standard.includes(l.id)
            return (
              <ChoiceChip
                key={l.id}
                value={l.id}
                checked={checked}
                disabled={!checked && (standard.length >= STANDARD_CHOICES || extra.includes(l.id))}
                onToggle={() => onChange({ standard: checked ? standard.filter((x) => x !== l.id) : [...standard, l.id], extra })}
              >
                {l.name}
              </ChoiceChip>
            )
          })}
        </div>
      </section>
      {cls.choose > 0 && (
        <section className="skill-slot" aria-label="Язык от класса" data-slot="class-languages">
          <h4>
            {cls.feature ? `«${cls.feature}»: ещё язык` : 'Язык от класса'} (обычный или редкий)
            <span className={`slot-count${extra.length === cls.choose ? ' is-done' : ''}`}>
              {extra.length} из {cls.choose}
            </span>
          </h4>
          <div className="chip-row">
            {all.map((l) => {
              const checked = extra.includes(l.id)
              return (
                <ChoiceChip
                  key={l.id}
                  value={l.id}
                  checked={checked}
                  disabled={!checked && (extra.length >= cls.choose || standard.includes(l.id))}
                  onToggle={() => onChange({ standard, extra: checked ? extra.filter((x) => x !== l.id) : [...extra, l.id] })}
                >
                  {l.name}
                  {l.rarity === 'rare' && <span className="chip-note"> · редкий</span>}
                </ChoiceChip>
              )
            })}
          </div>
        </section>
      )}
    </section>
  )
}

/** Таинственные воззвания: число по уровню, требования; у «Договора гримуара» — заговоры и ритуалы книги. */
export function InvocationPicker({
  subject,
  value,
  onChange,
}: {
  subject: InvocationSubject
  value: InvocationChoice[]
  onChange: (next: InvocationChoice[]) => void
}) {
  const count = invocationCount(subject, rules)
  if (count === 0) return null
  const options = availableInvocations(subject, value, rules).filter((inv) => !inv.prerequisite?.cantrip && inv.id !== 'lessons-of-the-first-ones')
  const toggle = (id: string) => {
    const has = value.some((x) => x.id === id)
    if (has) onChange(value.filter((x) => x.id !== id))
    else if (count === 1) onChange([{ id }])
    else if (value.length < count) onChange([...value, { id }])
  }
  const tome = value.find((x) => rules.invocations[x.id]?.tome)
  const tomeDef = tome ? rules.invocations[tome.id].tome! : null
  const opts = tomeOptions(subject, rules)
  const setTome = (patch: Partial<InvocationChoice>) => onChange(value.map((x) => (x === tome ? { ...x, ...patch } : x)))
  return (
    <section className="creation-details" aria-label="Таинственные воззвания" data-testid="invocations">
      <h3>
        Таинственные воззвания
        <span className={`slot-count${value.length === count ? ' is-done' : ''}`}>
          {value.length} из {count}
        </span>
      </h3>
      <p className="hint">Остальные воззвания требуют более высокого уровня колдуна; при получении уровня одно можно заменить.</p>
      <div className="option-grid option-grid--compact" role={count === 1 ? 'radiogroup' : 'group'} aria-label="Воззвания">
        {options.map((inv) => (
          <OptionCard key={inv.id} optionId={inv.id} selected={value.some((x) => x.id === inv.id)} onSelect={() => toggle(inv.id)} title={inv.name} meta={inv.nameEn}>
            {inv.description}
          </OptionCard>
        ))}
      </div>
      {tome && tomeDef && (
        <div data-testid="tome-choice">
          <SpellOptionList
            label="Книга теней: заговоры (из любого списка)"
            slot="tome-cantrips"
            options={opts.cantrips}
            selected={tome.cantrips ?? []}
            count={tomeDef.cantrips}
            onChange={(cantrips) => setTome({ cantrips })}
          />
          <SpellOptionList
            label="Книга теней: ритуалы 1-го круга"
            slot="tome-rituals"
            note="Заклинания с пометкой «ритуал» из любого списка; для вас они — заклинания колдуна."
            options={opts.rituals}
            selected={tome.rituals ?? []}
            count={tomeDef.rituals}
            onChange={(rituals) => setTome({ rituals })}
          />
        </div>
      )}
    </section>
  )
}
