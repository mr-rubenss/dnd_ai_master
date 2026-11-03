import { useState } from 'react'
import type { Inventory, InventoryItem } from '../types/game'

const CATEGORY_LABELS: Record<InventoryItem['category'], string> = {
  weapon: 'Оружие',
  armor: 'Доспехи',
  gear: 'Снаряжение',
  consumable: 'Расходуемое',
  treasure: 'Ценности',
}

const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as InventoryItem['category'][]

interface Props {
  inventory: Inventory
}

/** Панель инвентаря. На узком экране сворачивается в кнопку. */
export function InventoryPanel({ inventory }: Props) {
  const [open, setOpen] = useState(false)
  const totalWeight = inventory.items.reduce((sum, item) => sum + item.weight * item.quantity, 0)

  return (
    <aside className={`panel inventory-panel${open ? ' is-open' : ''}`} aria-label="Инвентарь">
      <button
        type="button"
        className="inventory-toggle"
        aria-expanded={open}
        aria-controls="inventory-content"
        onClick={() => setOpen((value) => !value)}
      >
        <span>Инвентарь</span>
        <span className="inventory-toggle-meta">
          {inventory.items.length} предм. · {open ? '▲' : '▼'}
        </span>
      </button>

      <header className="panel-header inventory-heading">
        <h2>Инвентарь</h2>
      </header>

      <div id="inventory-content" className="inventory-content">
        <dl className="inventory-summary">
          <div>
            <dt>Золото</dt>
            <dd>{inventory.gold} зм</dd>
          </div>
          <div>
            <dt>Вес</dt>
            <dd>{totalWeight} фнт.</dd>
          </div>
        </dl>

        {CATEGORY_ORDER.map((category) => {
          const items = inventory.items.filter((item) => item.category === category)
          if (items.length === 0) return null
          return (
            <section key={category} className="inventory-group">
              <h3>{CATEGORY_LABELS[category]}</h3>
              <ul>
                {items.map((item) => (
                  <li key={item.id} className={item.equipped ? 'is-equipped' : undefined}>
                    <span className="item-name">
                      {item.name}
                      {item.equipped && <span className="item-badge">надето</span>}
                    </span>
                    {item.quantity > 1 && <span className="item-qty">×{item.quantity}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </aside>
  )
}
