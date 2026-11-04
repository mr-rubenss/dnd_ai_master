import type { Theme } from '../theme/types'

/** Мини-превью темы: фон, панель, акцент, текст. Цвета — из самой темы (её токенов). */
export function ThemePreview({ theme }: { theme: Theme }) {
  const c = theme.colors
  return (
    <span className="theme-preview" style={{ background: c.bg, borderColor: c.border }} aria-hidden="true">
      <span className="theme-preview-panel" style={{ background: c.panel, borderColor: c.borderBright }}>
        <span className="theme-preview-title" style={{ color: c.accent, fontFamily: theme.fonts.display }}>
          Аа
        </span>
        <span className="theme-preview-line" style={{ background: c.fg }} />
        <span className="theme-preview-line theme-preview-line--short" style={{ background: c.muted }} />
      </span>
      <span className="theme-preview-dots">
        <span style={{ background: c.accent }} />
        <span style={{ background: c.danger }} />
        <span style={{ background: theme.map.floorWood }} />
      </span>
    </span>
  )
}
