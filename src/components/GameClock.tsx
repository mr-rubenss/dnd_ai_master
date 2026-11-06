// Игровое время истории в шапке: солнце (утро, день) или луна (вечер, ночь) и «День 3, вечер».
import { isDaytime, timeLabel, timeText } from '../engine/time'
import { storyTime } from '../game/storyActions'
import type { StoryState } from '../types/story'
import { Flash } from './Flash'

export function GameClock({ story }: { story: Pick<StoryState, 'time'> }) {
  const t = storyTime(story)
  const label = timeLabel(t)
  return (
    <span className="game-clock" role="status" aria-label={`Игровое время: ${timeText(t)}`} title={timeText(t)} data-testid="game-clock">
      <span className="game-clock-icon" aria-hidden="true">
        {isDaytime(t) ? '☀️' : '🌙'}
      </span>
      <Flash value={label}>
        <span className="game-clock-text">{label}</span>
      </Flash>
    </span>
  )
}
