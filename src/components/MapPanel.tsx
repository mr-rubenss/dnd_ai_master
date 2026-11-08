import type { DoorStates } from '../engine/movement'
import type { CellPosition, LocationData } from '../types/location'
import type { MapPing, PlayerMark, ShownArea } from '../types/story'
import type { MarkEditor } from './MapMarks'
import { LocationMap, type HeroMovement, type MapActions, type MapVision } from './LocationMap'

interface Props {
  location: LocationData
  player: CellPosition
  doors: DoorStates
  movement?: HeroMovement
  actions?: MapActions
  ping?: MapPing
  vision?: MapVision
  shownArea?: ShownArea
  companions?: readonly { id: string; name: string; position: CellPosition }[]
  marks?: readonly PlayerMark[]
  markEditor?: MarkEditor
  /** Путь отряда — названия локаций по порядку прихода (последняя — текущая). */
  trail?: readonly string[]
}

export function MapPanel({ location, player, doors, movement, actions, ping, vision, shownArea, companions, marks, markEditor, trail = [] }: Props) {
  return (
    <section className="panel map-panel" aria-label="Карта локации">
      <header className="panel-header">
        {trail.length > 1 && (
          <ol className="map-trail" aria-label="Путь отряда" data-testid="map-trail">
            {trail.map((name, i) => (
              <li key={`${i}-${name}`} aria-current={i === trail.length - 1 ? 'location' : undefined}>
                {name}
              </li>
            ))}
          </ol>
        )}
        <h2>{location.name}</h2>
        <p className="panel-subtitle">{location.description}</p>
      </header>
      {/* key сбрасывает состояние карты (подсказки) при смене локации */}
      <LocationMap key={location.id} location={location} player={player} doors={doors} movement={movement} actions={actions} ping={ping} vision={vision} shownArea={shownArea} companions={companions} marks={marks} markEditor={markEditor} />
    </section>
  )
}
