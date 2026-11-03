import { useState, type FormEvent } from 'react'
import { MAX_STORY_TITLE_LENGTH, TONE_LABELS } from '../game/storyActions'
import type { StoryMeta } from '../types/story'
import { partyLine } from './storyText'

interface Props {
  stories: StoryMeta[]
  onNew: () => void
  onContinue: (storyId: string) => void
  /** Возвращают причину отказа или null. */
  onRename: (storyId: string, title: string) => Promise<string | null>
  onDelete: (storyId: string) => Promise<string | null>
}

const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** «Мои истории»: все кампании игрока, у каждой — свой отряд, мир и журнал. */
export function StoriesScreen({ stories, onNew, onContinue, onRename, onDelete }: Props) {
  return (
    <main className="heroes" aria-labelledby="stories-title">
      <section className="panel heroes-card">
        <header className="heroes-header">
          <h2 id="stories-title">Мои истории</h2>
          <button type="button" className="primary-button" onClick={onNew} data-testid="stories-new">
            Новая история
          </button>
        </header>
        {stories.length === 0 ? (
          <p className="heroes-empty">Историй пока нет. Начните новую — выберите героя, название и тон.</p>
        ) : (
          <ul className="hero-list">
            {stories.map((story) => (
              <StoryCard key={story.id} story={story} onContinue={() => onContinue(story.id)} onRename={(t) => onRename(story.id, t)} onDelete={() => onDelete(story.id)} />
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

interface CardProps {
  story: StoryMeta
  onContinue: () => void
  onRename: (title: string) => Promise<string | null>
  onDelete: () => Promise<string | null>
}

function StoryCard({ story, onContinue, onRename, onDelete }: CardProps) {
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(story.title)
  const [error, setError] = useState<string | null>(null)
  const completed = story.status === 'completed'

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const reason = await onRename(title)
    setError(reason)
    if (!reason) setRenaming(false)
  }

  const remove = async () => {
    const heroes = story.party.map((m) => m.name).join(', ')
    const note = completed ? '' : ` Герои (${heroes}) вернутся в «Мои герои».`
    if (!window.confirm(`Удалить историю «${story.title}»? Её мир, журнал и сообщения пропадут безвозвратно.${note}`)) return
    setError(await onDelete())
  }

  return (
    <li className="hero-card story-card" data-testid={`story-${story.id}`}>
      <span className="hero-portrait" aria-hidden="true">
        {completed ? '🏆' : '📖'}
      </span>
      <div className="hero-info">
        <h3 className="hero-name" data-testid="story-title">
          {story.title}
        </h3>
        <p className="hero-meta" data-testid="story-party">
          {partyLine(story)}
        </p>
        <p className="hero-meta">
          {TONE_LABELS[story.tone]} · <span data-testid="story-location">{story.locationName}</span>
        </p>
        <p className="hero-story">
          {completed && <span className="fate-badge fate-badge--completed">Завершена</span>} Последняя игра:{' '}
          <time dateTime={new Date(story.lastPlayedAt).toISOString()}>{dateFormat.format(story.lastPlayedAt)}</time>
        </p>
      </div>
      {renaming ? (
        <form className="hero-rename" onSubmit={submit}>
          <label htmlFor={`title-${story.id}`} className="visually-hidden">
            Новое название
          </label>
          <input id={`title-${story.id}`} value={title} maxLength={MAX_STORY_TITLE_LENGTH} onChange={(e) => setTitle(e.target.value)} autoFocus />
          <button type="submit" className="item-action is-primary">
            Сохранить
          </button>
          <button
            type="button"
            className="item-action"
            onClick={() => {
              setRenaming(false)
              setTitle(story.title)
              setError(null)
            }}
          >
            Отмена
          </button>
        </form>
      ) : (
        <div className="item-actions hero-actions">
          {!completed && (
            <button type="button" className="item-action is-primary" onClick={onContinue}>
              Продолжить
            </button>
          )}
          {!completed && (
            <button
              type="button"
              className="item-action"
              onClick={() => {
                setTitle(story.title)
                setRenaming(true)
              }}
            >
              Переименовать
            </button>
          )}
          <button type="button" className="item-action item-action--danger" onClick={remove}>
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
