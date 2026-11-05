import { useEffect, useId, useRef, useState } from 'react'
import {
  ACCENTS,
  DENSITIES,
  MASTER_FONTS,
  TEXT_SIZES,
  accentOptions,
  type AccentId,
  type MasterFontId,
  type TextSizeId,
  type DensityId,
} from '../theme/appearance'
import { appearanceStore, useAppearance } from '../theme/appearanceStore'
import { CustomThemeEditor, ThemeLibraryActions } from './CustomThemes'
import { MasterSettings } from './MasterSettings'
import { ThemePreview } from './ThemePreview'

/** Кнопка «Настройки» (шестерёнка) в шапке на всех экранах — в игре и в стартовом меню. */
export function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="header-button appearance-button"
      onClick={onClick}
      aria-label="Настройки"
      title="Настройки"
      data-testid="settings-open"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="3.2" />
        <path d="M12 2.8l1.6 2.3 2.7-.7.6 2.7 2.6 1-.8 2.7 1.9 2-1.9 2 .8 2.7-2.6 1-.6 2.7-2.7-.7L12 21.2l-1.6-2.3-2.7.7-.6-2.7-2.6-1 .8-2.7-1.9-2 1.9-2-.8-2.7 2.6-1 .6-2.7 2.7.7z" />
      </svg>
    </button>
  )
}

export type SettingsTab = 'appearance' | 'master'

const TABS: { id: SettingsTab; name: string }[] = [
  { id: 'appearance', name: 'Оформление' },
  { id: 'master', name: 'Ведущий' },
]

interface Props {
  onClose: () => void
  /** Вкладка при открытии. */
  initialTab?: SettingsTab
}

/** Экран настроек: вкладки «Оформление» и «Ведущий». Панель оформления: тема, тонкая настройка, карта, анимации. Десктоп — боковая панель, телефон — шторка снизу. */
export function SettingsPanel({ onClose, initialTab = 'appearance' }: Props) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const { settings, themeId, themes } = useAppearance()
  const titleId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const update = appearanceStore.update
  const theme = themes.find((t) => t.id === themeId) ?? themes[0]
  const accents = accentOptions(theme)
  const reduce = settings.animations === 'system' ? document.documentElement.dataset.motion === 'reduce' : settings.animations === 'off'

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      opener?.focus?.()
    }
  }, [onClose])

  return (
    <>
      <div className="appearance-backdrop" onClick={onClose} />
      <aside
        ref={panelRef}
        className="appearance-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="settings-panel"
      >
        <header className="appearance-header">
          <h2 id={titleId}>Настройки</h2>
          <button type="button" className="appearance-close" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </header>
        <div className="settings-tabs" role="tablist" aria-label="Разделы настроек">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${titleId}-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`${titleId}-panel-${t.id}`}
              className={tab === t.id ? 'is-active' : ''}
              onClick={() => setTab(t.id)}
              data-testid={`settings-tab-${t.id}`}
            >
              {t.name}
            </button>
          ))}
        </div>

        {tab === 'master' ? (
          <div className="appearance-body" role="tabpanel" id={`${titleId}-panel-master`} aria-labelledby={`${titleId}-tab-master`}>
            <MasterSettings />
          </div>
        ) : (
          <>
            <div className="appearance-body" role="tabpanel" id={`${titleId}-panel-appearance`} aria-labelledby={`${titleId}-tab-appearance`}>
              <section className="appearance-section" aria-labelledby={`${titleId}-themes`}>
                <h3 id={`${titleId}-themes`}>Тема</h3>
                <div className="theme-cards" role="radiogroup" aria-labelledby={`${titleId}-themes`}>
                  {themes.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="radio"
                      aria-checked={t.id === themeId}
                      className={`theme-card${t.id === themeId ? ' is-selected' : ''}`}
                      onClick={() => update({ themeId: t.id })}
                      data-testid={`theme-card-${t.id}`}
                    >
                      <ThemePreview theme={t} />
                      <span className="theme-card-name">{t.name}</span>
                      {appearanceStore.isCustom(t.id) && <span className="theme-card-badge">своя</span>}
                    </button>
                  ))}
                </div>
                <ThemeLibraryActions theme={theme} />
              </section>

              {appearanceStore.isCustom(theme.id) && <CustomThemeEditor key={theme.id} theme={theme} />}

              <section className="appearance-section" aria-labelledby={`${titleId}-tune`}>
                <h3 id={`${titleId}-tune`}>Тонкая настройка</h3>

                <p className="appearance-label" id={`${titleId}-accent`}>
                  Акцентный цвет
                </p>
                <div className="accent-swatches" role="radiogroup" aria-labelledby={`${titleId}-accent`}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={settings.accent === null}
                    className={`accent-swatch accent-swatch--theme${settings.accent === null ? ' is-selected' : ''}`}
                    onClick={() => update({ accent: null })}
                    title="Как в теме"
                    data-testid="accent-theme"
                  >
                    <span style={{ background: theme.colors.accent }} />
                    Тема
                  </button>
                  {(Object.keys(ACCENTS) as AccentId[])
                    .filter((id) => accents.includes(id))
                    .map((id) => (
                      <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={settings.accent === id}
                        className={`accent-swatch${settings.accent === id ? ' is-selected' : ''}`}
                        onClick={() => update({ accent: id })}
                        title={ACCENTS[id].name}
                        aria-label={ACCENTS[id].name}
                        data-testid={`accent-${id}`}
                      >
                        <span style={{ background: ACCENTS[id].color }} />
                      </button>
                    ))}
                </div>

                <label className="appearance-label" htmlFor={`${titleId}-font`}>
                  Шрифт текста ведущего
                </label>
                <select
                  id={`${titleId}-font`}
                  className="appearance-select"
                  value={settings.masterFont ?? ''}
                  onChange={(e) =>
                    update({
                      masterFont: (e.target.value || null) as MasterFontId | null,
                    })
                  }
                  data-testid="master-font"
                >
                  <option value="">Как в теме</option>
                  {(Object.keys(MASTER_FONTS) as MasterFontId[]).map((id) => (
                    <option key={id} value={id}>
                      {MASTER_FONTS[id].name}
                    </option>
                  ))}
                </select>
                <p className="appearance-sample">Трактирщик протирает кружку и кивает на свободный стол у камина.</p>

                <p className="appearance-label" id={`${titleId}-size`}>
                  Размер текста
                </p>
                <div className="segmented appearance-segmented" role="radiogroup" aria-labelledby={`${titleId}-size`}>
                  {(Object.keys(TEXT_SIZES) as TextSizeId[]).map((id, i) => (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={settings.textSize === id}
                      aria-label={TEXT_SIZES[id].name}
                      title={TEXT_SIZES[id].name}
                      className={settings.textSize === id ? 'is-active' : ''}
                      onClick={() => update({ textSize: id })}
                      data-testid={`text-size-${id}`}
                    >
                      <span className={`size-glyph size-glyph--${i}`}>А</span>
                    </button>
                  ))}
                </div>

                <p className="appearance-label" id={`${titleId}-density`}>
                  Плотность интерфейса
                </p>
                <div className="segmented appearance-segmented" role="radiogroup" aria-labelledby={`${titleId}-density`}>
                  {(Object.keys(DENSITIES) as DensityId[]).map((id) => (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={settings.density === id}
                      className={settings.density === id ? 'is-active' : ''}
                      onClick={() => update({ density: id })}
                      data-testid={`density-${id}`}
                    >
                      {DENSITIES[id]}
                    </button>
                  ))}
                </div>
              </section>

              <section className="appearance-section" aria-labelledby={`${titleId}-map`}>
                <h3 id={`${titleId}-map`}>Карта</h3>
                <label className="appearance-toggle">
                  <input type="checkbox" checked={settings.mapGrid} onChange={(e) => update({ mapGrid: e.target.checked })} data-testid="map-grid" />
                  Сетка
                </label>
                <label className="appearance-label" htmlFor={`${titleId}-grid`}>
                  Прозрачность сетки: {Math.round(settings.gridOpacity * 100)}%
                </label>
                <input
                  id={`${titleId}-grid`}
                  type="range"
                  className="appearance-range"
                  min={10}
                  max={100}
                  step={10}
                  value={Math.round(settings.gridOpacity * 100)}
                  disabled={!settings.mapGrid}
                  onChange={(e) => update({ gridOpacity: Number(e.target.value) / 100 })}
                  data-testid="grid-opacity"
                />
                <label className="appearance-toggle">
                  <input
                    type="checkbox"
                    checked={settings.npcLabels}
                    onChange={(e) => update({ npcLabels: e.target.checked })}
                    data-testid="npc-labels"
                  />
                  Подписи НПС
                </label>
              </section>

              <section className="appearance-section" aria-labelledby={`${titleId}-motion`}>
                <h3 id={`${titleId}-motion`}>Анимации</h3>
                <label className="appearance-toggle">
                  <input
                    type="checkbox"
                    checked={!reduce}
                    onChange={(e) => update({ animations: e.target.checked ? 'on' : 'off' })}
                    data-testid="animations"
                  />
                  Анимации (бросок кубика, шторки)
                </label>
                <p className="appearance-hint">
                  {settings.animations === 'system' ? 'Сейчас — как в настройках системы («уменьшить движение»).' : 'Выбрано вручную.'}
                </p>
              </section>
            </div>

            <footer className="appearance-footer">
              <button type="button" className="secondary-button" onClick={() => appearanceStore.reset()} data-testid="appearance-reset">
                Сбросить к теме по умолчанию
              </button>
            </footer>
          </>
        )}
      </aside>
    </>
  )
}
