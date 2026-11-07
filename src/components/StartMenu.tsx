import { startingSheet } from '../data'
import type { StoryMeta } from '../types/story'
import { partyLine } from './storyText'

interface Props {
  /** Последняя незавершённая история, если есть. */
  latest: StoryMeta | null
  storyCount: number
  heroCount: number
  onContinue: (storyId: string) => void
  onStories: () => void
  onHeroes: () => void
  onCreate: () => void
  onQuickStart: () => void
  /** «Что-то не так» — тестовый отчёт. */
  onReport: () => void
}

/** Стартовый экран: продолжить последнюю историю, мои истории и герои, создать героя или быстрый старт. */
export function StartMenu({ latest, storyCount, heroCount, onContinue, onStories, onHeroes, onCreate, onQuickStart, onReport }: Props) {
  const hero = startingSheet.character

  return (
    <main className="start-menu" aria-labelledby="start-menu-title">
      <section className="panel start-menu-card">
        <h2 id="start-menu-title">Добро пожаловать к столу</h2>
        <p className="start-menu-lead">Текстовое приключение по правилам D&amp;D 2024 с ИИ-ведущим.</p>

        <div className="start-menu-actions">
          {latest && (
            <button type="button" className="menu-option menu-option--primary" onClick={() => onContinue(latest.id)} data-testid="menu-continue">
              <span className="menu-option-title">Продолжить</span>
              <span className="menu-option-text">
                «{latest.title}»: <strong>{partyLine(latest)}</strong> · {latest.locationName}
              </span>
            </button>
          )}
          <button type="button" className="menu-option" onClick={onStories} data-testid="menu-stories">
            <span className="menu-option-title">Мои истории</span>
            <span className="menu-option-text">
              {storyCount === 0 ? 'Пока пусто.' : `Историй: ${storyCount}.`} У каждой — свой отряд, мир и журнал.
            </span>
          </button>
          <button type="button" className="menu-option" onClick={onHeroes} data-testid="menu-heroes">
            <span className="menu-option-title">Мои герои</span>
            <span className="menu-option-text">
              {heroCount === 0 ? 'Пока пусто.' : `Героев: ${heroCount}.`} Листы персонажей и «Зал славы».
            </span>
          </button>
          <button type="button" className={`menu-option${latest ? '' : ' menu-option--primary'}`} onClick={onCreate} data-testid="menu-create">
            <span className="menu-option-title">Создать нового героя</span>
            <span className="menu-option-text">Класс, предыстория, вид, характеристики и снаряжение по шагам.</span>
          </button>
          <button type="button" className="menu-option" onClick={onQuickStart} data-testid="menu-quick-start">
            <span className="menu-option-title">Быстрый старт ({hero.name})</span>
            <span className="menu-option-text">
              Готовый герой: {hero.species.toLowerCase()}, {hero.className.toLowerCase()} {hero.level} уровня. Если{' '}
              {hero.name} уже в истории — продолжить её.
            </span>
          </button>
        </div>
        <p className="start-menu-report">
          <button type="button" className="report-button" onClick={onReport} data-testid="report-button">
            Что-то не так
          </button>
          <span>— тестовый отчёт для разработчика: что произошло, последние ходы и ошибки.</span>
        </p>
      </section>
    </main>
  )
}
