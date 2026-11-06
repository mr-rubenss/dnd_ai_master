import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Значение, которое на мгновение подсвечивается, когда меняется (золото, количество, хиты) — так игрок видит,
 * что рассказ ведущего отразился в листе. При первой отрисовке не подсвечивается; анимация — только CSS.
 */
export function Flash({ value, children, className = '', testId }: { value: string | number; children: ReactNode; className?: string; testId?: string }) {
  const [tick, setTick] = useState(0)
  const prev = useRef(value)
  useEffect(() => {
    if (prev.current === value) return
    prev.current = value
    setTick((t) => t + 1)
  }, [value])
  return (
    <span key={tick} className={`${className}${tick > 0 ? ' value-flash' : ''}`.trim() || undefined} data-testid={testId} data-flash={tick > 0 ? tick : undefined}>
      {children}
    </span>
  )
}
