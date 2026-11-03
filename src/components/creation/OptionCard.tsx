import type { ReactNode } from 'react'

interface Props {
  selected: boolean
  onSelect: () => void
  title: string
  meta?: ReactNode
  children?: ReactNode
  disabled?: boolean
  /** Для тестов и e2e: data-option. */
  optionId?: string
}

/** Карточка варианта (класс, предыстория, вид…): нажатие выбирает её. */
export function OptionCard({ selected, onSelect, title, meta, children, disabled, optionId }: Props) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`option-card${selected ? ' is-selected' : ''}`}
      onClick={onSelect}
      disabled={disabled}
      data-option={optionId}
    >
      <span className="option-card-title">{title}</span>
      {meta && <span className="option-card-meta">{meta}</span>}
      {children && <span className="option-card-text">{children}</span>}
    </button>
  )
}

/** Переключатель-«чип» для множественного выбора (навыки и т. п.). */
export function ChoiceChip({
  checked,
  onToggle,
  disabled,
  children,
  value,
}: {
  checked: boolean
  onToggle: () => void
  disabled?: boolean
  children: ReactNode
  value?: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={`choice-chip${checked ? ' is-checked' : ''}`}
      onClick={onToggle}
      disabled={disabled}
      data-value={value}
    >
      {children}
    </button>
  )
}
