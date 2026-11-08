import type { DoorStates } from '../engine/movement'
import type { CellPosition, LocationData } from '../types/location'
import type { MapPing } from '../types/story'
import { LocationMap, type HeroMovement, type MapActions, type MapVision } from './LocationMap'

interface Props {
  location: LocationData
  player: CellPosition
  doors: DoorStates
  movement?: HeroMovement
  actions?: MapActions
  ping?: MapPing
  vision?: MapVision
}

export function MapPanel({ location, player, doors, movement, actions, ping, vision }: Props) {
  return (
    <section className="panel map-panel" aria-label="Карта локации">
      <header className="panel-header">
        <h2>{location.name}</h2>
        <p className="panel-subtitle">{location.description}</p>
      </header>
      {/* key сбрасывает состояние карты (подсказки) при смене локации */}
      <LocationMap key={location.id} location={location} player={player} doors={doors} movement={movement} actions={actions} ping={ping} vision={vision} />
    </section>
  )
}
