import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { itemCatalog } from '../data'
import { armorClass } from '../game/character'
import { MAX_HERO_NAME_LENGTH } from '../game/heroes'
import type { CharacterSheet } from '../types/character'
import type { HallOfFameEntry, HeroRecord, HeroRoster } from '../types/heroes'
import type { StoryMeta, StoryState } from '../types/story'
import { CharacterStats } from './CharacterStats'

type Tab = 'heroes' | 'hall'

interface Props {
  roster: HeroRoster
  stories: StoryMeta[]
  /** Состояние истории — чтобы показать актуальный лист героя из неё. */
  readStory: (storyId: string) => Promise<StoryState | null>
  initialTab?: Tab
  onCreate: () => void
  /** Начать новую историю с этим героем. */
  onStart: (heroId: string) => void
  onContinue: (storyId: string) => void
  /** Возвращают причину отказа или null. */
  onRename: (heroId: string, name: string) => Promise<string | null>
  onDelete: (heroId: string) => Promise<string | null>
}

/** «Мои герои»: все созданные персонажи и «Зал славы» тех, чей путь закончен. */
export function HeroesScreen({ roster, stories, readStory, initialTab = 'heroes', onCreate, onStart, onContinue, onRename, onDelete }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const [viewing, setViewing] = useState<{ hero: HeroRecord; sheet: CharacterSheet } | null>(null)
  const storyOf = (hero: HeroRecord) => (hero.storyId ? stories.find((s) => s.id === hero.storyId) : undefined)

  /** Лист героя: у героя в истории — актуальный, из отряда этой истории. */
  const view = async (hero: HeroRecord) => {
    const story = hero.storyId ? await readStory(hero.storyId) : null
    const member = story?.party.find((m) => m.heroId === hero.id)
    setViewing({ hero, sheet: member ? { character: member.character, inventory: member.inventory } : hero.sheet })
  }

  return (
    <main className="heroes" aria-labelledby="heroes-title">
      <section className="panel heroes-card">
        <header className="heroes-header">
          <h2 id="heroes-title">Мои герои</h2>
          <button type="button" className="primary-button" onClick={onCreate} data-testid="heroes-create">
            Создать героя
          </button>
        </header>

        <div className="sheet-tabs heroes-tabs" role="tablist" aria-label="Герои">
          <button type="button" role="tab" aria-selected={tab === 'heroes'} className={tab === 'heroes' ? 'is-active' : undefined} onClick={() => setTab('heroes')}>
            Герои ({roster.heroes.length})
          </button>
          <button type="button" role="tab" aria-selected={tab === 'hall'} className={tab === 'hall' ? 'is-active' : undefined} onClick={() => setTab('hall')}>
            Зал славы ({roster.hallOfFame.length})
          </button>
        </div>

        {tab === 'heroes' ? (
          roster.heroes.length === 0 ? (
            <p className="heroes-empty">Пока нет ни одного героя. Создайте первого — он появится здесь.</p>
          ) : (
            <ul className="hero-list">
              {roster.heroes.map((hero) => (
                <HeroCard
                  key={hero.id}
                  hero={hero}
                  sheet={hero.sheet}
                  story={storyOf(hero)}
                  onView={() => void view(hero)}
                  onStart={() => onStart(hero.id)}
                  onContinue={() => hero.storyId && onContinue(hero.storyId)}
                  onRename={(name) => onRename(hero.id, name)}
                  onDelete={() => onDelete(hero.id)}
                />
              ))}
            </ul>
          )
        ) : roster.hallOfFame.length === 0 ? (
          <p className="heroes-empty">Зал славы пуст. Сюда попадают погибшие герои и герои завершённых историй.</p>
        ) : (
          <ul className="hero-list">
            {roster.hallOfFame.map((entry) => (
              <HallCard key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
      </section>
      {viewing && <HeroSheetDialog hero={viewing.hero} sheet={viewing.sheet} onClose={() => setViewing(null)} />}
    </main>
  )
}

interface HeroCardProps {
  hero: HeroRecord
  sheet: CharacterSheet
  /** Незавершённая история героя. */
  story: StoryMeta | undefined
  onView: () => void
  onStart: () => void
  onContinue: () => void
  onRename: (name: string) => Promise<string | null>
  onDelete: () => Promise<string | null>
}

function HeroCard({ hero, sheet, story, onView, onStart, onContinue, onRename, onDelete }: HeroCardProps) {
  // Имя и уровень героя в истории — из её отряда (они могут меняться только там).
  const member = story?.party.find((m) => m.heroId === hero.id)
  const character = { ...sheet.character, ...(member ? { name: member.name, level: member.level } : {}) }
  const storyTitle = story?.title ?? null
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(character.name)
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const reason = await onRename(name)
    setError(reason)
    if (!reason) setRenaming(false)
  }

  const remove = async () => {
    if (!window.confirm(`Удалить героя «${character.name}»? Это нельзя отменить.`)) return
    setError(await onDelete())
  }

  return (
    <li className="hero-card" data-testid={`hero-${hero.id}`}>
      <span className="hero-portrait" aria-hidden="true">
        {hero.portrait}
      </span>
      <div className="hero-info">
        <h3 className="hero-name">{character.name}</h3>
        <p className="hero-meta">
          {character.species} · {character.className} {character.level} ур.
        </p>
        <p className={`hero-story${storyTitle ? ' is-active' : ''}`} data-testid="hero-story">
          {storyTitle ? `В истории «${storyTitle}»` : 'Вне истории'}
        </p>
      </div>

      {renaming ? (
        <form className="hero-rename" onSubmit={submit}>
          <label htmlFor={inputId} className="visually-hidden">
            Новое имя
          </label>
          <input id={inputId} value={name} maxLength={MAX_HERO_NAME_LENGTH} onChange={(e) => setName(e.target.value)} autoFocus />
          <button type="submit" className="item-action is-primary">
            Сохранить
          </button>
          <button
            type="button"
            className="item-action"
            onClick={() => {
              setRenaming(false)
              setName(character.name)
              setError(null)
            }}
          >
            Отмена
          </button>
        </form>
      ) : (
        <div className="item-actions hero-actions">
          {storyTitle ? (
            <button type="button" className="item-action is-primary" onClick={onContinue}>
              Продолжить
            </button>
          ) : (
            <button type="button" className="item-action is-primary" onClick={onStart}>
              Начать историю
            </button>
          )}
          <button type="button" className="item-action" onClick={onView}>
            Лист персонажа
          </button>
          <button
            type="button"
            className="item-action"
            onClick={() => {
              setName(character.name)
              setRenaming(true)
            }}
          >
            Переименовать
          </button>
          <button
            type="button"
            className="item-action item-action--danger"
            onClick={remove}
            disabled={Boolean(storyTitle)}
            title={storyTitle ? 'Героя в незавершённой истории удалить нельзя' : undefined}
          >
            Удалить
          </button>
        </div>
      )}
      {error && (
        <p className="equip-error hero-error" role="alert">
          {error}
        </p>
      )}
    </li>
  )
}

const FATE_LABELS = { fallen: 'Гибель', completed: 'История завершена' } as const

function HallCard({ entry }: { entry: HallOfFameEntry }) {
  return (
    <li className={`hero-card hero-card--hall hero-card--${entry.fate}`} data-testid={`hall-${entry.heroId}`}>
      <span className="hero-portrait" aria-hidden="true">
        {entry.portrait}
      </span>
      <div className="hero-info">
        <h3 className="hero-name">{entry.name}</h3>
        <p className="hero-meta">
          {entry.species} · {entry.className} {entry.level} ур.
        </p>
        <p className="hero-fate">
          <span className={`fate-badge fate-badge--${entry.fate}`}>{FATE_LABELS[entry.fate]}</span>
          <time dateTime={new Date(entry.endedAt).toISOString()}>{new Date(entry.endedAt).toLocaleDateString('ru-RU')}</time>
        </p>
        <p className="hero-summary" data-testid="hall-summary">
          {entry.summary}
        </p>
      </div>
    </li>
  )
}

/** Лист персонажа героя в окне поверх списка. */
function HeroSheetDialog({ hero, sheet, onClose }: { hero: HeroRecord; sheet: CharacterSheet; onClose: () => void }) {
  const { character, inventory } = sheet
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const equipped = Object.values(inventory.equipped)
    .filter((id): id is string => id !== null)
    .map((id) => itemCatalog[id]?.name ?? id)

  return (
    <div className="hero-dialog-backdrop" onClick={onClose}>
      <div className="panel hero-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <header className="hero-dialog-header">
          <span className="hero-portrait" aria-hidden="true">
            {hero.portrait}
          </span>
          <div>
            <h3 id={titleId}>{character.name}</h3>
            <p className="hero-meta">
              {character.species} · {character.className} {character.level} ур. · {character.background}
            </p>
          </div>
          <button ref={closeRef} type="button" className="header-button" onClick={onClose}>
            Закрыть
          </button>
        </header>
        <dl className="summary-stats hero-dialog-stats">
          <div>
            <dt>Хиты</dt>
            <dd>
              {character.hp} / {character.maxHp}
            </dd>
          </div>
          <div>
            <dt>КД</dt>
            <dd data-testid="hero-sheet-ac">{armorClass(character, inventory, itemCatalog)}</dd>
          </div>
          <div>
            <dt>Золото</dt>
            <dd>{inventory.gold} зм</dd>
          </div>
        </dl>
        <p className="hero-dialog-equipped">
          <strong>Экипировано:</strong> {equipped.length > 0 ? equipped.join(', ') : 'ничего'}
        </p>
        <CharacterStats character={character} />
      </div>
    </div>
  )
}
