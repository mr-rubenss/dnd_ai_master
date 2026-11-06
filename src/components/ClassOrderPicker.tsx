// Выбор «Божественного порядка» жреца или «Изначального порядка» друида — при создании и для старых героев.
import { rulesData } from '../data'
import { OptionCard } from './creation/OptionCard'

export function ClassOrderPicker({ classId, value, onChange }: { classId: string; value: string | null | undefined; onChange: (id: string) => void }) {
  const order = rulesData.classes[classId]?.order
  if (!order) return null
  return (
    <section className="class-order" aria-label={order.feature} data-testid="class-order">
      <h4>{order.feature}</h4>
      <div className="option-grid option-grid--compact" role="radiogroup" aria-label={order.feature}>
        {order.options.map((o) => (
          <OptionCard key={o.id} optionId={o.id} selected={value === o.id} onSelect={() => onChange(o.id)} title={o.name} meta={o.nameEn}>
            {o.description}
          </OptionCard>
        ))}
      </div>
    </section>
  )
}
