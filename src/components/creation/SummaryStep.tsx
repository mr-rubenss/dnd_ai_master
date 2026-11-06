import { itemCatalog, rulesData } from '../../data'
import { formatCoins } from '../../game/coins'
import { ABILITIES, ABILITY_ABBREVIATIONS, abilityModifier, formatModifier, proficiencyBonus } from '../../engine/abilities'
import { passivePerception, savingThrowModifier, skillModifier } from '../../engine/checks'
import { SKILL_DEFINITIONS } from '../../engine/skills'
import { armorClass, inventoryWeight } from '../../game/character'
import type { CharacterSheet } from '../../types/character'
import { formatNumber, MASTERY_LABELS } from '../itemText'
import { invocationLabel } from '../../game/invocations'
import { languageNames } from '../../game/languages'
import { knownSpells } from '../../game/magic'

/** Итоговый лист персонажа перед началом игры. */
export function SummaryStep({ sheet }: { sheet: CharacterSheet }) {
  const { character, inventory } = sheet
  const cls = rulesData.classes[character.classId]
  const species = rulesData.species[character.speciesId]
  const option = species.choice?.options.find((o) => o.id === character.speciesOption)
  const ac = armorClass(character, inventory, itemCatalog)
  const proficientSkills = Object.entries(character.proficiencies.skills)
  const equipped = new Set(Object.values(inventory.equipped).filter(Boolean))

  return (
    <article className="summary-sheet" aria-label="Лист персонажа">
      <header className="summary-head">
        <h3 data-testid="summary-name">{character.name}</h3>
        <p>
          {character.species}
          {option && ` (${option.name})`} · {character.className} 1 ур. · {character.background}
        </p>
      </header>

      <dl className="summary-stats">
        <div>
          <dt>Хиты</dt>
          <dd data-testid="summary-hp">{character.maxHp}</dd>
        </div>
        <div>
          <dt>КД</dt>
          <dd data-testid="summary-ac">{ac}</dd>
        </div>
        <div>
          <dt>Скорость</dt>
          <dd>{option?.speed ?? species.speed} фт.</dd>
        </div>
        <div>
          <dt>Бонус мастерства</dt>
          <dd>{formatModifier(proficiencyBonus(character.level))}</dd>
        </div>
        <div>
          <dt>Пасс. Восприятие</dt>
          <dd>{passivePerception(character)}</dd>
        </div>
        <div>
          <dt>Тёмное зрение</dt>
          <dd>{(option?.darkvision ?? species.darkvision) || '—'}</dd>
        </div>
      </dl>

      <ul className="ability-grid summary-abilities">
        {ABILITIES.map((a) => (
          <li key={a} className="ability-box" data-ability={a}>
            <span className="ability-abbr">{ABILITY_ABBREVIATIONS[a]}</span>
            <span className="ability-mod">{formatModifier(abilityModifier(character.abilities[a]))}</span>
            <span className="ability-score">{character.abilities[a]}</span>
          </li>
        ))}
      </ul>

      <div className="summary-columns">
        <section>
          <h4>Спасброски</h4>
          <p>
            {character.proficiencies.savingThrows
              .map((a) => `${ABILITY_ABBREVIATIONS[a]} ${formatModifier(savingThrowModifier(character, a))}`)
              .join(', ')}
          </p>
          <h4>Навыки</h4>
          <p data-testid="summary-skills">
            {proficientSkills
              .map(([skill, level]) => {
                const id = skill as keyof typeof SKILL_DEFINITIONS
                return `${SKILL_DEFINITIONS[id].name}${level === 'expertise' ? ' (компетентность)' : ''} ${formatModifier(skillModifier(character, id))}`
              })
              .join(', ')}
          </p>
          <h4>Инструменты</h4>
          <p data-testid="summary-tools">
            {character.proficiencies.tools.length === 0 ? 'нет' : character.proficiencies.tools.map((id) => itemCatalog[id].name).join(', ')}
          </p>
          <h4>Языки</h4>
          <p data-testid="summary-languages">{languageNames(character.languages, rulesData)}</p>
          {character.weaponMasteries?.length ? (
            <>
              <h4>Приёмы оружия</h4>
              <p data-testid="summary-masteries">
                {character.weaponMasteries
                  .map((id) => `${itemCatalog[id]?.name ?? id}${itemCatalog[id]?.weapon?.mastery ? ` (${MASTERY_LABELS[itemCatalog[id].weapon!.mastery!]})` : ''}`)
                  .join(', ')}
              </p>
            </>
          ) : null}
          {character.invocations?.length ? (
            <>
              <h4>Таинственные воззвания</h4>
              <p data-testid="summary-invocations">{character.invocations.map((x) => invocationLabel(x, rulesData)).join('; ')}</p>
            </>
          ) : null}
          <h4>Черты</h4>
          <ul className="feature-list">
            {character.feats.map((id, i) => (
              <li key={`${id}-${i}`}>
                <strong>{rulesData.feats[id].name}.</strong> {rulesData.feats[id].description}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h4>Умения класса</h4>
          <ul className="feature-list">
            {cls.features.map((f) => (
              <li key={f.name}>
                <strong>{f.name}.</strong> {f.description}
              </li>
            ))}
          </ul>
          <h4>Особенности вида</h4>
          <ul className="feature-list">
            {species.traits.map((t) => (
              <li key={t.name}>
                <strong>{t.name}.</strong> {t.description}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {knownSpells(character, rulesData).length > 0 && (
        <section>
          <h4>Заклинания</h4>
          <p data-testid="summary-spells">
            {knownSpells(character, rulesData)
              .map((k) => `${k.spell.name}${k.spell.level === 0 ? ' (заговор)' : ''}${k.inBookOnly ? ' (в книге)' : ''}${k.source !== 'class' ? ` — ${k.sourceName}` : ''}`)
              .join(', ')}
          </p>
        </section>
      )}

      <section>
        <h4>
          Снаряжение · {formatCoins(inventory.coins)} · {formatNumber(inventoryWeight(inventory, itemCatalog))} фнт.
        </h4>
        <p data-testid="summary-items">
          {inventory.items.length === 0
            ? 'Только золото — снаряжение можно будет купить.'
            : inventory.items
                .map((e) => `${itemCatalog[e.itemId].name}${e.quantity > 1 ? ` ×${e.quantity}` : ''}${equipped.has(e.itemId) ? ' (надето)' : ''}`)
                .join(', ')}
        </p>
      </section>

      {character.appearance && (
        <section>
          <h4>Внешность</h4>
          <p className="summary-appearance">{character.appearance}</p>
        </section>
      )}

      {character.backstory && (
        <section>
          <h4>История героя</h4>
          <p className="summary-appearance" data-testid="summary-backstory">
            {character.backstory}
          </p>
        </section>
      )}
    </article>
  )
}
