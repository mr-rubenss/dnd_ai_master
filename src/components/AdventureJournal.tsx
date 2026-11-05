import type { StoryMemory, WorldFact } from '../types/story'

interface Props {
  memory?: StoryMemory
  facts: readonly WorldFact[]
}

/** Строки сводки без маркера «- ». */
const summaryLines = (summary: string) =>
  summary
    .split('\n')
    .map((l) => l.replace(/^\s*-\s*/, '').trim())
    .filter(Boolean)

/** Журнал приключения для игрока: сводка ведущего «Что было раньше» и журнал фактов. */
export function AdventureJournal({ memory, facts }: Props) {
  const lines = summaryLines(memory?.summary ?? '')
  return (
    <div className="adventure-journal" data-testid="adventure-journal">
      <section className="inventory-section" aria-label="Что было раньше">
        <h3>Что было раньше</h3>
        {lines.length ? (
          <ul className="journal-list" data-testid="journal-summary">
            {lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="journal-empty">Пока всё помещается в памяти ведущего — сводка появится, когда история станет длинной.</p>
        )}
      </section>
      <section className="inventory-section" aria-label="Журнал фактов">
        <h3>Журнал фактов</h3>
        {facts.length ? (
          <ul className="journal-list" data-testid="journal-facts">
            {facts.map((f) => (
              <li key={f.id}>{f.text}</li>
            ))}
          </ul>
        ) : (
          <p className="journal-empty">Ведущий ещё не записал важных фактов.</p>
        )}
      </section>
    </div>
  )
}
