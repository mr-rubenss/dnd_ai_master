// Тексты о заклинаниях для игрока: круг, школа, компоненты, эффект.
import { ABILITY_NAMES, formatModifier } from '../engine/abilities'
import { formatNotation } from '../engine/dice'
import { DAMAGE_TYPE_NAMES } from '../game/damageTypes'
import { SPELL_SCHOOL_NAMES, type SpellDefinition } from '../types/spells'

/** «Заговор» или «1-й круг». */
export const spellLevelText = (level: number) => (level === 0 ? 'Заговор' : `${level}-й круг`)

/** Краткая подпись: круг, школа, концентрация, ритуал. */
export function spellMeta(spell: SpellDefinition): string {
  return [spellLevelText(spell.level), SPELL_SCHOOL_NAMES[spell.school], spell.concentration ? 'концентрация' : '', spell.ritual ? 'ритуал' : '']
    .filter(Boolean)
    .join(' · ')
}

export function componentsText(spell: SpellDefinition): string {
  const c = spell.components
  return [c.verbal ? 'В' : '', c.somatic ? 'С' : '', c.material ? `М (${c.material})` : ''].filter(Boolean).join(', ')
}

/** Что движок сделает сам: атака, спасбросок, урон, лечение, свет. */
export function effectText(spell: SpellDefinition, stats?: { saveDc: number; attackBonus: number }): string {
  const e = spell.effect
  if (!e) return ''
  const parts: string[] = []
  if (e.attack) parts.push(`${e.attack === 'melee' ? 'рукопашная' : 'дальнобойная'} атака заклинанием${stats ? ` ${formatModifier(stats.attackBonus)}` : ''}`)
  if (e.save) parts.push(`спасбросок ${ABILITY_NAMES[e.save]}${stats ? ` Сл ${stats.saveDc}` : ''}${e.onSave === 'half' ? ' (половина при успехе)' : ''}`)
  if (e.damage) parts.push(`урон ${formatNotation(e.damage.dice)} ${DAMAGE_TYPE_NAMES[e.damage.type as keyof typeof DAMAGE_TYPE_NAMES] ?? e.damage.type}`)
  if (e.healing) parts.push(`лечение ${formatNotation(e.healing)}${e.addModifier ? ' + модификатор' : ''}`)
  if (e.light) parts.push('свет')
  return parts.join(', ')
}

