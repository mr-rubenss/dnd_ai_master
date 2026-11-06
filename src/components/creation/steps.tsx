import { Fragment, useEffect, useRef, useState } from 'react'
import { createMaster } from '../../ai'
import { aiConnection, isReasoningModel, settingsProblems } from '../../ai/settings'
import { useAiSettings } from '../../ai/settingsStore'
import { itemCatalog, rulesData } from '../../data'
import { ABILITIES, ABILITY_ABBREVIATIONS, ABILITY_NAMES, abilityModifier, formatModifier, type Ability } from '../../engine/abilities'
import { SKILL_DEFINITIONS, SKILLS, type SkillId } from '../../engine/skills'
import {
  BACKGROUND_TEMPLATE,
  CUSTOM_BACKGROUND_ID,
  equipmentCost,
  formatGold,
  purchasableItems,
  type CustomBackgroundInput,
} from '../../game/backgroundTemplate'
import {
  abilityPool,
  assignScore,
  backgroundBonuses,
  backgroundOf,
  chooseAbilityMethod,
  chooseBackground,
  chooseClass,
  chooseSpecies,
  expertiseCount,
  featsOfCategory,
  finalScores,
  grantedSkills,
  MAX_NAME_LENGTH,
  proficientSkills,
  recommendedAssignment,
  skillSlots,
  toolsOfKinds,
  updateCustomBackground,
  applyBackgroundProposal,
  chooseCustomBackground,
  decideProposalDetail,
  type CreationDraft,
} from '../../game/creation'
import {
  backstoryProblem,
  EXPLANATION_KEYS,
  EXPLANATION_LABELS,
  MAX_PROPOSAL_ATTEMPTS,
  partialName,
  suggestBackground,
  type SuggestStage,
} from '../../game/backgroundFromStory'
import { timedFor } from '../../game/masterSession'
import { AiProgress, AiTaskError } from '../AiTask'
import { useAiTask } from '../useAiTask'
import { MAX_BACKSTORY_LENGTH } from '../../game/character'
import type { ToolKind } from '../../types/items'
import { armorTrainingText } from '../itemText'
import type { EquipmentOption } from '../../types/rules'
import { ChoiceChip, OptionCard } from './OptionCard'

export interface StepProps {
  draft: CreationDraft
  update: (next: CreationDraft) => void
}

const data = rulesData

const TOOL_KIND_LABELS: Record<ToolKind, string> = {
  artisan: 'Инструменты ремесленника',
  gaming: 'Игровой набор',
  musical: 'Музыкальный инструмент',
  kit: 'Прочие инструменты',
}
const TOOL_KIND_ORDER: ToolKind[] = ['artisan', 'gaming', 'musical', 'kit']
const ALL_TOOLS = toolsOfKinds(TOOL_KIND_ORDER, rulesData)
const SKILLS_BY_NAME = [...SKILLS].sort((a, b) => SKILL_DEFINITIONS[a].name.localeCompare(SKILL_DEFINITIONS[b].name, 'ru'))
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
            <dd>{armorTrainingText(selected.armorTraining)}</dd>
          </dl>
          <ul className="feature-list">
            {selected.features.map((f) => (
              <li key={f.name}>
                <strong>{f.name}.</strong> {f.description}
              </li>
            ))}
          </ul>

          {selected.fightingStyle && (
            <>
              <h4>Боевой стиль</h4>
              <div className="option-grid option-grid--compact" role="radiogroup" aria-label="Боевой стиль">
                {featsOfCategory('fighting-style', data).map((f) => (
                  <OptionCard
                    key={f.id}
                    optionId={f.id}
                    selected={draft.fightingStyle === f.id}
                    onSelect={() => update({ ...draft, fightingStyle: f.id })}
                    title={f.name}
                  >
                    {f.description}
                  </OptionCard>
                ))}
              </div>
            </>
          )}

          {selected.tools?.fixed && (
            <p className="hint">Инструменты: {selected.tools.fixed.map((id) => itemCatalog[id].name).join(', ')}.</p>
          )}
          {selected.tools?.choose && (
            <section className="skill-slot" data-slot="classTools" aria-label="Инструменты класса">
              <h4>
                Инструменты ({selected.tools.choose.kinds.map((k) => TOOL_KIND_LABELS[k].toLowerCase()).join(' или ')})
                <span className={`slot-count${draft.classTools.length === selected.tools.choose.count ? ' is-done' : ''}`}>
                  {draft.classTools.length} из {selected.tools.choose.count}
                </span>
              </h4>
              <div className="chip-row">
                {toolsOfKinds(selected.tools.choose.kinds, data).map((id) => {
                  const checked = draft.classTools.includes(id)
                  return (
                    <ChoiceChip
                      key={id}
                      value={id}
                      checked={checked}
                      disabled={!checked && draft.classTools.length >= selected.tools!.choose!.count}
                      onToggle={() =>
                        update({ ...draft, classTools: checked ? draft.classTools.filter((t) => t !== id) : [...draft.classTools, id] })
                      }
                    >
                      {itemCatalog[id].name}
                    </ChoiceChip>
                  )
                })}
              </div>
              {selected.equipment.some((o) => o.items.some((l) => l.chosenTool === 'class')) && (
                <p className="hint">Первый выбранный инструмент войдёт в стартовое снаряжение.</p>
              )}
            </section>
          )}
        </Details>
      )}
    </>
  )
}

// ---------- Предыстория ----------

/** Выбор одного инструмента из списка (выпадающий список по видам). */
function ToolSelect({ label, value, options, onChange }: { label: string; value: string | null; options: string[]; onChange: (id: string | null) => void }) {
  const byKind = TOOL_KIND_ORDER.map((kind) => [kind, options.filter((id) => itemCatalog[id].toolKind === kind)] as const).filter(([, ids]) => ids.length > 0)
  return (
    <label className="field tool-select">
      <span>{label}</span>
      <select aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">— выберите —</option>
        {byKind.map(([kind, ids]) => (
          <optgroup key={kind} label={TOOL_KIND_LABELS[kind]}>
            {ids.map((id) => (
              <option key={id} value={id}>
                {itemCatalog[id].name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  )
}

function BonusChooser({ draft, update, abilities }: StepProps & { abilities: readonly Ability[] }) {
  return (
    <>
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
      {abilities.length === 0 ? (
        <p className="hint">Сначала выберите три характеристики предыстории.</p>
      ) : draft.bonusMode === 'two-one' ? (
        <div className="bonus-rows">
          {(['bonusPlus2', 'bonusPlus1'] as const).map((key) => (
            <div key={key} className="bonus-row" role="radiogroup" aria-label={key === 'bonusPlus2' ? 'Прибавка +2' : 'Прибавка +1'}>
              <span className="bonus-label">{key === 'bonusPlus2' ? '+2' : '+1'}</span>
              {abilities.map((ability) => {
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
        <p className="hint">+1 к {abilityList(abilities)}.</p>
      )}
    </>
  )
}

/** Конструктор своей предыстории по шаблону 2024. */
function CustomBackgroundForm({ draft, update }: StepProps) {
  const input = draft.customBackground
  const patch = (p: Partial<CustomBackgroundInput>) => update(updateCustomBackground(draft, p, data))
  const toggle = <T,>(list: T[], value: T, max: number) =>
    list.includes(value) ? list.filter((v) => v !== value) : list.length < max ? [...list, value] : list
  const [filter, setFilter] = useState('')
  const spent = equipmentCost(input.items, itemCatalog)
  const left = Math.round((BACKGROUND_TEMPLATE.budget - spent) * 100) / 100
  const quantityOf = (id: string) => input.items.find((i) => i.itemId === id)?.quantity ?? 0
  const setQuantity = (id: string, quantity: number) =>
    patch({
      items: quantity <= 0 ? input.items.filter((i) => i.itemId !== id) : input.items.some((i) => i.itemId === id)
        ? input.items.map((i) => (i.itemId === id ? { ...i, quantity } : i))
        : [...input.items, { itemId: id, quantity }],
    })
  const query = filter.trim().toLowerCase()
  const shop = purchasableItems(itemCatalog)
    .filter((item) => !query || item.name.toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))

  return (
    <section className="creation-details custom-background" aria-label="Своя предыстория">
      <h3>Своя предыстория</h3>
      <p className="hint">По шаблону правил 2024: три характеристики, два навыка, инструмент, черта происхождения и снаряжение на 50 зм.</p>
      <div className="details-form">
        <label className="field">
          <span>Название</span>
          <input
            value={input.name}
            maxLength={BACKGROUND_TEMPLATE.maxNameLength}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="Например, Корабельный юнга"
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span>Кем вы были (необязательно)</span>
          <textarea
            rows={2}
            maxLength={BACKGROUND_TEMPLATE.maxDescriptionLength}
            value={input.description}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </label>
      </div>

      <section className="skill-slot" data-slot="custom-abilities" aria-label="Характеристики предыстории">
        <h4>
          Характеристики для прибавок
          <span className={`slot-count${input.abilities.length === 3 ? ' is-done' : ''}`}>{input.abilities.length} из 3</span>
        </h4>
        <div className="chip-row">
          {ABILITIES.map((a) => (
            <ChoiceChip
              key={a}
              value={a}
              checked={input.abilities.includes(a)}
              disabled={!input.abilities.includes(a) && input.abilities.length >= 3}
              onToggle={() => patch({ abilities: toggle(input.abilities, a, 3) })}
            >
              {ABILITY_NAMES[a]}
            </ChoiceChip>
          ))}
        </div>
      </section>

      <section className="skill-slot" data-slot="custom-skills" aria-label="Навыки предыстории">
        <h4>
          Навыки
          <span className={`slot-count${input.skills.length === 2 ? ' is-done' : ''}`}>{input.skills.length} из 2</span>
        </h4>
        <div className="chip-row">
          {SKILLS_BY_NAME.map((skill) => (
            <ChoiceChip
              key={skill}
              value={skill}
              checked={input.skills.includes(skill)}
              disabled={!input.skills.includes(skill) && input.skills.length >= 2}
              onToggle={() => patch({ skills: toggle(input.skills, skill, 2) })}
            >
              {SKILL_DEFINITIONS[skill].name}
            </ChoiceChip>
          ))}
        </div>
      </section>

      <ToolSelect label="Инструмент" value={input.tool} options={ALL_TOOLS} onChange={(tool) => patch({ tool })} />

      <h4>Черта происхождения</h4>
      <div className="option-grid option-grid--compact" role="radiogroup" aria-label="Черта своей предыстории">
        {featsOfCategory('origin', data).map((f) => (
          <OptionCard key={f.id} optionId={f.id} selected={input.feat === f.id} onSelect={() => patch({ feat: f.id })} title={f.name}>
            {f.description}
          </OptionCard>
        ))}
      </div>

      <h4 className="shop-heading">
        Снаряжение (вариант A)
        <span className={`slot-count${left >= 0 ? ' is-done' : ''}`} data-testid="budget-left">
          осталось {formatGold(left)} зм
        </span>
      </h4>
      <p className="hint">Потратьте до 50 зм — сдача останется золотом. На шаге «Снаряжение» можно будет взять вместо этого 50 зм.</p>
      <input className="shop-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Поиск предмета…" aria-label="Поиск предмета" />
      <ul className="shop-list" aria-label="Предметы для покупки">
        {shop.map((item) => {
          const qty = quantityOf(item.id)
          return (
            <li key={item.id} className={qty > 0 ? 'is-chosen' : undefined} data-shop-item={item.id}>
              <span className="item-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="shop-name">{item.name}</span>
              <span className="shop-cost">{formatGold(item.cost!)} зм</span>
              <span className="shop-qty">
                <button type="button" aria-label={`Меньше: ${item.name}`} disabled={qty === 0} onClick={() => setQuantity(item.id, qty - 1)}>
                  −
                </button>
                <span>{qty}</span>
                <button type="button" aria-label={`Больше: ${item.name}`} disabled={item.cost! > left} onClick={() => setQuantity(item.id, qty + 1)}>
                  +
                </button>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const BACKSTORY_PLACEHOLDER = 'Например: бывший моряк, сбежал с корабля после бунта, ищет брата.'

/** Готовая предыстория или «Собрать вручную»: внизу — необязательная «История героя» (то же поле, что у своей истории). */
function OptionalBackstory({ draft, update }: StepProps) {
  return (
    <section className="creation-backstory" aria-label="История героя">
      <label className="field">
        <span>История героя (необязательно)</span>
        <textarea
          rows={3}
          maxLength={MAX_BACKSTORY_LENGTH}
          value={draft.backstory}
          onChange={(e) => update({ ...draft, backstory: e.target.value })}
          placeholder={BACKSTORY_PLACEHOLDER}
          data-testid="backstory"
        />
      </label>
      <p className="hint">Несколько слов о прошлом героя — ведущий использует это в сюжете.</p>
    </section>
  )
}

const STAGE_LABELS: Record<SuggestStage, (attempt: number) => string> = {
  sending: () => 'Отправляю историю…',
  reading: () => 'Мастер читает и подбирает…',
  checking: () => 'Проверяю по правилам…',
  fixing: (attempt) => `Мастер исправляет (попытка ${attempt} из ${MAX_PROPOSAL_ATTEMPTS})…`,
}

/**
 * «Написать свою историю»: большое обязательное поле и подбор механики ИИ (этапы, секунды, «Отменить», тайм-аут);
 * предложение с объяснениями, «Предложить иначе», дописанные детали. Без ключа API — механика собирается вручную.
 */
function StoryBackground({ draft, update, aiReady }: StepProps & { aiReady: boolean }) {
  const { settings, apiKey } = useAiSettings()
  const task = useAiTask()
  const [preview, setPreview] = useState<string | null>(null)
  const [reasoning, setReasoning] = useState(false)
  // Свежий черновик для ответа ИИ: пока он думает, игрок может листать другие пункты.
  const draftRef = useRef(draft)
  useEffect(() => {
    draftRef.current = draft
  }, [draft])
  const proposal = draft.backgroundProposal
  const problem = backstoryProblem(draft.backstory)
  const running = task.state.status === 'running'
  const model = aiConnection(settings, apiKey).model
  const reasoningModel = isReasoningModel(model)

  const suggest = async () => {
    setPreview(null)
    setReasoning(false)
    const result = await task.run(STAGE_LABELS.sending(1), ({ signal, setStage, setReceived }) => {
      const master = timedFor(createMaster(aiConnection(settings, apiKey)), 'background', model, { signal })
      return suggestBackground(master, draftRef.current.backstory, data, {
        previous: proposal,
        signal,
        onStage: (stage, attempt) => setStage(STAGE_LABELS[stage](attempt)),
        onProgress: (p) => {
          setReceived(p.textChars + p.toolChars)
          if (p.reasoningChars > 0) setReasoning(true)
          const name = partialName(p.toolArgs)
          if (name) setPreview(name)
        },
      })
    })
    if (result.status === 'done') update(applyBackgroundProposal(draftRef.current, result.value, data))
  }

  return (
    <section className="creation-details story-proposal" aria-label="Своя история героя" data-testid="story-proposal">
      <label className="field backstory-field">
        <span>История героя</span>
        <textarea
          rows={7}
          maxLength={MAX_BACKSTORY_LENGTH}
          value={draft.backstory}
          readOnly={running}
          aria-required="true"
          onChange={(e) => update({ ...draft, backstory: e.target.value })}
          placeholder={BACKSTORY_PLACEHOLDER}
          data-testid="backstory"
        />
      </label>
      <p className="hint">
        О чём написать: откуда герой родом и чем занимался до приключений, что умеет, кого потерял или ищет, кому должен, чего боится.
        Хватит 3–6 предложений своими словами.
      </p>

      {aiReady ? (
        <>
          {reasoningModel && !running && (
            <p className="hint proposal-warning" data-testid="reasoning-warning">
              Выбрана рассуждающая модель ({model}): перед ответом она долго «думает» — подбор может занять минуту и больше.
            </p>
          )}
          {!running && (
            <button type="button" className="primary-button" onClick={() => void suggest()} disabled={!!problem} data-testid="suggest-background">
              {proposal ? 'Предложить иначе' : 'Подобрать предысторию по истории'}
            </button>
          )}
          {problem && !running && !proposal && <p className="hint">{problem}</p>}
          <AiProgress
            state={task.state}
            onCancel={task.cancel}
            note={
              <>
                {preview && <span data-testid="proposal-preview">Название: «{preview}»</span>}
                {reasoning && <span> Модель «размышляет» перед ответом — это дольше обычного.</span>}
              </>
            }
          />
          <AiTaskError state={task.state} testId="proposal-error">
            <button type="button" className="primary-button" onClick={() => void suggest()} data-testid="proposal-retry">
              Попробовать ещё раз
            </button>
            <button type="button" className="secondary-button" onClick={() => update(chooseCustomBackground(draft, 'manual', data))} data-testid="proposal-manual">
              Собрать вручную
            </button>
          </AiTaskError>
        </>
      ) : (
        <p className="hint" data-testid="story-no-ai">
          ИИ-ведущий не настроен (нет ключа API в «Настройки» → «Ведущий»), поэтому механику предыстории соберите вручную ниже — ваша история
          сохранится в листе героя и попадёт к ведущему.
        </p>
      )}

      {proposal && !running && (
        <>
          <dl className="fact-list proposal-explanations" data-testid="proposal-explanations">
            {EXPLANATION_KEYS.map((key) => (
              <Fragment key={key}>
                <dt>{EXPLANATION_LABELS[key]}</dt>
                <dd>{proposal.explanations[key]}</dd>
              </Fragment>
            ))}
          </dl>
          {proposal.details.length > 0 && (
            <section className="proposal-details" aria-label="Что ИИ предлагает дописать" data-testid="proposal-details">
              <h4>ИИ предлагает дописать в историю</h4>
              <p className="hint">Это не ваши слова — решите сами, оставить ли.</p>
              <ul>
                {proposal.details.map((d, i) => (
                  <li key={i} className={`proposal-detail is-${d.status}`} data-status={d.status}>
                    <span>{d.text}</span>
                    {d.status === 'pending' ? (
                      <span className="proposal-detail-actions">
                        <button type="button" className="secondary-button" onClick={() => update(decideProposalDetail(draft, i, true))}>
                          Добавить
                        </button>
                        <button type="button" className="secondary-button" onClick={() => update(decideProposalDetail(draft, i, false))}>
                          Не надо
                        </button>
                      </span>
                    ) : (
                      <span className="proposal-detail-status">{d.status === 'accepted' ? 'Добавлено' : 'Отклонено'}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="hint">Ниже — предложенная предыстория. Любой пункт можно поменять вручную.</p>
        </>
      )}
    </section>
  )
}

export function BackgroundStep({ draft, update }: StepProps) {
  const selected = backgroundOf(draft, data)
  const isCustom = draft.backgroundId === CUSTOM_BACKGROUND_ID
  const fromStory = isCustom && draft.backgroundSource === 'story'
  const feat = selected ? data.feats[selected.feat] : undefined
  const ai = useAiSettings()
  const aiReady = settingsProblems(ai.settings, ai.apiKey).length === 0
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
        <OptionCard
          optionId={CUSTOM_BACKGROUND_ID}
          selected={isCustom && !fromStory}
          onSelect={() => update(chooseCustomBackground(draft, 'manual', data))}
          title="Собрать вручную"
          meta="по шаблону правил 2024"
        >
          Сами выберите характеристики, навыки, инструмент, черту и снаряжение на 50 зм.
        </OptionCard>
        <OptionCard
          optionId="from-story"
          selected={fromStory}
          wide
          onSelect={() => update(chooseCustomBackground(draft, 'story', data))}
          title="Написать свою историю"
          meta={aiReady ? 'ИИ подберёт механику по вашим словам' : 'без ключа API — механика вручную'}
        >
          Расскажите своими словами, кем был ваш герой до приключений, — ведущий подберёт предысторию по правилам 2024 и объяснит
          каждый выбор, а потом будет вплетать ваше прошлое в сюжет.
        </OptionCard>
      </div>

      {fromStory && <StoryBackground draft={draft} update={update} aiReady={aiReady} />}
      {isCustom && (!fromStory || draft.backgroundProposal || !aiReady) && <CustomBackgroundForm draft={draft} update={update} />}

      {selected && !isCustom && feat && (
        <Details title={selected.name}>
          <dl className="fact-list">
            <dt>Черта</dt>
            <dd>
              <strong>{feat.name}</strong>
              {selected.featNote && ` (${selected.featNote})`}. {feat.description}
            </dd>
            <dt>Навыки</dt>
            <dd>{skillList(selected.skills)}</dd>
            <dt>Инструмент</dt>
            <dd>{selected.tool.itemId ? itemCatalog[selected.tool.itemId].name : `${TOOL_KIND_LABELS[selected.tool.choose!]} на выбор`}</dd>
          </dl>
          {selected.tool.choose && (
            <ToolSelect
              label="Ваш инструмент"
              value={draft.backgroundTool}
              options={toolsOfKinds([selected.tool.choose], data)}
              onChange={(backgroundTool) => update({ ...draft, backgroundTool })}
            />
          )}
          <BonusChooser draft={draft} update={update} abilities={selected.abilities} />
        </Details>
      )}

      {selected && isCustom && (!fromStory || draft.backgroundProposal || !aiReady) && (
        <section className="creation-details">
          <BonusChooser draft={draft} update={update} abilities={selected.abilities} />
        </section>
      )}

      {selected && !fromStory && <OptionalBackstory draft={draft} update={update} />}
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
                {featsOfCategory('origin', data).map((f) => (
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
          {line.chosenTool !== undefined ? (
            <>{line.chosenTool === 'class' ? 'выбранный инструмент класса' : 'выбранный инструмент предыстории'}</>
          ) : line.packId !== undefined ? (
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
  const background = backgroundOf(draft, data)
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
