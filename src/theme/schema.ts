// Схема zod для темы: проверяет тему при загрузке (в будущем темы может предлагать ИИ или игрок).
import { z } from 'zod'
import {
  COLOR_TOKENS,
  DICE_TOKENS,
  FONT_SIZE_TOKENS,
  FONT_TOKENS,
  MAP_TOKENS,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
  SPACE_TOKENS,
  type Theme,
} from './types.ts'

/** Цвет: #rgb, #rrggbb, #rrggbbaa или rgb()/rgba()/hsl()/hsla(). */
export const colorValue = z
  .string()
  .regex(/^(#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgba?|hsla?)\([\d.,%\s/]+\))$/i, 'ожидается цвет: #rrggbb или rgba(…)')

/** Длина: число с единицей px, rem, em или %. */
export const lengthValue = z.string().regex(/^\d+(?:\.\d+)?(?:px|rem|em|%)$/, 'ожидается длина: 12px, 0.85rem, 50%')

/** Значение CSS без символов, которыми можно выйти за пределы объявления. */
const safeCss = z
  .string()
  .trim()
  .min(1, 'пустое значение')
  .regex(/^[^;{}<>]*$/, 'недопустимые символы ; { } < >')

/** Пропущенный токен и лишний ключ — по-русски (остальные сообщения схемы заданы ниже). */
const messages: z.core.$ZodErrorMap = (issue) => {
  if (issue.code === 'invalid_type' && issue.input === undefined) return 'нет значения'
  if (issue.code === 'unrecognized_keys') return `лишние ключи: ${issue.keys.join(', ')}`
  if (issue.code === 'invalid_type') return `ожидается ${issue.expected === 'object' ? 'объект' : issue.expected === 'string' ? 'строка' : issue.expected}`
  if (issue.code === 'invalid_value') return `допустимо: ${issue.values.map(String).join(', ')}`
  return undefined
}

/** Объект ровно с этими ключами (лишние — ошибка). */
function tokens<const K extends readonly string[], S extends z.ZodType>(keys: K, value: S) {
  const shape = Object.fromEntries(keys.map((k) => [k, value])) as { [P in K[number]]: S }
  return z.strictObject(shape)
}

export const themeSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/, 'id: латиница в нижнем регистре, цифры, дефис'),
  name: z.string().trim().min(1, 'нет названия'),
  colorScheme: z.enum(['dark', 'light']),
  colors: tokens(COLOR_TOKENS, colorValue),
  map: tokens(MAP_TOKENS, colorValue),
  dice: tokens(DICE_TOKENS, colorValue),
  fonts: tokens(FONT_TOKENS, safeCss),
  fontSizes: tokens(FONT_SIZE_TOKENS, lengthValue),
  space: tokens(SPACE_TOKENS, lengthValue),
  radii: tokens(RADIUS_TOKENS, lengthValue),
  shadows: tokens(SHADOW_TOKENS, safeCss),
})

// Тип и схема описывают одно и то же: при расхождении сборка упадёт здесь.
type SchemaTheme = z.infer<typeof themeSchema>
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const sameShape: Same<SchemaTheme, Theme> = true
void sameShape

/** Проверяет тему; при ошибке — исключение с понятным списком проблем. */
export function parseTheme(data: unknown): Theme {
  const result = themeSchema.safeParse(data, { error: messages })
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.') || 'тема'}: ${i.message}`)
    throw new Error(`Тема оформления некорректна:\n${problems.join('\n')}`)
  }
  return result.data
}
