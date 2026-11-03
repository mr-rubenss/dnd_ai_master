import { useState, type KeyboardEvent } from 'react'
import { CharacterStats } from './CharacterStats'
import { armorClass, carryingCapacity, inventoryWeight } from '../game/character'
import type { Character, Equipment, Inventory } from '../types/character'
import { ITEM_CATEGORIES, type ItemCatalog, type ItemDefinition } from '../types/items'
import { CATEGORY_LABELS, formatNumber, formatWeight, itemStatLines, itemSummary } from './itemText'

interface Props {
  character: Character
  inventory: Inventory
  catalog: ItemCatalog
}

const SLOT_LABELS: Record<keyof Equipment, string> = {
  weapon: 'Оружие',
  armor: 'Доспех',
  shield: 'Щит',
}

type Tab = 'equipment' | 'stats'

const TABS: { id: Tab; label: string }[] = [
  { id: 'equipment', label: 'Снаряжение' },
  { id: 'stats', label: 'Характеристики' },
]

const SLOT_ICONS: Record<keyof Equipment, string> = {
  weapon: '⚔️',
  armor: '🥋',
  shield: '🛡️',
}

/** Панель персонажа и инвентаря. На узком экране сворачивается в кнопку. */
export function InventoryPanel({ character, inventory, catalog }: Props) {
  const [open, setOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('equipment')

  // Стрелки влево/вправо переключают вкладки (паттерн ARIA tabs).
  const onTabKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const index = TABS.findIndex((t) => t.id === tab)
    const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]
    setTab(next.id)
    document.getElementById(`sheet-tab-${next.id}`)?.focus()
  }

  const ac = armorClass(character.abilities, inventory, catalog)
  const weight = inventoryWeight(inventory, catalog)
  const capacity = carryingCapacity(character.abilities)
  const hpPercent = Math.round((character.hp / character.maxHp) * 100)
  const equippedIds = new Set(Object.values(inventory.equipped).filter((id): id is string => id !== null))
  const weapon = inventory.equipped.weapon ? catalog[inventory.equipped.weapon] : undefined
  const handsBusy = weapon?.weapon?.properties.includes('two-handed') ?? false

  return (
    <aside className={`panel inventory-panel${open ? ' is-open' : ''}`} aria-label="Персонаж и инвентарь">
      <button
        type="button"
        className="inventory-toggle"
        aria-expanded={open}
        aria-controls="inventory-content"
        onClick={() => setOpen((value) => !value)}
      >
        <span>{character.name}</span>
        <span className="inventory-toggle-meta">
          ХП {character.hp}/{character.maxHp} · КД {ac} · {formatNumber(inventory.gold)} зм · {open ? '▲' : '▼'}
        </span>
      </button>

      <div id="inventory-content" className="inventory-content">
        <section className="character-card" aria-label="Персонаж">
          <h2 className="character-name">{character.name}</h2>
          <p className="character-meta">
            {character.species} · {character.className} {character.level} ур. · {character.background}
          </p>

          <div className="hp" aria-label={`Хиты: ${character.hp} из ${character.maxHp}`}>
            <div className="hp-label">
              <span>Хиты</span>
              <strong>
                {character.hp} / {character.maxHp}
              </strong>
            </div>
            <div className="hp-bar">
              <div
                className={`hp-fill${hpPercent <= 25 ? ' is-critical' : hpPercent <= 50 ? ' is-wounded' : ''}`}
                style={{ width: `${hpPercent}%` }}
              />
            </div>
          </div>

          <dl className="character-stats">
            <div>
              <dt>КД</dt>
              <dd>{ac}</dd>
            </div>
            <div>
              <dt>Золото</dt>
              <dd>{formatNumber(inventory.gold)} зм</dd>
            </div>
          </dl>
        </section>

        <div className="sheet-tabs" role="tablist" aria-label="Лист персонажа">
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`sheet-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`sheet-panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              className={tab === t.id ? 'is-active' : undefined}
              onClick={() => setTab(t.id)}
              onKeyDown={onTabKeyDown}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div id="sheet-panel-equipment" role="tabpanel" aria-labelledby="sheet-tab-equipment" hidden={tab !== 'equipment'}>
          <section className="inventory-section" aria-label="Экипировка">
            <h3>Экипировка</h3>
            <ul className="equipment-list">
              {(Object.keys(SLOT_LABELS) as (keyof Equipment)[]).map((slot) => {
                const id = inventory.equipped[slot]
                const item = id ? catalog[id] : undefined
                const emptyNote = slot === 'shield' && handsBusy ? 'руки заняты двуручным оружием' : 'пусто'
                return (
                  <li key={slot} className={item ? undefined : 'is-empty'}>
                    <span className="item-icon" aria-hidden="true">
                      {item?.icon ?? SLOT_ICONS[slot]}
                    </span>
                    <span className="equipment-slot">{SLOT_LABELS[slot]}</span>
                    <span className="equipment-item">
                      {item ? item.name : emptyNote}
                      {item && itemSummary(item) && <small>{itemSummary(item)}</small>}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="inventory-section" aria-label="Предметы">
            <h3 className="items-heading">
              Предметы
              <span className={weight > capacity ? 'is-overloaded' : undefined}>
                {formatNumber(weight)} / {formatWeight(capacity)}
              </span>
            </h3>

            {ITEM_CATEGORIES.map((category) => {
              const entries = inventory.items.filter((entry) => catalog[entry.itemId]?.category === category)
              if (entries.length === 0) return null
              return (
                <div key={category} className="inventory-group">
                  <h4>{CATEGORY_LABELS[category]}</h4>
                  <ul>
                    {entries.map((entry) => (
                      <ItemRow
                        key={entry.itemId}
                        item={catalog[entry.itemId]}
                        quantity={entry.quantity}
                        equipped={equippedIds.has(entry.itemId)}
                        expanded={expandedId === entry.itemId}
                        onToggle={() => setExpandedId((cur) => (cur === entry.itemId ? null : entry.itemId))}
                      />
                    ))}
                  </ul>
                </div>
              )
            })}
          </section>
        </div>

        <div id="sheet-panel-stats" role="tabpanel" aria-labelledby="sheet-tab-stats" hidden={tab !== 'stats'}>
          {tab === 'stats' && <CharacterStats character={character} />}
        </div>
      </div>
    </aside>
  )
}

interface ItemRowProps {
  item: ItemDefinition
  quantity: number
  equipped: boolean
  expanded: boolean
  onToggle: () => void
}

function ItemRow({ item, quantity, equipped, expanded, onToggle }: ItemRowProps) {
  const detailsId = `item-details-${item.id}`
  return (
    <li className={`item-row${expanded ? ' is-expanded' : ''}`}>
      <button type="button" className="item-button" aria-expanded={expanded} aria-controls={detailsId} onClick={onToggle}>
        <span className="item-icon" aria-hidden="true">
          {item.icon}
        </span>
        <span className="item-name">
          {item.name}
          {equipped && <span className="item-badge">надето</span>}
        </span>
        <span className="item-qty">{quantity > 1 ? `×${quantity}` : ''}</span>
        <span className="item-weight">{formatNumber(Math.round(item.weight * quantity * 100) / 100)}</span>
      </button>
      {expanded && (
        <div id={detailsId} className="item-details">
          <p>{item.description}</p>
          <dl>
            {itemStatLines(item).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
            <div>
              <dt>Вес</dt>
              <dd>
                {formatWeight(item.weight)}
                {quantity > 1 && ` за шт., всего ${formatWeight(Math.round(item.weight * quantity * 100) / 100)}`}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </li>
  )
}
