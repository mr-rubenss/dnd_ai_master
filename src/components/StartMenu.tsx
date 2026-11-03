import { locations, startingSheet } from '../data'
import type { GameState } from '../types/game'

interface Props {
  /** Сохранённая игра, если есть. */
  save: GameState | null
  /** Сколько героев в «Моих героях». */
  heroCount: number
  onContinue: () => void
  onHeroes: () => void
  onCreate: () => void
  onQuickStart: () => void
}

/** Стартовый экран: продолжить сохранённую игру, создать героя или начать за готового. */
export function StartMenu({ save, heroCount, onContinue, onHeroes, onCreate, onQuickStart }: Props) {
  const location = save ? locations[save.location.id] : undefined
  const hero = startingSheet.character

  return (
    <main className="start-menu" aria-labelledby="start-menu-title">
      <section className="panel start-menu-card">
        <h2 id="start-menu-title">Добро пожаловать к столу</h2>
        <p className="start-menu-lead">Текстовое приключение по правилам D&amp;D 2024 с ИИ-ведущим.</p>

        <div className="start-menu-actions">
          {save && (
            <button type="button" className="menu-option menu-option--primary" onClick={onContinue} data-testid="menu-continue">
              <span className="menu-option-title">Продолжить</span>
              <span className="menu-option-text">
                <strong>{save.character.name}</strong> · {save.character.className} {save.character.level} ур.
                {location && <> · {location.name}</>}
              </span>
            </button>
          )}
          <button type="button" className="menu-option" onClick={onHeroes} data-testid="menu-heroes">
            <span className="menu-option-title">Мои герои</span>
            <span className="menu-option-text">
              {heroCount === 0 ? 'Пока пусто.' : `Героев: ${heroCount}.`} Листы персонажей, новые истории и «Зал славы».
            </span>
          </button>
          <button type="button" className={`menu-option${save ? '' : ' menu-option--primary'}`} onClick={onCreate} data-testid="menu-create">
            <span className="menu-option-title">Создать нового героя</span>
            <span className="menu-option-text">Класс, предыстория, вид, характеристики и снаряжение по шагам.</span>
          </button>
          <button type="button" className="menu-option" onClick={onQuickStart} data-testid="menu-quick-start">
            <span className="menu-option-title">Быстрый старт ({hero.name})</span>
            <span className="menu-option-text">
              Готовый герой: {hero.species.toLowerCase()}, {hero.className.toLowerCase()} {hero.level} уровня.
            </span>
          </button>
        </div>

        {save && (
          <p className="start-menu-note">
            Одновременно можно вести одну историю: новая прервёт текущую, а её герой вернётся в «Мои герои».
          </p>
        )}
      </section>
    </main>
  )
}
