// Изменения карты от инструментов ведущего — чтобы они не «телепортировались», а происходили на глазах: новый НПС
// появляется у входа и идёт на своё место, ушедший уходит к выходу и только потом исчезает, новый или раскрытый
// объект проявляется, убранный — тает. Скрытые НПС и объекты не видны вовсе. Состояние выводится из данных карты
// прямо при отрисовке (сравнение с прошлым списком), таймеры убирают «призраков» после анимации.
import { useEffect, useState } from 'react'
import type { LocationData, MapObject, Npc } from '../types/location'

/** Сколько живёт растаявший объект и подсветка нового (мс; то же — в анимациях index.css). */
export const OBJECT_FADE_MS = 450

export interface MapChanges {
  npcs: Npc[]
  objects: MapObject[]
  /** Ушедшие НПС: ещё идут к выходу. */
  leavingNpcs: Npc[]
  /** Новые НПС (не было на карте вовсе): появляются у входа. */
  spawned: ReadonlySet<string>
  /** Убранные объекты: тают. */
  leavingObjects: MapObject[]
  /** Новые и раскрытые объекты и НПС — проявляются. */
  fresh: ReadonlySet<string>
}

interface Tracked {
  npcs: Npc[]
  objects: MapObject[]
  leavingNpcs: Npc[]
  leavingObjects: MapObject[]
  spawned: Set<string>
  fresh: Set<string>
}

/** leaveMs — сколько идёт до выхода ушедший НПС. */
export function useMapChanges(location: LocationData, leaveMs: (npc: Npc) => number): MapChanges {
  const [t, setT] = useState<Tracked>(() => ({
    npcs: location.npcs,
    objects: location.objects,
    leavingNpcs: [],
    leavingObjects: [],
    spawned: new Set(),
    fresh: new Set(),
  }))

  // Данные изменились — сравнение с прошлыми (производное состояние при отрисовке, без лишнего кадра).
  if (t.npcs !== location.npcs || t.objects !== location.objects) {
    const visible = <T extends { id: string; hidden?: boolean }>(list: T[]) => new Map(list.filter((x) => !x.hidden).map((x) => [x.id, x]))
    const wasNpcs = visible(t.npcs)
    const nowNpcs = visible(location.npcs)
    const allBefore = new Set(t.npcs.map((n) => n.id))
    const nowIds = new Set(location.npcs.map((n) => n.id))
    const wasObjects = visible(t.objects)
    const nowObjects = visible(location.objects)
    const objIds = new Set(location.objects.map((o) => o.id))
    const spawned = new Set(t.spawned)
    const fresh = new Set(t.fresh)
    for (const id of nowNpcs.keys())
      if (!wasNpcs.has(id)) {
        if (!allBefore.has(id)) spawned.add(id)
        else fresh.add(id)
      }
    for (const id of nowObjects.keys()) if (!wasObjects.has(id)) fresh.add(id)
    setT({
      npcs: location.npcs,
      objects: location.objects,
      leavingNpcs: [...t.leavingNpcs.filter((n) => !nowIds.has(n.id)), ...[...wasNpcs.values()].filter((n) => !nowIds.has(n.id))],
      leavingObjects: [...t.leavingObjects.filter((o) => !objIds.has(o.id)), ...[...wasObjects.values()].filter((o) => !objIds.has(o.id))],
      spawned,
      fresh,
    })
  }

  // Призраки и подсветка — только на время анимации.
  const { leavingNpcs, leavingObjects, fresh, spawned } = t
  useEffect(() => {
    if (!leavingNpcs.length) return
    const timers = leavingNpcs.map((npc) =>
      window.setTimeout(() => setT((cur) => ({ ...cur, leavingNpcs: cur.leavingNpcs.filter((n) => n.id !== npc.id) })), leaveMs(npc)),
    )
    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [leavingNpcs]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!leavingObjects.length && !fresh.size && !spawned.size) return
    const timer = window.setTimeout(() => setT((cur) => ({ ...cur, leavingObjects: [], fresh: new Set(), spawned: new Set() })), OBJECT_FADE_MS * 8)
    return () => window.clearTimeout(timer)
  }, [leavingObjects, fresh, spawned])

  return {
    npcs: location.npcs.filter((n) => !n.hidden),
    objects: location.objects.filter((o) => !o.hidden),
    leavingNpcs,
    spawned,
    leavingObjects,
    fresh,
  }
}
