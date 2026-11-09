// Масштаб и сдвиг карты: колесо мыши и перетаскивание на десктопе, щипок и два пальца на телефоне и планшете; когда
// карта увеличена — и сдвиг одним пальцем (при масштабе 1 одним пальцем страница прокручивается как обычно). Во время жеста вид меняется прямо в стиле элемента (transform), без
// перерисовки React, — так быстро и на телефоне; по окончании жеста вид фиксируется в состоянии (для подсказки).
// Математика — чистые функции в src/game/mapView.ts.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { centerOn, clampView, FIT_VIEW, zoomAt, type MapViewport } from '../game/mapView'

/** Шаг масштаба для кнопок «+»/«−». */
const ZOOM_STEP = 1.5
/** Сдвиг мышью меньше этого — ещё щелчок, а не перетаскивание. */
const DRAG_THRESHOLD = 4

/** Положение и размер окна карты на экране. */
function sizeOf(el: HTMLElement | null) {
  const r = el?.getBoundingClientRect()
  return { left: r?.left ?? 0, top: r?.top ?? 0, width: r?.width ?? 1, height: r?.height ?? 1 }
}

export function useMapViewport(boxRef: RefObject<HTMLDivElement | null>, innerRef: RefObject<HTMLDivElement | null>, onGesture: () => void) {
  const view = useRef<MapViewport>(FIT_VIEW)
  const [committed, setCommitted] = useState<MapViewport>(FIT_VIEW)
  const gestureRef = useRef(onGesture)
  useEffect(() => {
    gestureRef.current = onGesture
  }, [onGesture])
  /** Размер окна карты в пикселях — для положения подсказки (сдвиг вида — в пикселях). */
  const [box, setBox] = useState({ w: 1, h: 1 })



  const apply = useCallback(
    (next: MapViewport, animate = false) => {
      view.current = next
      const el = innerRef.current
      if (!el) return
      el.classList.toggle('is-animating', animate)
      // Карта увеличена — одним пальцем она сдвигается, а не прокручивает страницу (touch-action: none в стилях).
      boxRef.current?.classList.toggle('is-zoomed', next.scale > 1)
      // Во время жеста слой композитный (без перерастеризации SVG на каждом кадре); после — снова чёткий.
      el.style.transform = next.scale === 1 && next.x === 0 && next.y === 0 ? '' : `translate(${next.x}px, ${next.y}px) scale(${next.scale})`
    },
    [innerRef, boxRef],
  )

  const commit = useCallback(() => {
    innerRef.current?.classList.remove('is-moving')
    setCommitted(view.current)
  }, [innerRef])

  useEffect(() => {
    const box = boxRef.current
    const inner = innerRef.current
    if (!box || !inner) return
    let commitTimer = 0
    const commitSoon = () => {
      window.clearTimeout(commitTimer)
      commitTimer = window.setTimeout(commit, 160)
    }
    const moving = () => {
      inner.classList.add('is-moving')
      gestureRef.current()
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const s = sizeOf(box)
      moving()
      apply(zoomAt(view.current, view.current.scale * Math.exp(-e.deltaY * 0.0015), e.clientX - s.left, e.clientY - s.top, s.width, s.height))
      commitSoon()
    }

    // Мышь: перетаскивание (после порога — чтобы щелчок по предмету оставался щелчком).
    let drag: { x: number; y: number; start: MapViewport; moved: boolean; id: number } | null = null
    let suppressClick = false
    const onPointerDown = (e: PointerEvent) => {
      // Мышь — всегда; палец или перо — когда карта увеличена (иначе одним пальцем прокручивается страница).
      const touchPan = e.pointerType !== 'mouse' && e.isPrimary && view.current.scale > 1
      if (!touchPan && (e.pointerType !== 'mouse' || e.button !== 0)) return
      // Токен героя перетаскивается сам (LocationMap) — карту в это время не сдвигаем.
      if ((e.target as Element | null)?.closest?.('[data-draggable]')) return
      drag = { x: e.clientX, y: e.clientY, start: view.current, moved: false, id: e.pointerId }
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return
      const dx = e.clientX - drag.x
      const dy = e.clientY - drag.y
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      if (!drag.moved) {
        drag.moved = true
        box.setPointerCapture(e.pointerId)
        box.classList.add('is-dragging')
        moving()
      }
      const s = sizeOf(box)
      apply(clampView({ ...drag.start, x: drag.start.x + dx, y: drag.start.y + dy }, s.width, s.height))
    }
    const onPointerUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return
      if (drag.moved) {
        suppressClick = true
        box.classList.remove('is-dragging')
        commit()
      }
      drag = null
    }
    const onClickCapture = (e: MouseEvent) => {
      if (!suppressClick) return
      suppressClick = false
      e.stopPropagation()
      e.preventDefault()
    }

    // Два пальца: щипок — масштаб вокруг середины между пальцами, движение — сдвиг.
    let pinch: { d: number; mx: number; my: number; start: MapViewport } | null = null
    const touchInfo = (t: TouchList) => {
      const s = sizeOf(box)
      const [a, b] = [t[0], t[1]]
      return { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, mx: (a.clientX + b.clientX) / 2 - s.left, my: (a.clientY + b.clientY) / 2 - s.top, s }
    }
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return
      // Второй палец — щипок, а не сдвиг одним пальцем.
      if (drag) {
        if (drag.moved) box.classList.remove('is-dragging')
        drag = null
      }
      const t = touchInfo(e.touches)
      pinch = { d: t.d, mx: t.mx, my: t.my, start: view.current }
      moving()
    }
    const onTouchMove = (e: TouchEvent) => {
      // Палец тащит токен героя — страница не прокручивается (слушатель не пассивный с самого начала касания).
      if (box.dataset.tokenDrag === '1') {
        e.preventDefault()
        return
      }
      if (!pinch || e.touches.length !== 2) return
      e.preventDefault()
      const t = touchInfo(e.touches)
      const zoomed = zoomAt(pinch.start, pinch.start.scale * (t.d / pinch.d), pinch.mx, pinch.my, t.s.width, t.s.height)
      apply(clampView({ ...zoomed, x: zoomed.x + t.mx - pinch.mx, y: zoomed.y + t.my - pinch.my }, t.s.width, t.s.height))
    }
    const onTouchEnd = (e: TouchEvent) => {
      if (pinch && e.touches.length < 2) {
        pinch = null
        commit()
      }
    }

    // Размер окна изменился — вид остаётся в границах.
    const resize = new ResizeObserver(() => {
      const s = sizeOf(box)
      setBox({ w: s.width || 1, h: s.height || 1 })
      apply(clampView(view.current, s.width, s.height))
    })
    resize.observe(box)

    box.addEventListener('wheel', onWheel, { passive: false })
    box.addEventListener('pointerdown', onPointerDown)
    box.addEventListener('pointermove', onPointerMove)
    box.addEventListener('pointerup', onPointerUp)
    box.addEventListener('pointercancel', onPointerUp)
    box.addEventListener('click', onClickCapture, true)
    box.addEventListener('touchstart', onTouchStart, { passive: true })
    box.addEventListener('touchmove', onTouchMove, { passive: false })
    box.addEventListener('touchend', onTouchEnd)
    box.addEventListener('touchcancel', onTouchEnd)
    return () => {
      window.clearTimeout(commitTimer)
      resize.disconnect()
      box.removeEventListener('wheel', onWheel)
      box.removeEventListener('pointerdown', onPointerDown)
      box.removeEventListener('pointermove', onPointerMove)
      box.removeEventListener('pointerup', onPointerUp)
      box.removeEventListener('pointercancel', onPointerUp)
      box.removeEventListener('click', onClickCapture, true)
      box.removeEventListener('touchstart', onTouchStart)
      box.removeEventListener('touchmove', onTouchMove)
      box.removeEventListener('touchend', onTouchEnd)
      box.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [boxRef, innerRef, apply, commit])

  /** Кнопки: плавный переход к новому виду. */
  const animateTo = useCallback(
    (next: MapViewport) => {
      gestureRef.current()
      apply(next, true)
      setCommitted(next)
    },
    [apply],
  )

  const zoomBy = (factor: number) => {
    const s = sizeOf(boxRef.current)
    animateTo(zoomAt(view.current, view.current.scale * factor, s.width / 2, s.height / 2, s.width, s.height))
  }

  return {
    view: committed,
    box,
    zoomIn: () => zoomBy(ZOOM_STEP),
    zoomOut: () => zoomBy(1 / ZOOM_STEP),
    reset: () => animateTo(FIT_VIEW),
    /** Клетка (cx, cy) в координатах доски из cols × rows клеток — в центр окна. */
    centerOn: (cx: number, cy: number, cols: number, rows: number) => {
      const s = sizeOf(boxRef.current)
      animateTo(centerOn(view.current, cx, cy, cols, rows, s.width, s.height))
    },
  }
}
