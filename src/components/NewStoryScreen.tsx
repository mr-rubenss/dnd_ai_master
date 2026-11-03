import { useState, type FormEvent } from 'react'
import type { AdventureData } from '../game/adventure'
import type { NewStoryRequest } from '../game/appStore'
import { MAX_STORY_TITLE_LENGTH, TONE_LABELS } from '../game/storyActions'
import type { HeroRecord } from '../types/heroes'
import { STORY_TONES, type StoryTone } from '../types/story'

interface Props {
  heroes: HeroRecord[]
  adventures: AdventureData[]
  defaultAdventureId: string
  /** Герой, выбранный заранее (например, только что созданный). */
  initialHeroId?: string | null
  onCreateHero: () => void
  onStart: (request: NewStoryRequest) => Promise<string | null>
}

/** Новая история: свободный герой (или новый), название, тон и приключение. */
export function NewStoryScreen({ heroes, adventures, defaultAdventureId, initialHeroId, onCreateHero, onStart }: Props) {
  const free = heroes.filter((h) => !h.storyId)
  const [heroId, setHeroId] = useState<string | null>(
    initialHeroId && free.some((h) => h.id === initialHeroId) ? initialHeroId : (free[0]?.id ?? null),
  )
  const [adventureId, setAdventureId] = useState(defaultAdventureId)
  const adventure = adventures.find((a) => a.id === adventureId)!
  const [title, setTitle] = useState(adventure.defaultStoryTitle)
  const [tone, setTone] = useState<StoryTone>(adventure.defaultTone)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!heroId) return setError('Выберите героя или создайте нового.')
    setBusy(true)
    const reason = await onStart({ title, tone, adventureId, heroIds: [heroId] })
    setBusy(false)
    setError(reason)
  }

  return (
    <main className="heroes" aria-labelledby="new-story-title">
      <form className="panel heroes-card new-story" onSubmit={submit}>
        <header className="heroes-header">
          <h2 id="new-story-title">Новая история</h2>
        </header>

        <fieldset className="new-story-field">
          <legend>Герой</legend>
          {free.length === 0 && <p className="heroes-empty">Свободных героев нет — все уже в историях. Создайте нового.</p>}
          <div className="new-story-options">
            {free.map((hero) => (
              <label key={hero.id} className={`choice-card${heroId === hero.id ? ' is-selected' : ''}`}>
                <input type="radio" name="hero" value={hero.id} checked={heroId === hero.id} onChange={() => setHeroId(hero.id)} />
                <span className="hero-portrait" aria-hidden="true">
                  {hero.portrait}
                </span>
                <span>
                  <strong>{hero.sheet.character.name}</strong>
                  <small>
                    {hero.sheet.character.species} · {hero.sheet.character.className} {hero.sheet.character.level} ур.
                  </small>
                </span>
              </label>
            ))}
          </div>
          <button type="button" className="item-action" onClick={onCreateHero} data-testid="new-story-create-hero">
            Создать нового героя
          </button>
        </fieldset>

        <fieldset className="new-story-field">
          <legend>Приключение</legend>
          <div className="new-story-options">
            {adventures.map((a) => (
              <label key={a.id} className={`choice-card${adventureId === a.id ? ' is-selected' : ''}`}>
                <input
                  type="radio"
                  name="adventure"
                  value={a.id}
                  checked={adventureId === a.id}
                  onChange={() => {
                    setAdventureId(a.id)
                    setTitle(a.defaultStoryTitle)
                    setTone(a.defaultTone)
                  }}
                />
                <span>
                  <strong>{a.title}</strong>
                  <small>{a.description}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="new-story-field">
          <label htmlFor="new-story-name" className="new-story-label">
            Название
          </label>
          <input id="new-story-name" className="text-input" value={title} maxLength={MAX_STORY_TITLE_LENGTH} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <fieldset className="new-story-field">
          <legend>Тон</legend>
          <div className="tone-options">
            {STORY_TONES.map((t) => (
              <label key={t} className={`tone-chip${tone === t ? ' is-selected' : ''}`}>
                <input type="radio" name="tone" value={t} checked={tone === t} onChange={() => setTone(t)} />
                {TONE_LABELS[t]}
              </label>
            ))}
          </div>
          <p className="new-story-hint">Название и тон задают ведущему настроение истории.</p>
        </fieldset>

        {error && (
          <p className="equip-error new-story-error" role="alert">
            {error}
          </p>
        )}
        <footer className="new-story-footer">
          <button type="submit" className="primary-button" disabled={busy || !heroId}>
            Начать историю
          </button>
        </footer>
      </form>
    </main>
  )
}
