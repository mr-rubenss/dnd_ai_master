import type { DoorStates } from '../engine/movement'
import type { MapPathItem } from '../game/mapLevels'
import { MAP_PROFILES, scaleLabel, scaleOf } from '../game/mapView'
import type { CellPosition, LocationData } from '../types/location'
import type { MapPing, PlayerMark, ShownArea } from '../types/story'
import type { MarkEditor } from './MapMarks'
import { LocationMap, type HeroMovement, type MapActions, type MapVision } from './LocationMap'

/** Кнопка смены масштаба: что сделать и почему недоступна. */
export interface LevelButton {
  run: () => void
  disabled?: boolean
  title?: string
  /** Можно щипком «сжать» (только когда карта есть и ничего не уходит ведущему). */
  pinch?: boolean
}

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
  /** Путь над картой: уровни выше (нажать — посмотреть) и пройденные карты того же уровня (src/game/mapLevels.ts). */
  path?: readonly MapPathItem[]
  /** Посмотреть карту уровня из пути. */
  onLevel?: (id: string) => void
  /** «Отдалить» — карта уровнем выше; «Приблизить» — подробнее (к отряду или место под героем). */
  levelUp?: LevelButton
  levelDown?: LevelButton
  /** Смотрят не карту отряда: название карты отряда и «К отряду». */
  partyMap?: { name: string; back: () => void }
  /** Фишка героя на карте (на карте другого масштаба — у места отряда или нет). */
  heroShown?: boolean
}

export function MapPanel(props: Props) {
  const { location, path = [], onLevel, levelUp, levelDown, partyMap } = props
  const kind = scaleOf(location).kind
  return (
    <section className="panel map-panel" aria-label="Карта локации" data-map-scale={kind}>
      <header className="panel-header">
        {path.length > 1 && (
          <ol className="map-trail" aria-label="Путь отряда" data-testid="map-trail">
            {path.map((item, i) => (
              <li key={`${i}-${item.id}`} data-kind={item.kind} aria-current={item.current ? 'location' : undefined}>
                {item.kind === 'level' && !item.current && onLevel ? (
                  <button type="button" className="map-trail-link" onClick={() => onLevel(item.id)} data-testid={`map-level-${item.id}`}>
                    {item.name}
                  </button>
                ) : (
                  item.name
                )}
              </li>
            ))}
          </ol>
        )}
        <div className="map-title-row">
          <h2>{location.name}</h2>
          {(levelUp || levelDown) && (
            <div className="map-level-actions" role="group" aria-label="Масштаб карты">
              {levelUp && (
                <button type="button" className="map-level-button" onClick={levelUp.run} disabled={levelUp.disabled} title={levelUp.title} data-testid="map-level-up">
                  Отдалить
                </button>
              )}
              {levelDown && (
                <button type="button" className="map-level-button" onClick={levelDown.run} disabled={levelDown.disabled} title={levelDown.title} data-testid="map-level-down">
                  Приблизить
                </button>
              )}
            </div>
          )}
        </div>
        <p className="panel-subtitle">
          {kind !== 'tactical' && (
            <>
              <span className="map-scale-label" data-testid="map-scale-label">
                {MAP_PROFILES[kind].label} · {scaleLabel(location)}
              </span>
              {' — '}
            </>
          )}
          {location.description}
        </p>
        {partyMap && (
          <p className="map-viewing" role="status" data-testid="map-viewing">
            Отряд — на карте «{partyMap.name}».{' '}
            <button type="button" className="map-trail-link" onClick={partyMap.back} data-testid="map-back-to-party">
              К отряду
            </button>
          </p>
        )}
      </header>
      {/* key сбрасывает состояние карты (подсказки) при смене локации */}
      <LocationMap
        key={location.id}
        location={location}
        player={props.player}
        doors={props.doors}
        movement={props.movement}
        actions={props.actions}
        ping={props.ping}
        vision={props.vision}
        shownArea={props.shownArea}
        companions={props.companions}
        marks={props.marks}
        markEditor={props.markEditor}
        heroShown={props.heroShown}
        onPinchOut={levelUp?.pinch && !levelUp.disabled ? levelUp.run : undefined}
      />
    </section>
  )
}
