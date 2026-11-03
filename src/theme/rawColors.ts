// Поиск цветов, заданных напрямую мимо токенов темы. Нужен тесту `noRawColors.test.ts`:
// стили и компоненты берут цвета только из CSS-переменных темы (`var(--color-…)`, `token('map', …)`).

/** Именованные цвета CSS (кроме служебных transparent/currentColor). */
const NAMED_COLORS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue ' +
    'chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey ' +
    'darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray ' +
    'darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen ' +
    'fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen ' +
    'lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime ' +
    'limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue ' +
    'mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive ' +
    'olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
    'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue ' +
    'slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke ' +
    'yellow yellowgreen'
  ).split(/\s+/),
)

/** #rgb, #rgba, #rrggbb, #rrggbbaa — но не `#fire-glow` и не `#cell-grid`. */
const HEX = /(?<![\w/&])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi
/** Цветовые функции CSS. */
const COLOR_FN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi
/** Свойства CSS, значением которых бывает цвет. */
const CSS_COLOR_PROP =
  /(?:^|[;{\s])((?:background|border|outline|box-shadow|text-shadow|filter|fill|stroke|stop-color|flood-color|lighting-color|caret-color|accent-color|column-rule|text-decoration)(?:-[a-z-]+)?|color)\s*:\s*([^;{}]+)/gi
/** Цвет в разметке и стилях компонентов: `fill="red"`, `stopColor: 'white'`. */
const JSX_COLOR_PROP =
  /\b(?:fill|stroke|color|stopColor|floodColor|lightingColor|background|backgroundColor|borderColor|outlineColor|caretColor)\s*[:=]\s*\{?\s*['"`]([^'"`]*)['"`]/g

export interface RawColor {
  line: number
  text: string
}

/** Цвета, заданные напрямую, в тексте файла стилей (`css`) или кода (`code`). Комментарии не считаются. */
export function findRawColors(source: string, kind: 'css' | 'code'): RawColor[] {
  const found: RawColor[] = []
  const lines = stripComments(source, kind).split('\n')
  lines.forEach((line, i) => {
    const hits = new Set<string>()
    for (const m of line.matchAll(HEX)) hits.add(m[0])
    for (const m of line.matchAll(COLOR_FN)) hits.add(`${m[0]}…)`)
    const props = kind === 'css' ? line.matchAll(CSS_COLOR_PROP) : line.matchAll(JSX_COLOR_PROP)
    for (const m of props) {
      const value = kind === 'css' ? m[2] : m[1]
      for (const word of value.toLowerCase().match(/[a-z]+/g) ?? []) if (NAMED_COLORS.has(word)) hits.add(word)
    }
    for (const text of hits) found.push({ line: i + 1, text })
  })
  return found
}

/** Убирает комментарии, сохраняя переводы строк (чтобы номера строк не сдвигались). */
function stripComments(source: string, kind: 'css' | 'code'): string {
  const blank = (s: string) => s.replace(/[^\n]/g, ' ')
  let text = source.replace(/\/\*[\s\S]*?\*\//g, blank)
  if (kind === 'code') text = text.replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p: string) => p + blank(m.slice(p.length)))
  return text
}
