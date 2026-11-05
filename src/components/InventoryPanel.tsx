import { useState, type KeyboardEvent } from 'react'
import { rulesData } from '../data'
import { formatModifier } from '../engine/abilities'
import { weaponAttacks, type WeaponAttack } from '../game/attacks'
import { armorClass, carryingCapacity, inventoryWeight } from '../game/character'
import { EQUIPMENT_SLOTS, equipActions, SLOT_NAMES, wieldedTwoHanded, type EquipmentSlot } from '../game/equipment'
import type { EquipmentChange } from '../game/storyActions'
import type { Character, Inventory } from '../types/character'
import { ITEM_CATEGORIES, type ItemCatalog, type ItemDefinition } from '../types/items'
import type { StoryMemory, WorldFact } from '../types/story'
import { AdventureJournal } from './AdventureJournal'
import { CharacterStats } from './CharacterStats'
import { CATEGORY_LABELS, formatDice, formatNumber, formatWeight, itemStatLines, itemSummary } from './itemText'

interface Props {
  character: Character
  inventory: Inventory
  catalog: ItemCatalog
  /** Сменить экипировку; возвращает причину отказа или null. */
  /** Смена экипировки; нет — только чтение (завершённая история). */
  onEquipChange?: (change: EquipmentChange) => string | null
  /** Журнал приключения: сводка ведущего и журнал фактов истории. */
  journal?: { memory?: StoryMemory; facts: readonly WorldFact[] }
}

type Tab = 'stats' | 'equipment' | 'journal'

const TABS: { id: Tab; label: string }[] = [
  { id: 'stats', label: 'Характеристики' },
  { id: 'equipment', label: 'Снаряжение' },
  { id: 'journal', label: 'Журнал' },
]

/** Последняя выбранная вкладка — настройка интерфейса этого браузера, не состояние игры. */
const TAB_STORAGE_KEY = 'ai-master:sheet-tab'

function loadTab(): Tab {
  try {
    const saved = window.localStorage.getItem(TAB_STORAGE_KEY)
    return saved === 'equipment' || saved === 'stats' || saved === 'journal' ? saved : 'stats'
  } catch {
    return 'stats'
  }
}

function saveTab(tab: Tab) {
  try {
    window.localStorage.setItem(TAB_STORAGE_KEY, tab)
  } catch {
    // Хранилище недоступно (приватный режим) — просто не запоминаем.
  }
}

const SLOT_ICONS: Record<EquipmentSlot, string> = {
  mainHand: '⚔️',
  offHand: '🛡️',
  armor: '🥋',
}

const DAMAGE_TYPES_RU = { slashing: 'рубящий', piercing: 'колющий', bludgeoning: 'дробящий' } as const

/** «Атака +5 · 2к6+3 рубящий». */
function formatAttack(attack: WeaponAttack): string {
  const bonus = attack.damageBonus === 0 ? '' : attack.damageBonus > 0 ? `+${attack.damageBonus}` : `−${Math.abs(attack.damageBonus)}`
  return `Атака ${formatModifier(attack.attackBonus)} · ${formatDice(attack.damageDice)}${bonus} ${DAMAGE_TYPES_RU[attack.damageType]}`
}

/** Панель персонажа и инвентаря. На узком экране сворачивается в кнопку. */
export function InventoryPanel({ character, inventory, catalog, onEquipChange, journal }: Props) {
  const [open, setOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [tab, setTabState] = useState<Tab>(loadTab)
  /** Сообщение об отказе в смене экипировки: где показать и что. */
  const [equipError, setEquipError] = useState<{ place: string; message: string } | null>(null)

  const setTab = (next: Tab) => {
    setTabState(next)
    saveTab(next)
  }

  // Стрелки влево/вправо переключают вкладки (паттерн ARIA tabs).
  const onTabKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const index = TABS.findIndex((t) => t.id === tab)
    const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]
    setTab(next.id)
    document.getElementById(`sheet-tab-${next.id}`)?.focus()
  }

  const change = (place: string, request: EquipmentChange) => {
    const reason = onEquipChange?.(request) ?? null
    setEquipError(reason ? { place, message: reason } : null)
  }

  const ac = armorClass(character, inventory, catalog)
  const weight = inventoryWeight(inventory, catalog)
  const capacity = carryingCapacity(character.abilities)
  const hpPercent = Math.round((character.hp / character.maxHp) * 100)
  const training = rulesData.classes[character.classId]?.martialWeapons ?? 'all'
  const attacks = weaponAttacks(character, inventory.equipped, catalog, training)
  const twoHands = wieldedTwoHanded(inventory.equipped, catalog)
  const mainItem = inventory.equipped.mainHand ? catalog[inventory.equipped.mainHand] : undefined

  const emptyNote = (slot: EquipmentSlot) => {
    if (slot === 'offHand' && twoHands && mainItem) {
      return mainItem.weapon?.properties.includes('two-handed') ? 'занята: двуручное оружие' : `«${mainItem.name}» двумя руками`
    }
    return 'пусто'
  }

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
              <dd data-testid="armor-class">{ac}</dd>
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

        <div id="sheet-panel-stats" role="tabpanel" aria-labelledby="sheet-tab-stats" hidden={tab !== 'stats'}>
          {tab === 'stats' && <CharacterStats character={character} />}
        </div>

        <div id="sheet-panel-equipment" role="tabpanel" aria-labelledby="sheet-tab-equipment" hidden={tab !== 'equipment'}>
          <section className="inventory-section" aria-label="Экипировка">
            <h3>Экипировка</h3>
            {equipError?.place === 'slots' && (
              <p className="equip-error" role="alert">
                {equipError.message}
              </p>
            )}
            <ul className="equipment-list">
              {EQUIPMENT_SLOTS.map((slot) => {
                const id = inventory.equipped[slot]
                const item = id ? catalog[id] : undefined
                const attack = attacks.find((a) => a.slot === slot)
                return (
                  <li key={slot} className={item ? undefined : 'is-empty'} data-slot={slot}>
                    <span className="item-icon" aria-hidden="true">
                      {item?.icon ?? SLOT_ICONS[slot]}
                    </span>
                    <span className="equipment-slot">{SLOT_NAMES[slot]}</span>
                    <span className="equipment-item">
                      {item ? item.name : emptyNote(slot)}
                      {attack ? (
                        <small data-testid={`attack-${slot}`}>
                          {formatAttack(attack)}
                          {attack.notes.length > 0 && <span className="attack-notes"> · {attack.notes.join(' · ')}</span>}
                        </small>
                      ) : (
                        item && itemSummary(item) && <small>{itemSummary(item)}</small>
                      )}
                      {item?.armor?.type === 'shield' && !character.proficiencies.armor.includes('shield') && (
                        <small className="equip-warning" data-testid="shield-untrained">
                          Нет владения щитами — щит не прибавляет КД
                        </small>
                      )}
                    </span>
                    {item && onEquipChange && (
                      <button
                        type="button"
                        className="slot-button"
                        aria-label={`Убрать: ${item.name}`}
                        onClick={() => change('slots', { kind: 'unequip', slot })}
                      >
                        Убрать
                      </button>
                    )}
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
                        slots={EQUIPMENT_SLOTS.filter((s) => inventory.equipped[s] === entry.itemId)}
                        expanded={expandedId === entry.itemId}
                        error={equipError?.place === entry.itemId ? equipError.message : null}
                        onToggle={() => {
                          setExpandedId((cur) => (cur === entry.itemId ? null : entry.itemId))
                          setEquipError(null)
                        }}
                        onChange={onEquipChange ? (request) => change(entry.itemId, request) : undefined}
                      />
                    ))}
                  </ul>
                </div>
              )
            })}
          </section>
        </div>

        <div id="sheet-panel-journal" role="tabpanel" aria-labelledby="sheet-tab-journal" hidden={tab !== 'journal'}>
          {tab === 'journal' && <AdventureJournal memory={journal?.memory} facts={journal?.facts ?? []} />}
        </div>
      </div>
    </aside>
  )
}

interface ItemRowProps {
  item: ItemDefinition
  quantity: number
  /** Слоты, в которых предмет сейчас экипирован. */
  slots: EquipmentSlot[]
  expanded: boolean
  error: string | null
  onToggle: () => void
  /** Смена экипировки; нет — только чтение. */
  onChange?: (change: EquipmentChange) => void
}

function ItemRow({ item, quantity, slots, expanded, error, onToggle, onChange }: ItemRowProps) {
  const detailsId = `item-details-${item.id}`
  const actions = equipActions(item)
  return (
    <li className={`item-row${expanded ? ' is-expanded' : ''}`} data-item={item.id}>
      <button type="button" className="item-button" aria-expanded={expanded} aria-controls={detailsId} onClick={onToggle}>
        <span className="item-icon" aria-hidden="true">
          {item.icon}
        </span>
        <span className="item-name">
          {item.name}
          {slots.length > 0 && <span className="item-badge">{slots.map((s) => SLOT_NAMES[s].toLowerCase()).join(', ')}</span>}
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
          {actions.length > 0 && onChange && (
            <div className="item-actions">
              {actions.map((action) =>
                slots.includes(action.slot) ? (
                  <button key={action.slot} type="button" className="item-action" onClick={() => onChange({ kind: 'unequip', slot: action.slot })}>
                    Убрать{actions.length > 1 ? ` (${SLOT_NAMES[action.slot].toLowerCase()})` : ''}
                  </button>
                ) : (
                  <button
                    key={action.slot}
                    type="button"
                    className="item-action is-primary"
                    onClick={() => onChange({ kind: 'equip', itemId: item.id, slot: action.slot })}
                  >
                    {action.label}
                  </button>
                ),
              )}
            </div>
          )}
          {error && (
            <p className="equip-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  )
}
