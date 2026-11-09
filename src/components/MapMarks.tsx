// Метки игрока на карте: значки на клетках (слой SVG) и окно «Поставить / изменить / убрать метку».
// Данные и проверки — src/game/marks.ts; запись — действия markPlaced / markEdited / markRemoved через хранилище.
import { memo, useState, type FormEvent } from 'react'
import { MARK_ICON_NAMES, MARK_TEXT_MAX, normalizeMarkText } from '../game/marks'
import type { CellPosition } from '../types/location'
import { MARK_ICONS, type MarkIcon, type PlayerMark } from '../types/story'

/** Команды меток (нет — история только для чтения: метки видны, но не меняются). */
export interface MarkEditor {
  place: (cell: CellPosition, icon: MarkIcon, text: string) => string | null
  edit: (markId: string, icon: MarkIcon, text: string) => string | null
  remove: (markId: string) => string | null
}

/** Значок метки внутри кружка (координаты — от центра кружка, радиус ≈ 0.28 клетки). */
function MarkGlyph({ icon }: { icon: MarkIcon }) {
  switch (icon) {
    case 'question':
      return (
        <text x={0} y={0.02} className="map-mark-glyph">
          ?
        </text>
      )
    case 'danger':
      return (
        <text x={0} y={0.02} className="map-mark-glyph">
          !
        </text>
      )
    case 'cache':
      return (
        <g className="map-mark-lines">
          <rect x={-0.14} y={-0.09} width={0.28} height={0.19} rx={0.03} />
          <line x1={-0.14} y1={-0.01} x2={0.14} y2={-0.01} />
        </g>
      )
    case 'note':
      return (
        <g className="map-mark-lines">
          <line x1={-0.12} y1={-0.08} x2={0.12} y2={-0.08} />
          <line x1={-0.12} y1={0} x2={0.12} y2={0} />
          <line x1={-0.12} y1={0.08} x2={0.05} y2={0.08} />
        </g>
      )
  }
}

/** Слой меток: кружок со значком в верхнем правом углу клетки (центр клетки остаётся для фишек и предметов). */
export const MarkLayer = memo(function MarkLayer({ marks, onOpen }: { marks: readonly PlayerMark[]; onOpen: (mark: PlayerMark) => void }) {
  if (marks.length === 0) return null
  return (
    <g className="map-layer map-layer--marks" data-testid="map-marks">
      {marks.map((m) => (
        <g
          key={m.id}
          className={`map-mark map-mark--${m.icon}`}
          transform={`translate(${m.x + 0.72} ${m.y + 0.28})`}
          role="button"
          tabIndex={0}
          aria-label={`Метка: ${m.text || MARK_ICON_NAMES[m.icon]}`}
          data-testid={`mark-${m.id}`}
          data-icon={m.icon}
          data-x={m.x}
          data-y={m.y}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onOpen(m)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onOpen(m)
            }
          }}
        >
          <title>{m.text ? `${m.text} (${MARK_ICON_NAMES[m.icon]})` : MARK_ICON_NAMES[m.icon]}</title>
          <circle r={0.28} className="map-mark-badge" />
          <MarkGlyph icon={m.icon} />
        </g>
      ))}
    </g>
  )
})

const ICON_LABELS: Record<MarkIcon, string> = { question: 'Вопрос', danger: 'Опасность', cache: 'Тайник', note: 'Заметка' }

interface PanelProps {
  cell: CellPosition
  mark: PlayerMark | null
  editor?: MarkEditor
  onClose: () => void
  /** Причина отказа движка — показать игроку. */
  onError: (reason: string) => void
}

/** Окно метки: для пустой клетки — «Поставить метку», для клетки с меткой — её текст, «Изменить», «Удалить». */
export function MarkPanel({ cell, mark, editor, onClose, onError }: PanelProps) {
  const [editing, setEditing] = useState(false)
  const [icon, setIcon] = useState<MarkIcon>(mark?.icon ?? 'question')
  const [text, setText] = useState(mark?.text ?? '')

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!editor) return
    const clean = normalizeMarkText(text)
    const reason = mark ? editor.edit(mark.id, icon, clean) : editor.place(cell, icon, clean)
    if (reason) return onError(reason)
    onClose()
  }
  const remove = () => {
    if (!editor || !mark) return
    const reason = editor.remove(mark.id)
    if (reason) return onError(reason)
    onClose()
  }

  return (
    <div className="map-mark-panel" role="dialog" aria-label="Метка на карте" data-testid="mark-panel" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      {editing ? (
        <form className="map-mark-form" onSubmit={save}>
          <strong className="map-mark-title">{mark ? 'Изменить метку' : 'Новая метка'}</strong>
          <div className="map-mark-icons" role="radiogroup" aria-label="Значок">
            {MARK_ICONS.map((i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={icon === i}
                className={`map-mark-icon${icon === i ? ' is-selected' : ''}`}
                onClick={() => setIcon(i)}
                data-testid={`mark-icon-${i}`}
              >
                <svg viewBox="-0.32 -0.32 0.64 0.64" className={`map-mark map-mark--${i}`} aria-hidden="true">
                  <circle r={0.28} className="map-mark-badge" />
                  <MarkGlyph icon={i} />
                </svg>
                {ICON_LABELS[i]}
              </button>
            ))}
          </div>
          <input
            className="map-mark-input"
            value={text}
            maxLength={MARK_TEXT_MAX}
            placeholder="Например: тайник?"
            aria-label="Текст метки"
            onChange={(e) => setText(e.target.value)}
            autoFocus
            data-testid="mark-text"
          />
          <div className="map-actions">
            <button type="submit" className="map-action" data-testid="mark-save">
              Сохранить
            </button>
            <button type="button" className="map-action" onClick={onClose}>
              Отмена
            </button>
          </div>
        </form>
      ) : (
        <>
          {mark ? (
            <>
              <span className="map-tooltip-kind">Метка · {MARK_ICON_NAMES[mark.icon]}</span>
              <strong className="map-mark-title" data-testid="mark-panel-text">
                {mark.text || ICON_LABELS[mark.icon]}
              </strong>
            </>
          ) : (
            <span className="map-tooltip-kind">
              Клетка ({cell.x}, {cell.y})
            </span>
          )}
          <div className="map-actions">
            {editor && !mark && (
              <button type="button" className="map-action" onClick={() => setEditing(true)} data-testid="mark-place">
                Поставить метку
              </button>
            )}
            {editor && mark && (
              <>
                <button type="button" className="map-action" onClick={() => setEditing(true)} data-testid="mark-edit">
                  Изменить
                </button>
                <button type="button" className="map-action" onClick={remove} data-testid="mark-remove">
                  Удалить
                </button>
              </>
            )}
            <button type="button" className="map-action" onClick={onClose} data-testid="mark-close">
              Закрыть
            </button>
          </div>
        </>
      )}
    </div>
  )
}
