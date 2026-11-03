import type { Location, MapPoint } from '../types/game'

const POINT_COLORS: Record<MapPoint['kind'], string> = {
  entrance: 'var(--map-entrance)',
  npc: 'var(--map-npc)',
  feature: 'var(--map-feature)',
  exit: 'var(--map-exit)',
}

interface Props {
  location: Location
}

/** Заглушка карты: схематичный план локации с точками интереса. */
export function MapPanel({ location }: Props) {
  return (
    <section className="panel map-panel" aria-label="Карта локации">
      <header className="panel-header">
        <h2>{location.name}</h2>
        <p className="panel-subtitle">{location.description}</p>
      </header>
      <div className="map-canvas">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="map-grid" aria-hidden="true">
          <defs>
            <pattern id="map-grid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M10 0H0V10" fill="none" stroke="var(--map-grid)" strokeWidth="0.3" />
            </pattern>
          </defs>
          <rect width="100" height="100" fill="url(#map-grid)" />
          <polygon
            points="15,30 35,10 65,10 85,30 85,85 15,85"
            fill="none"
            stroke="var(--map-wall)"
            strokeWidth="0.8"
            strokeDasharray="3 1.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {location.points.map((point) => (
          <div
            key={point.id}
            className="map-point"
            style={{ left: `${point.x}%`, top: `${point.y}%`, '--point-color': POINT_COLORS[point.kind] } as React.CSSProperties}
          >
            <span className="map-point-dot" />
            <span className="map-point-label">{point.name}</span>
          </div>
        ))}
        <div
          className="map-player"
          style={{ left: `${location.player.x}%`, top: `${location.player.y}%` }}
          title="Вы здесь"
          aria-label="Вы здесь"
        />
        <span className="map-stub-note">Карта-заглушка</span>
      </div>
    </section>
  )
}
