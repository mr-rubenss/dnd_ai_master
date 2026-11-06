import { ABILITIES, ABILITY_ABBREVIATIONS, ABILITY_NAMES, abilityModifier, formatModifier, proficiencyBonus } from '../engine/abilities'
import {
  isSaveProficient,
  passivePerception,
  savingThrowModifier,
  skillModifier,
  skillProficiency,
} from '../engine/checks'
import { CONDITION_DEFINITIONS } from '../engine/conditions'
import { SKILL_DEFINITIONS, SKILLS, type ProficiencyLevel } from '../engine/skills'
import { itemCatalog, rulesData } from '../data'
import { armorTrainingText } from './itemText'
import type { Character, ChronicleEntry } from '../types/character'

const PROFICIENCY_TITLES: Record<ProficiencyLevel, string> = {
  none: 'Без владения',
  proficient: 'Владение',
  expertise: 'Компетентность',
}

const SKILLS_BY_NAME = [...SKILLS].sort((a, b) => SKILL_DEFINITIONS[a].name.localeCompare(SKILL_DEFINITIONS[b].name, 'ru'))

function ProficiencyMark({ level }: { level: ProficiencyLevel }) {
  return <span className={`prof-mark prof-mark--${level}`} title={PROFICIENCY_TITLES[level]} aria-label={PROFICIENCY_TITLES[level]} />
}

/** Вкладка «Характеристики»: характеристики, спасброски, навыки, пассивное Восприятие и состояния. */
export function CharacterStats({ character }: { character: Character }) {
  return (
    <div className="character-sheet">
      <dl className="sheet-summary">
        <div>
          <dt>Бонус мастерства</dt>
          <dd>{formatModifier(proficiencyBonus(character.level))}</dd>
        </div>
        <div>
          <dt>Пассивное Восприятие</dt>
          <dd data-testid="passive-perception">{passivePerception(character)}</dd>
        </div>
      </dl>

      <section className="inventory-section" aria-label="Характеристики">
        <h3>Характеристики</h3>
        <ul className="ability-grid">
          {ABILITIES.map((ability) => (
            <li key={ability} className="ability-box" title={ABILITY_NAMES[ability]} data-ability={ability}>
              <span className="ability-abbr">{ABILITY_ABBREVIATIONS[ability]}</span>
              <span className="ability-mod">{formatModifier(abilityModifier(character.abilities[ability]))}</span>
              <span className="ability-score">{character.abilities[ability]}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="inventory-section" aria-label="Спасброски">
        <h3>Спасброски</h3>
        <ul className="stat-list">
          {ABILITIES.map((ability) => (
            <li key={ability} data-save={ability}>
              <ProficiencyMark level={isSaveProficient(character, ability) ? 'proficient' : 'none'} />
              <span className="stat-name">{ABILITY_NAMES[ability]}</span>
              <span className="stat-mod">{formatModifier(savingThrowModifier(character, ability))}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="inventory-section" aria-label="Навыки">
        <h3>Навыки</h3>
        <ul className="stat-list">
          {SKILLS_BY_NAME.map((skill) => {
            const definition = SKILL_DEFINITIONS[skill]
            const level = skillProficiency(character, skill)
            return (
              <li key={skill} data-skill={skill} className={level !== 'none' ? 'is-proficient' : undefined}>
                <ProficiencyMark level={level} />
                <span className="stat-name">
                  {definition.name}
                  <span className="stat-ability">{ABILITY_ABBREVIATIONS[definition.ability]}</span>
                </span>
                <span className="stat-mod">{formatModifier(skillModifier(character, skill))}</span>
              </li>
            )
          })}
        </ul>
        <p className="stat-legend">
          <ProficiencyMark level="proficient" /> владение <ProficiencyMark level="expertise" /> компетентность
        </p>
      </section>

      <section className="inventory-section" aria-label="Владения и черты">
        <h3>Владения и черты</h3>
        <dl className="fact-list fact-list--compact">
          <dt>Доспехи</dt>
          <dd data-testid="armor-training">{armorTrainingText(character.proficiencies.armor)}</dd>
          <dt>Инструменты</dt>
          <dd data-testid="tool-proficiencies">
            {character.proficiencies.tools.length === 0 ? 'нет' : character.proficiencies.tools.map((id) => itemCatalog[id]?.name ?? id).join(', ')}
          </dd>
          <dt>Черты</dt>
          <dd data-testid="feats">{character.feats.length === 0 ? 'нет' : character.feats.map((id) => rulesData.feats[id]?.name ?? id).join(', ')}</dd>
        </dl>
      </section>

      {character.backstory && (
        <section className="inventory-section" aria-label="История героя">
          <h3>История героя</h3>
          <p className="backstory-text" data-testid="sheet-backstory">
            {character.backstory}
          </p>
        </section>
      )}

      <section className="inventory-section" aria-label="Летопись">
        <h3>Летопись</h3>
        <Chronicle entries={character.chronicle ?? []} />
      </section>

      <section className="inventory-section" aria-label="Состояния">
        <h3>Состояния</h3>
        {character.conditions.length === 0 ? (
          <p className="conditions-empty">Нет</p>
        ) : (
          <ul className="condition-list">
            {character.conditions.map((condition) => {
              const definition = CONDITION_DEFINITIONS[condition.id]
              return (
                <li key={condition.id} className="condition-chip" data-condition={condition.id}>
                  <strong>
                    {definition.name}
                    {condition.level ? ` ${condition.level}` : ''}
                  </strong>
                  <span>{definition.summary}</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

const chronicleDate = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })

/** «Летопись» героя — итоги пройденных историй по порядку. */
export function Chronicle({ entries }: { entries: ChronicleEntry[] }) {
  if (entries.length === 0) return <p className="chronicle-empty">Пока пусто: сюда попадут итоги завершённых историй.</p>
  return (
    <ol className="chronicle" data-testid="chronicle">
      {entries.map((entry) => (
        <li key={entry.storyId} className="chronicle-entry">
          <p className="chronicle-head">
            <strong>«{entry.storyTitle}»</strong>
            <time dateTime={new Date(entry.endedAt).toISOString()}>{chronicleDate.format(entry.endedAt)}</time>
          </p>
          <p className="chronicle-summary">{entry.summary}</p>
          <p className="chronicle-outcome">{entry.outcome}</p>
          <p className="chronicle-meta">
            Уровень {entry.startLevel} → {entry.endLevel}
            {entry.fate === 'fallen' && ' · гибель'}
            {entry.finds.length > 0 && <> · находки: {entry.finds.join(', ')}</>}
          </p>
        </li>
      ))}
    </ol>
  )
}
