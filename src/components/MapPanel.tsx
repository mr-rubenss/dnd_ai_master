import type { CellPosition, LocationData } from '../types/location'
import { LocationMap } from './LocationMap'

interface Props {
  location: LocationData
  player: CellPosition
}

export function MapPanel({ location, player }: Props) {
  return (
    <section className="panel map-panel" aria-label="Карта локации">
      <header className="panel-header">
        <h2>{location.name}</h2>
        <p className="panel-subtitle">{location.description}</p>
      </header>
      {/* key сбрасывает состояние карты (подсказки) при смене локации */}
      <LocationMap key={location.id} location={location} player={player} />
    </section>
  )
}
