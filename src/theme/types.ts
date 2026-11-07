// Формат темы оформления. Тема — один объект: все цвета, шрифты, размеры текста, отступы, скругления, тени,
// цвета карты и подсветка бросков. Из него получаются CSS-переменные (см. `css.ts`), и только ими пользуются стили
// и компоненты. Списки ключей ниже — единственный источник имён токенов: схема (`schema.ts`) проверяет,
// что в теме есть каждый ключ и нет лишних.

/** Цвета интерфейса → `--color-<ключ>`. */
export const COLOR_TOKENS = [
  // Основа
  'bg',
  'bgVignette',
  'panel',
  'panelRaised',
  'border',
  'borderBright',
  'divider',
  'fg',
  'muted',
  'accent',
  'accentBright',
  'onAccent',
  'danger',
  'dangerBright',
  'onPrimary',
  'warning',
  // Сообщения
  'masterBg',
  'playerBg',
  'playerBorder',
  'playerFg',
  'playerAuthor',
  'systemFg',
  // Подложки и оттенки
  'accentTint',
  'accentTintSelected',
  'accentTintPrimary',
  'accentTintBadge',
  'focusRing',
  'dangerTint',
  'dangerTintCondition',
  'dangerTintFallen',
  'dangerText',
  'dangerTextSoft',
  'surfaceTint',
  'stripe',
  'footerBg',
  'tooltipBg',
  'scaleBg',
  'captionBg',
  'backdrop',
  'backdropStrong',
  'portraitShade',
  // Полоска хитов
  'hpTrack',
  'hpFill',
  'hpWoundedFrom',
  'hpWoundedTo',
  'hpCriticalFrom',
  'hpCriticalTo',
] as const

/**
 * Цвета карты → `--map-<ключ>`: пол и его узоры, стены, окна, двери, предметы обстановки, тени, свет и тьма, фишки НПС
 * и героя. `lightMaskOn`/`lightMaskOff` — служебные цвета маски света (белый и чёрный, яркость маски), их не меняют.
 */
export const MAP_TOKENS = [
  'background',
  'grid',
  'floorWood',
  'floorWoodAlt',
  'floorStone',
  'floorStoneAlt',
  'floorDirt',
  'floorDirtAlt',
  'floorGrass',
  'floorGrassAlt',
  'wallStone',
  'wallWood',
  'wallHalo',
  'windowGlass',
  'windowFrame',
  'door',
  'doorOutline',
  'doorSeam',
  'doorLock',
  'doorSwing',
  'highlight',
  'selection',
  'tableFill',
  'tableStroke',
  'tableTop',
  'mugFill',
  'mugStroke',
  'chairFill',
  'chairStroke',
  'chairBack',
  'barFill',
  'barStroke',
  'barEdge',
  'fireplaceFill',
  'fireplaceStroke',
  'fireplaceMouth',
  'flame',
  'flameCore',
  'fireGlow',
  'barrelFill',
  'barrelStroke',
  'barrelRing',
  'barrelTap',
  'tokenBorder',
  'npcFriendly',
  'npcNeutral',
  'npcHostile',
  'npcInitial',
  'npcLabel',
  'npcLabelOutline',
  'playerRing',
  'playerFill',
  'playerFillLight',
  'playerLabel',
  'floorTile',
  'floorTileAlt',
  'floorSeam',
  'floorFleck',
  'grassBlade',
  'objectShadow',
  'darkness',
  'lightWarm',
  'bedFrame',
  'bedSheet',
  'bedBlanket',
  'bedPillow',
  'chestFill',
  'chestBand',
  'metal',
  'shelfFill',
  'shelfItem',
  'rugFill',
  'rugBorder',
  'rugPattern',
  'candleWax',
  'treeCanopy',
  'treeCanopyDark',
  'treeTrunk',
  'rockFill',
  'rockShade',
  'roofFill',
  'roofRidge',
  'lightMaskOn',
  'lightMaskOff',
] as const

/** Кубики и подсветка натуральных 20 и 1 → `--dice-<ключ>`. */
export const DICE_TOKENS = [
  'buttonFrom',
  'buttonTo',
  'face',
  'faceStroke',
  'nat20',
  'nat20Border',
  'nat20Text',
  'nat20Tint',
  'nat20Glow',
  'nat20RollGlow',
  'nat20Face',
  'nat20FaceText',
  'nat20DieGlow',
  'nat1',
  'nat1Border',
  'nat1Text',
  'nat1Tint',
  'nat1Glow',
  'nat1Face',
  'nat1FaceText',
  'nat1DieGlow',
] as const

/** Семейства шрифтов → `--font-<ключ>`; `master` — текст ведущего (игрок может сменить в панели оформления). */
export const FONT_TOKENS = ['display', 'serif', 'ui', 'master'] as const

/**
 * Размеры текста → `--text-<ключ>`. Числовой ключ — ступень шкалы (в базовой теме это сотые доли rem:
 * `85` = 0.85rem); `input` — поле ввода на телефоне (не меньше 16px, иначе iOS увеличивает страницу);
 * `map-*` — подписи на карте (в единицах клетки).
 */
export const FONT_SIZE_TOKENS = [
  '66', '68', '70', '72', '74', '75', '78', '80', '82', '84', '85', '86', '88', '90', '92', '95',
  '100', '105', '108', '110', '115', '120', '125', '130', '135', '140', '150', '160', '170', '180', '190', '200', '260',
  'input',
  'map-initial',
  'map-label',
  'map-player',
] as const

/** Отступы (padding, margin, gap) → `--space-<ключ>`. Ключ — ступень шкалы (в базовой теме — пиксели). */
export const SPACE_TOKENS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '12', '14', '16', '18', '20', '24', '32', '48'] as const

/** Скругления → `--radius-<ключ>`. */
export const RADIUS_TOKENS = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'pill', 'round'] as const

/** Тени (box-shadow, text-shadow, filter: drop-shadow) → `--shadow-<ключ>`. */
export const SHADOW_TOKENS = [
  'title',
  'panel',
  'map',
  'mapHighlight',
  'playerRing',
  'tooltip',
  'focusRing',
  'expertiseRing',
  'selectedInset',
  'activeTab',
  'footer',
  'dialog',
  'diceButton',
  'die',
  'nat20Badge',
  'nat20Roll',
  'nat20Die',
  'nat20FaceText',
  'nat1Badge',
  'nat1Die',
] as const

export type ColorToken = (typeof COLOR_TOKENS)[number]
export type MapToken = (typeof MAP_TOKENS)[number]
export type DiceToken = (typeof DICE_TOKENS)[number]
export type FontToken = (typeof FONT_TOKENS)[number]
export type FontSizeToken = (typeof FONT_SIZE_TOKENS)[number]
export type SpaceToken = (typeof SPACE_TOKENS)[number]
export type RadiusToken = (typeof RADIUS_TOKENS)[number]
export type ShadowToken = (typeof SHADOW_TOKENS)[number]

/** Тема оформления. */
export interface Theme {
  /** Идентификатор: латиница, цифры, дефис. */
  id: string
  /** Название для игрока. */
  name: string
  /** Схема цветов браузера (полосы прокрутки, поля ввода). */
  colorScheme: 'dark' | 'light'
  colors: Record<ColorToken, string>
  map: Record<MapToken, string>
  dice: Record<DiceToken, string>
  fonts: Record<FontToken, string>
  fontSizes: Record<FontSizeToken, string>
  space: Record<SpaceToken, string>
  radii: Record<RadiusToken, string>
  /** Тени могут ссылаться на цветовые токены: `0 0 8px var(--dice-nat20-glow)`. */
  shadows: Record<ShadowToken, string>
}
