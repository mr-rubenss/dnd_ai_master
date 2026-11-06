import { useRef, useState } from 'react'
import { itemCatalog, rulesData } from '../../data'
import {
  buildCharacterSheet,
  creationSteps,
  emptyDraft,
  firstIncompleteStep,
  stepProblems,
  type CreationDraft,
  type CreationStep,
} from '../../game/creation'
import type { CharacterSheet } from '../../types/character'
import { AbilitiesStep, BackgroundStep, ClassStep, DetailsStep, EquipmentStep, SkillsStep, SpeciesStep, SpellsStep, type StepProps } from './steps'
import { SummaryStep } from './SummaryStep'

const STEP_HINTS: Record<CreationStep, string> = {
  class: 'Класс определяет, как ваш герой сражается и чем полезен отряду.',
  background: 'Чем вы занимались до приключений. Предыстория даёт прибавки к характеристикам, черту, навыки и снаряжение.',
  species: 'Ваш народ: размер, скорость и врождённые особенности.',
  abilities: 'Сила, Ловкость, Телосложение, Интеллект, Мудрость и Харизма.',
  skills: 'Навыки, которыми вы владеете, добавляют бонус мастерства к проверкам.',
  spells: 'Заговоры и заклинания, которые знает ваш герой. Нажмите на заклинание, чтобы прочитать описание.',
  equipment: 'Готовый набор снаряжения или золото, чтобы купить всё самому.',
  details: 'Как зовут вашего героя и как он выглядит.',
  summary: 'Проверьте лист персонажа. Всё в порядке — в путь!',
}

const STEP_COMPONENTS: Record<Exclude<CreationStep, 'summary'>, (props: StepProps) => React.ReactElement> = {
  class: ClassStep,
  background: BackgroundStep,
  species: SpeciesStep,
  abilities: AbilitiesStep,
  skills: SkillsStep,
  spells: SpellsStep,
  equipment: EquipmentStep,
  details: DetailsStep,
}

interface Props {
  /** Сохранить героя и перейти к новой истории с ним. */
  onStart: (sheet: CharacterSheet) => void | Promise<void>
  /** Только сохранить героя в «Мои герои». */
  onSave: (sheet: CharacterSheet) => void | Promise<void>
}

/** Каждому новому герою — свой id. */
const withNewId = (sheet: CharacterSheet): CharacterSheet => ({ ...sheet, character: { ...sheet.character, id: crypto.randomUUID() } })

/** Экран создания персонажа: пошаговый мастер по правилам SRD 5.2. */
export function CharacterCreation({ onStart, onSave }: Props) {
  const [draft, setDraft] = useState<CreationDraft>(emptyDraft)
  const [step, setStep] = useState<CreationStep>('class')
  const headingRef = useRef<HTMLHeadingElement>(null)

  // Шаг «Заклинания» — только у тех, кто владеет магией.
  const steps = creationSteps(draft, rulesData)
  const index = Math.max(0, steps.findIndex((s) => s.id === step))
  const problems = stepProblems(step, draft, rulesData)
  // Дальше первого незавершённого шага уйти нельзя.
  const reachable = steps.findIndex((s) => s.id === firstIncompleteStep(draft, rulesData))
  const sheet = step === 'summary' && problems.length === 0 ? buildCharacterSheet(draft, rulesData, itemCatalog, 'new-character') : null

  const goTo = (next: CreationStep) => {
    setStep(next)
    requestAnimationFrame(() => {
      // На узком экране полоса шагов прокручивается — показываем текущий шаг.
      const current = document.querySelector<HTMLElement>('.creation-steps [aria-current="step"]')
      const strip = current?.closest('.creation-steps')
      if (current && strip) strip.scrollTo({ left: current.offsetLeft - strip.clientWidth / 2 + current.clientWidth / 2, behavior: 'smooth' })
      headingRef.current?.focus({ preventScroll: true })
      headingRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    })
  }

  const StepComponent = step === 'summary' ? null : STEP_COMPONENTS[step]

  return (
    <main className="creation" aria-labelledby="creation-title">
      <header className="creation-header">
        <h2 id="creation-title">Создание персонажа</h2>
      </header>

      <nav className="creation-steps" aria-label="Шаги создания персонажа">
        <ol>
          {steps.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                aria-current={s.id === step ? 'step' : undefined}
                className={`${s.id === step ? 'is-current' : ''}${i < reachable ? ' is-done' : ''}`}
                disabled={i > reachable}
                onClick={() => goTo(s.id)}
              >
                <span className="step-number">{i + 1}</span>
                <span className="step-title">{s.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <section className="panel creation-body" aria-labelledby="creation-step-title">
        <h2 id="creation-step-title" ref={headingRef} tabIndex={-1} className="creation-step-title">
          {index + 1}. {steps[index].title}
        </h2>
        <p className="creation-step-hint">{STEP_HINTS[step]}</p>
        {StepComponent ? <StepComponent draft={draft} update={setDraft} /> : sheet && <SummaryStep sheet={sheet} />}
      </section>

      <footer className="creation-footer">
        <button type="button" className="secondary-button" disabled={index === 0} onClick={() => goTo(steps[index - 1].id)}>
          Назад
        </button>
        <p className="creation-problems" role="status">
          {problems[0] ?? ''}
        </p>
        {step === 'summary' ? (
          <div className="creation-finish">
            <button type="button" className="secondary-button" disabled={!sheet} onClick={() => sheet && onSave(withNewId(sheet))}>
              Сохранить в «Мои герои»
            </button>
            <button type="button" className="primary-button" disabled={!sheet} onClick={() => sheet && onStart(withNewId(sheet))}>
              Начать приключение
            </button>
          </div>
        ) : (
          <button type="button" className="primary-button" disabled={problems.length > 0} onClick={() => goTo(steps[index + 1].id)}>
            Далее
          </button>
        )}
      </footer>
    </main>
  )
}
