// Инструменты ИИ-ведущего: единственный способ ведущего менять игру. Модель только предлагает вызов —
// движок проверяет аргументы и состояние, превращает вызов в действия истории (StoryEvent), прогоняет их через
// checkAction на копии состояния и возвращает результат для модели. Недопустимый вызов отклоняется с причиной,
// ничего не меняя. Чистые функции; запись действий в историю делает вызывающий код (masterTurn.ts).
import type { AiTool, AiToolCall } from '../ai/types'
import { ABILITIES, ABILITY_NAMES, ABILITY_NAMES_GENITIVE, abilityModifier, proficiencyBonus, type Ability } from '../engine/abilities'
import { abilityCheck, CheckError, MAX_DC, MIN_DC, passiveScore, savingThrow, type D20TestResult } from '../engine/checks'
import { CONDITION_DEFINITIONS, CONDITIONS, MAX_EXHAUSTION, type ActiveCondition, type ConditionId } from '../engine/conditions'
import { DiceError, roll, type RollMode, type Rng } from '../engine/dice'
import { SKILL_DEFINITIONS, SKILLS, type SkillId } from '../engine/skills'
import { isUsable, type ItemCatalog } from '../types/items'
import { DOOR_STATES, EFFECT_KIND_NAMES, EFFECT_KINDS, FLAT_OBJECT_TYPES, MAP_KIND_OBJECTS, NPC_ATTITUDES, NPC_PERSONALITY_FIELDS, OBJECT_TYPES, type DoorState, type EffectKind, type LocationData, type MapEffect, type MapObject, type MapObjectType, type NpcAttitude, type NpcPersonality } from '../types/location'
import { npcChangesProblem } from './npcs'
import { parseCreatedLocation } from './locationCreate'
import type { ActionAuthor, NpcChanges, PartyMember, StoryEvent, StoryState } from '../types/story'
import { changeCoins, COIN_LABELS, COIN_UNITS, formatCoins, formatCp, priceToCp, type CoinUnit } from './coins'
import { factProblem, sameFact } from './facts'
import { placementProblem } from './mapPlacement'
import { findMapTarget, limitBySpeed, routeToTarget } from './heroTargets'
import { AREA_SHAPE_NAMES, AREA_SHAPES, areaTemplateProblem, COMPASS, directionBetween, DIRECTED_SHAPES, edgeOrigin, MAX_AREA_FEET, type AreaShape, type AreaTemplate, type CellRect } from '../engine/areas'
import { areaResultText, mapAreaResult } from './mapAreas'
import type { PriceList } from './prices'
import { END_TURN_TOOL } from './turnChanges'
import { checkSubjectOf } from './classOrder'
import { castableSpellsText, knownSpells, planCast, spendCast, spellSlots, type MagicRules } from './magic'
import { findSpell } from './spellMatch'
import { featureResources, hitDiceOf, REST_NAMES, restEvents, restRequestProblem } from './rest'
import { recoveryText } from './features'
import { DAMAGE_TYPE_NAMES } from './damageTypes'
import { goldRewardProblem, itemRewardProblem, partyLevel, resolveSource, REWARD_SOURCES, type RewardSource } from './rewards'
import { applyAction, checkAction, ENGINE, makeAction, MASTER, OUT_OF_GAME_REFUSAL, storyTime } from './storyActions'
import { advanceProblem, durationText, MAX_ADVANCE_MINUTES, minutesUntilHour, minutesUntilPart, timeText, type PartOfDay } from '../engine/time'

export { DAMAGE_TYPE_NAMES } from './damageTypes'
type DamageTypeId = keyof typeof DAMAGE_TYPE_NAMES

const HERO = { type: 'string', description: 'Имя или id героя. Можно не указывать — тогда это герой игрока.' }
const int = (description: string, min?: number, max?: number) => ({
  type: 'integer',
  description,
  ...(min !== undefined ? { minimum: min } : {}),
  ...(max !== undefined ? { maximum: max } : {}),
})
const str = (description: string) => ({ type: 'string', description })
const oneOf = (values: readonly string[], description: string) => ({ type: 'string', enum: [...values], description })
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})

/** Описания инструментов для модели. */
export const MASTER_TOOLS: AiTool[] = [
  {
    name: 'request_check',
    description:
      'Попросить движок бросить проверку навыка или характеристики (или спасбросок) героя против Сл. Вызывай, когда исход действия неочевиден. ' +
      'Движок бросит кубик сам и вернёт результат — по нему опиши исход. Укажи ровно одно: skill или ability. ' +
      'hidden: true — скрытая проверка (Внимательность против скрытности вора, Проницательность против лжи НПС, поиск ловушки): игрок не видит бросок, провал не озвучивай. ' +
      'passive: true — пассивная проверка без броска: движок сравнит Сл с пассивным значением героя (10 + модификатор, как пассивная Внимательность).',
    parameters: object(
      {
        hero: HERO,
        skill: oneOf(SKILLS, `Навык: ${SKILLS.map((s) => `${s} — ${SKILL_DEFINITIONS[s].name}`).join(', ')}.`),
        ability: oneOf(ABILITIES, `Характеристика (если проверка без навыка): ${ABILITIES.map((a) => `${a} — ${ABILITY_NAMES[a]}`).join(', ')}.`),
        saving_throw: { type: 'boolean', description: 'true — спасбросок этой характеристики (только с ability).' },
        dc: int('Сложность: 10 — просто, 15 — средне, 20 — трудно, 25 — почти невозможно.', MIN_DC, MAX_DC),
        reason: str('Зачем проверка, коротко: «убедить Гуннара открыть кладовую».'),
        mode: oneOf(['normal', 'advantage', 'disadvantage'], 'Преимущество или помеха от обстоятельств (состояния героя движок учтёт сам).'),
        hidden: { type: 'boolean', description: 'true — скрытая проверка: бросок не показывается игроку, только твой рассказ.' },
        passive: { type: 'boolean', description: 'true — пассивная проверка без броска (10 + модификатор против Сл); всегда скрыта от игрока.' },
        reveals: str('id скрытого НПС или объекта (помечены «скрыт» в состоянии игры): при успехе движок сам раскроет его на карте (Внимательность — заметить вора, Анализ — найти тайник).'),
      },
      ['dc', 'reason'],
    ),
  },
  {
    name: 'give_item',
    description:
      'Дать герою предмет из справочника игры — только из настоящего источника: source location (лежал в объекте локации), ' +
      'npc (дал НПС рядом), purchase (купил — движок сам спишет цену из справочника, change_gold не вызывай), quest (награда ' +
      'за задание из журнала), loot (добыча с НПС или из объекта). Предметы из ниоткуда («у меня в сумке вдруг оказался…») ' +
      'не выдавай. Ценность за раз и редкость ограничены уровнем отряда — движок откажет, если слишком щедро.',
    parameters: object(
      {
        hero: HERO,
        item: str('id предмета или его точное русское название из справочника.'),
        quantity: int('Сколько штук (по умолчанию 1).', 1, 999),
        source: oneOf(REWARD_SOURCES, 'Откуда предмет: location, npc, purchase, quest, loot.'),
        from: str('id или имя: НПС (npc, loot, продавец для purchase), объект локации (location, loot), задание (quest).'),
      },
      ['item', 'source'],
    ),
  },
  {
    name: 'remove_item',
    description: 'Забрать у героя предмет (потратил, отдал, потерял, сломал). Нельзя забрать то, чего у героя нет.',
    parameters: object({ hero: HERO, item: str('id предмета или его название.'), quantity: int('Сколько штук (по умолчанию 1).', 1, 999) }, ['item']),
  },
  {
    name: 'change_gold',
    description:
      'Деньги героя: заплатил (минус) или получил (плюс). Кошелёк — монеты мм/см/зм, сдачу движок посчитает сам. ' +
      'Цена из прейскуранта — укажи price (id) и quantity; своя цена — amount и currency (например −4 и cp за кружку эля). ' +
      'Денег не хватает — движок откажет: тогда сделки не было, обыграй это в рассказе. ' +
      'Доход (плюс) — только из источника: source npc (заплатил или дал НПС рядом, в том числе за проданный предмет), ' +
      'location (лежали в объекте локации), quest (награда за задание), loot (добыча); сумма за раз ограничена уровнем отряда.',
    parameters: object(
      {
        hero: HERO,
        source: oneOf(['location', 'npc', 'quest', 'loot'], 'Для дохода (плюс): откуда деньги.'),
        from: str('Для дохода: id или имя НПС, объекта локации или задания.'),
        amount: { type: 'number', description: 'Сколько: отрицательное — заплатил, положительное — получил. Например −4.' },
        currency: oneOf(['cp', 'sp', 'gp'], 'Монеты для amount: cp — медные (мм), sp — серебряные (см), gp — золотые (зм). По умолчанию gp.'),
        price: str('id из прейскуранта (ale-mug, inn-modest…) — оплата по этой цене.'),
        quantity: int('Сколько раз по цене из прейскуранта (по умолчанию 1).', 1, 999),
        reason: str('За что, коротко: «эль», «комната на ночь».'),
      },
      ['reason'],
    ),
  },
  {
    name: 'use_item',
    description:
      'Герой применил или израсходовал предмет: выстрелил (стрела), съел рацион, зажёг факел, выпил зелье, применил набор целителя. ' +
      'Движок спишет количество или заряды и применит эффект из справочника (зелье лечения — бросок лечения). ' +
      'Не хватает — откажет. Отдал, потерял, сломал — это remove_item.',
    parameters: object(
      { hero: HERO, item: str('id предмета или его название.'), quantity: int('Сколько (по умолчанию 1).', 1, 99), reason: str('Зачем.') },
      ['item'],
    ),
  },
  {
    name: 'cast_spell',
    description:
      'Герой творит заклинание из своего листа (заговоры, подготовленные, магия черт и вида — список в «Магии» героя). ' +
      'Движок проверит, что герой его знает и что есть свободная ячейка, спишет ячейку (заговор, ритуал и бесплатное сотворение — без ячейки) ' +
      'и сам бросит атаку, спасбросок цели-героя, урон или лечение. Не знает или ячеек нет — откажет: тогда заклинание не сотворено, обыграй это.',
    parameters: object(
      {
        hero: HERO,
        spell: str('id заклинания из списка героя («Может сотворить» в листе), например minor-illusion. Можно и название — движок узнает его в любом падеже.'),
        slot_level: int('Круг ячейки (не ниже круга заклинания). Не указывай — движок выберет бесплатное сотворение или младшую свободную ячейку.', 1, 9),
        ritual: { type: 'boolean', description: 'true — ритуалом (только у заклинаний с пометкой «ритуал»): на 10 минут дольше, без ячейки.' },
        target: str('Цель: имя героя отряда, имя НПС или что-то ещё («дверь», «трое гоблинов»). Лечение без цели — на себя.'),
        reason: str('Зачем, коротко.'),
      },
      ['spell'],
    ),
  },
  {
    name: 'rest',
    description:
      'Отдых отряда: short — короткий (1 час), long — долгий (8 часов). Вызывай, когда игрок просит отдохнуть или отряд ложится спать, ' +
      'и это место достаточно безопасно. Если игрок уже нажал «Отдых» — этим вызовом ты разрешаешь его отдых. Что восстановилось ' +
      '(хиты, кости хитов, ячейки, умения), посчитает движок. Помешал кто-то — вызови interrupt_rest вместо этого.',
    parameters: object(
      {
        kind: oneOf(['short', 'long'], 'short — короткий (1 час), long — долгий (8 часов).'),
        hit_dice: int('Короткий отдых: сколько костей хитов тратит герой игрока (по умолчанию — сколько выбрал игрок, иначе 0).', 0, 20),
        reason: str('Где и как отдыхают, коротко.'),
      },
      ['kind'],
    ),
  },
  {
    name: 'advance_time',
    description:
      'Сдвинуть игровое время вперёд, когда в рассказе прошло заметное время: «час разговора», «весь день в пути», «проспали до утра». ' +
      'Укажи minutes (сколько прошло) или until — до какого времени суток (morning — 6:00, day — 12:00, evening — 18:00, night — 22:00) либо until_hour (час 0–23, ближайший в будущем). ' +
      'Время не идёт назад. Отдых (rest) двигает время сам — не вызывай для него advance_time.',
    parameters: object(
      {
        minutes: int('Сколько минут прошло (1–43200).', 1, MAX_ADVANCE_MINUTES),
        until: oneOf(['morning', 'day', 'evening', 'night'], 'До начала какого времени суток.'),
        until_hour: int('До какого часа (0–23), ближайшего в будущем.', 0, 23),
        reason: str('Что заняло время, коротко: «час разговора с трактирщиком».'),
      },
      ['reason'],
    ),
  },
  {
    name: 'interrupt_rest',
    description:
      'Прервать отдых, который попросил игрок: засада, шум, стража, непогода — опасное место. Ничего не восстановится. ' +
      'Укажи причину и опиши её в рассказе.',
    parameters: object({ reason: str('Что помешало, коротко: «в дверь ломятся стражники».') }, ['reason']),
  },
  {
    name: 'use_feature',
    description:
      'Герой применил умение с ограниченным числом применений — класса («Второе дыхание», «Ярость», «Бардовское вдохновение»), вида (оружие дыхания, «Прилив адреналина», ' +
      '«Неутомимая стойкость», «Знание камня», «Великанье происхождение») или воззвания; список с остатком — в разделе «Умения» листа героя. ' +
      'Движок спишет применение и сам бросит лечение или урон (оружие дыхания: урон и Сл спасброска целей). Применений нет — откажет. ' +
      'Бесплатные сотворения заклинаний тратятся не здесь, а через cast_spell.',
    parameters: object(
      {
        hero: HERO,
        feature: str('id или название умения.'),
        amount: int('Для запаса («Наложение рук»): сколько хитов потратить (столько и вылечится).', 1, 100),
        target: str('Кого лечит запас — имя героя (по умолчанию сам герой).'),
        reason: str('Зачем.'),
      },
      ['feature'],
    ),
  },
  {
    name: 'change_hp',
    description:
      'Нанести герою урон (с типом) или вылечить. Урон всегда бросает движок по кубикам dice («1d6», «2d8+2») — числом урон не задаётся. ' +
      'Хиты не опускаются ниже 0 и не поднимаются выше максимума; при 0 хитов герой теряет сознание — это движок применит сам.',
    parameters: object(
      {
        hero: HERO,
        kind: oneOf(['damage', 'healing'], 'damage — урон, healing — лечение.'),
        dice: str('Кубики урона или лечения: «1d6», «2d8+2» — бросит движок.'),
        amount: int('Только для лечения: сколько хитов (если не кубиками).', 1, 999),
        damage_type: oneOf(Object.keys(DAMAGE_TYPE_NAMES), 'Тип урона (для damage).'),
        source: str('Источник: «удар дубинкой», «падение с лестницы».'),
      },
      ['kind'],
    ),
  },
  {
    name: 'move_npc',
    description: 'Переместить НПС на текущей карте в свободную клетку пола.',
    parameters: object({ npc: str('id или имя НПС.'), x: int('Столбец клетки.', 0), y: int('Строка клетки.', 0) }, ['npc', 'x', 'y']),
  },
  {
    name: 'add_npc',
    description:
      'Добавить на текущую карту нового НПС (вошёл в таверну, вылез из погреба) в свободную клетку пола. ' +
      'Сразу задай ему личность коротко: предыстория, цель, страх или слабость, манера речи, чем занят — так он будет живым, а не справочником.',
    parameters: object(
      {
        name: str('Имя.'),
        x: int('Столбец клетки.', 0),
        y: int('Строка клетки.', 0),
        attitude: oneOf(NPC_ATTITUDES, 'Отношение к героям.'),
        description: str('Кто это, как выглядит — то, что герой видит с первого взгляда.'),
        backstory: str('Предыстория, 2–3 коротких предложения: откуда, что пережил, почему здесь (до 400 символов).'),
        goal: str('Чего хочет прямо сейчас — одной фразой (до 160 символов).'),
        fear: str('Страх или слабость — одной фразой (до 160 символов).'),
        speech: str('Манера речи: 2–3 черты — словечки, темп, как обращается к героям (до 200 символов).'),
        activity: str('Чем занят прямо сейчас (до 160 символов) — это видно и игроку.'),
      },
      ['name', 'x', 'y'],
    ),
  },
  {
    name: 'update_npc',
    description:
      'Обновить НПС текущей локации, когда он изменился: занялся другим делом, добился цели или получил новую, сменил отношение к героям, ' +
      'герой узнал о нём важное. Указывай только то, что меняется; пустая строка — убрать поле.',
    parameters: object(
      {
        npc: str('id или имя НПС.'),
        attitude: oneOf(NPC_ATTITUDES, 'Новое отношение к героям.'),
        description: str('Новое описание внешности.'),
        backstory: str('Предыстория, 2–3 коротких предложения: откуда, что пережил, почему здесь (до 400 символов).'),
        goal: str('Чего хочет прямо сейчас — одной фразой (до 160 символов).'),
        fear: str('Страх или слабость — одной фразой (до 160 символов).'),
        speech: str('Манера речи: 2–3 черты — словечки, темп, как обращается к героям (до 200 символов).'),
        activity: str('Чем занят прямо сейчас (до 160 символов) — это видно и игроку.'),
      },
      ['npc'],
    ),
  },
  {
    name: 'remove_npc',
    description:
      'Убрать НПС с текущей карты: ушёл или сбежал. Гибель существ — только по броскам движка в бою (боевой системы пока нет): ' +
      'reason died движок отклонит, а слова игрока «убиваю одним ударом» — лишь попытка.',
    parameters: object({ npc: str('id или имя НПС.'), reason: oneOf(['left', 'fled', 'died'], 'left — ушёл, fled — сбежал, died — погиб.') }, ['npc']),
  },
  {
    name: 'add_condition',
    description: 'Наложить на героя состояние SRD 5.2 (отравлен, сбит с ног…). Истощение — с уровнем.',
    parameters: object(
      {
        hero: HERO,
        condition: oneOf(CONDITIONS, `Состояние: ${CONDITIONS.map((c) => `${c} — ${CONDITION_DEFINITIONS[c].name}`).join(', ')}.`),
        level: int('Уровень Истощения (только для exhaustion).', 1, MAX_EXHAUSTION),
      },
      ['condition'],
    ),
  },
  {
    name: 'remove_condition',
    description: 'Снять с героя состояние.',
    parameters: object({ hero: HERO, condition: oneOf(CONDITIONS, 'Состояние.') }, ['condition']),
  },
  {
    name: 'note_fact',
    description:
      'Записать в журнал фактов то, что должно жить дольше ленты: НПС и их отношение к герою, обещания, долги, тайны, важные события. ' +
      'Стиль — заметка мастера: одна строка до ~20 слов, без прилагательных и вводных слов, имена и названия точно, ' +
      'без пересказа диалогов и описаний. Пример: «Тобиас — вор бочек; знает, что герой его подозревает; должен гильдии 30 зм». ' +
      'Если факт уточняет уже записанный (о том же НПС, долге, тайне) — движок обновит старую запись.',
    parameters: object({ text: str('Факт — одна строка до ~20 слов.') }, ['text']),
  },
  {
    name: 'add_object',
    description:
      'Добавить на текущую карту объект обстановки: огонь, обломки, упавшую люстру, ящик, сундук, факел. Движок проверит, что клетки на карте, ' +
      'это пол и они свободны (ковёр и свеча клетку не занимают — их можно положить под стол или на стол). Факел, свеча, огонь и камин светят.',
    parameters: object(
      {
        name: str('Название: «Упавшая люстра».'),
        type: oneOf(
          OBJECT_TYPES,
          'Вид: table, chair, bar, fireplace, barrel, fire — огонь, debris — обломки, item — прочий предмет, bed — кровать, chest — сундук, ' +
            'shelf — полка, rug — ковёр, torch — факел, candle — свеча, tree — дерево, rock — камень, building — строение.',
        ),
        x: int('Столбец левой верхней клетки.', 0),
        y: int('Строка левой верхней клетки.', 0),
        w: int('Ширина в клетках (по умолчанию 1).', 1, 10),
        h: int('Высота в клетках (по умолчанию 1).', 1, 10),
        description: str('Как выглядит.'),
      },
      ['name', 'type', 'x', 'y'],
    ),
  },
  {
    name: 'remove_object',
    description: 'Убрать объект с текущей карты (сгорел, унесли, разобрали).',
    parameters: object({ object: str('id или название объекта.') }, ['object']),
  },
  {
    name: 'update_object',
    description: 'Изменить объект на карте: опрокинутый стол, загоревшаяся бочка, сдвинутый шкаф. Укажи только то, что меняется.',
    parameters: object(
      {
        object: str('id или название объекта.'),
        name: str('Новое название.'),
        description: str('Новое описание.'),
        type: oneOf(OBJECT_TYPES, 'Новый вид.'),
        x: int('Новый столбец.', 0),
        y: int('Новая строка.', 0),
        w: int('Новая ширина.', 1, 10),
        h: int('Новая высота.', 1, 10),
      },
      ['object'],
    ),
  },
  {
    name: 'set_door',
    description: 'Открыть, закрыть или запереть дверь на текущей карте (в том числе выломанная дверь — open).',
    parameters: object({ door: str('id или название двери.'), state: oneOf(DOOR_STATES, 'open — открыта, closed — закрыта, locked — заперта.') }, [
      'door',
      'state',
    ]),
  },
  {
    name: 'move_hero',
    description:
      'Передвинуть героя по карте. Игрок пишет о перемещении («подхожу к стойке», «сажусь у камина», «иду к Тобиасу») — вызови с target: id объекта, НПС или двери. ' +
      'Движок сам найдёт ближайшую свободную клетку рядом с целью и проведёт героя по пути в обход стен и мебели. Не дойти (заперта дверь, путь перекрыт) — получишь причину: обыграй её. ' +
      'В бою путь тратит скорость героя: не хватит — герой пройдёт, сколько может. ' +
      'Перемещение по сюжету («тебя отбросило взрывом», «тебя втащили в повозку») — x, y и reason: без пути и без траты скорости. Координаты для обычной ходьбы не задавай.',
    parameters: object({
      hero: HERO,
      target: str('id (или название) цели: объект, НПС, дверь, окно — герой встанет рядом.'),
      x: int('Столбец клетки — только для перемещения по сюжету (с reason).', 0),
      y: int('Строка клетки — только для перемещения по сюжету (с reason).', 0),
      reason: str('Причина перемещения по сюжету: «отбросило взрывом».'),
    }),
  },
  {
    name: 'ping',
    description: 'Подсветить на карте цель или клетку на несколько секунд: «ведущий указывает на дверь», «вот тот стол». Игра не меняется.',
    parameters: object({
      target: str('id (или название) объекта, НПС, двери или окна.'),
      x: int('Столбец клетки (если без target).', 0),
      y: int('Строка клетки (если без target).', 0),
      label: str('Короткая подпись у подсветки (до 40 символов): «сюда».'),
    }),
  },
  {
    name: 'show_area',
    description:
      'Показать на карте область воздействия по правилам SRD (игра не меняется): «вот докуда достаёт свет факела» (sphere 20 от факела), ' +
      '«конус дыхания накроет вот это» (cone 15 от героя к цели). Движок подсветит задетые клетки (стены и закрытые двери заслоняют) и вернёт, кто задет. ' +
      'Начало — target (герой, НПС, объект, дверь) или x, y; без них — герой игрока. Конус, линия и куб начинаются у края начала и нужны toward или direction.',
    parameters: object(
      {
        shape: oneOf(AREA_SHAPES, 'cone — конус, cube — куб, cylinder — цилиндр, emanation — излучение вокруг начала, line — линия, sphere — сфера.'),
        size: int('Футы: длина конуса и линии, радиус сферы, цилиндра и излучения, сторона куба.', 1, MAX_AREA_FEET),
        target: str('Начало: имя героя или id (название) НПС, объекта, двери.'),
        x: int('Столбец клетки начала (если без target).', 0),
        y: int('Строка клетки начала (если без target).', 0),
        toward: str('Куда направить конус, линию или куб: имя героя или id (название) цели.'),
        direction: oneOf(Object.keys(COMPASS), 'Или сторона света (north — вверх по карте).'),
        width: int('Ширина линии, футов (по умолчанию 5).', 1, MAX_AREA_FEET),
        height: int('Высота цилиндра, футов (для подписи).', 1, MAX_AREA_FEET),
        label: str('Короткая подпись (до 40 символов): «Свет факела».'),
      },
      ['shape', 'size'],
    ),
  },
  {
    name: 'add_effect',
    description:
      'Поставить на карту эффект с областью: fire — огонь, smoke — дым, darkness — тьма, puddle — лужа, glow — магическое свечение. ' +
      'Проходу не мешает: опасность (урон огня, помеха в дыму) обыгрывай проверками и change_hp с кубиками. Убрать — remove_effect.',
    parameters: object(
      {
        kind: oneOf(EFFECT_KINDS, 'Вид эффекта.'),
        x: int('Столбец левой верхней клетки.', 0),
        y: int('Строка левой верхней клетки.', 0),
        w: int('Ширина в клетках (по умолчанию 1).', 1, 20),
        h: int('Высота в клетках (по умолчанию 1).', 1, 20),
        name: str('Название: «Горящая солома».'),
      },
      ['kind', 'x', 'y'],
    ),
  },
  {
    name: 'remove_effect',
    description: 'Убрать эффект с карты (огонь потушили, дым рассеялся).',
    parameters: object({ effect: str('id или название эффекта.') }, ['effect']),
  },
  {
    name: 'reveal',
    description:
      'Раскрыть скрытого НПС или скрытый объект (в состоянии игры помечены «скрыт»): вор вышел из тени, тайник нашли. ' +
      'Обычно — по успешной проверке героя (request_check с reveals раскроет сам) или когда скрытый сам себя выдал.',
    parameters: object({ target: str('id или имя скрытого НПС или объекта.') }, ['target']),
  },
  {
    name: 'create_location',
    description:
      'Создать новую локацию (место, куда ведёт выход: улица, подвал, лес) — JSON карты. Создавай, только если её ещё нет в «Локациях мира»: ' +
      'созданная хранится в истории, и при возвращении это та же карта. Движок проверит JSON и вернёт ошибки списком — исправь и вызови снова. ' +
      'Формат: id (латиница, kebab-case), name, description (1–2 предложения), cellFeet 5, width и height (клетки, 8–30), floor (wood|stone|tile|dirt|grass), ' +
      'wallMaterial (stone|wood), rooms [{id, name, x, y, w, h}] — прямоугольники пола, стены по периметру ставятся сами (на улице — одна комната во всю карту), ' +
      'openings [{x1,y1,x2,y2}] — проёмы в стенах, doors [{id, name, state: open|closed|locked, x1,y1,x2,y2}] — только на стенах, windows [{id, x1,y1,x2,y2}]. ' +
      'Отрезки — по узлам сетки (узел (x,y) — левый верхний угол клетки), строго по горизонтали или вертикали. ' +
      'objects [{id, type, name, description, x, y, w, h}] — на полу, не друг на друге и не поперёк стен (type как в add_object; ковёр и свеча клетку не занимают), ' +
      'npcs [{id, name, description, attitude: friendly|neutral|hostile, x, y}] — на полу, по одному в клетке, ' +
      'exits [{id, kind: door|road|stairs|edge, name, x, y, door, to}] — хотя бы один: клетка пола у выхода (edge — на краю карты, door — вплотную к двери, door — её id; to — id локации, куда ведёт), ' +
      'playerStart {x, y} — клетка пола. Весь пол должен быть достижим от playerStart. Тексты — на русском, без раскрытия тайн.',
    parameters: object({ location: { type: 'object', description: 'JSON локации в формате выше.' } }, ['location']),
  },
  {
    name: 'set_combat',
    description:
      'Бой (заготовка: раунды и скорость передвижения; атак боевой системы пока нет). start — бой начался, next_round — новый раунд ' +
      '(скорость героев восстановлена), end — бой окончен. В бою перемещения героя тратят его скорость.',
    parameters: object({ state: oneOf(['start', 'next_round', 'end'], 'start, next_round или end.') }, ['state']),
  },
]

/** Инструменты хода ведущего: все инструменты игры и служебный end_turn (сверка изменений за ход). */
export const TURN_TOOLS: AiTool[] = [...MASTER_TOOLS, END_TURN_TOOL]

export interface ToolContext {
  catalog: ItemCatalog
  /** Прейскурант (src/data/prices.json) — для change_gold с price. */
  prices?: PriceList
  /** Правила магии и справочник заклинаний — для cast_spell; нет — заклинания не творятся. */
  rules?: MagicRules
  /** Генератор случайных чисел для бросков (в тестах — подменённый). */
  rng?: Rng
  now: () => number
  newId: () => string
}

export interface ToolEvent {
  event: StoryEvent
  author: ActionAuthor
}

export interface ToolOutcome {
  ok: boolean
  /** Что вернуть модели (JSON). */
  result: Record<string, unknown>
  /** Действия для истории (пусто, если вызов отклонён). */
  events: ToolEvent[]
}

/** Отказ без источника награды. */
export const SOURCE_REQUIRED =
  'Укажи «source» — откуда это у героя (location, npc, purchase, quest, loot). Из ниоткуда предметы и деньги не появляются: ' +
  'если источника нет, героя ждёт лишь попытка (поиск, просьба, торг) — обыграй это в рассказе.'

class ToolRejected extends Error {}
const reject = (reason: string): never => {
  throw new ToolRejected(reason)
}

// ---------- Разбор аргументов ----------

type Args = Record<string, unknown>
const text = (args: Args, key: string, required = false): string | undefined => {
  const v = args[key]
  if (v === undefined || v === null || v === '') return required ? reject(`Нужен параметр «${key}».`) : undefined
  return typeof v === 'string' && v.trim() ? v.trim() : reject(`«${key}» — непустая строка.`)
}
/** Число; модели иногда присылают его строкой («-4») — принимаем и так. */
const numberArg = (args: Args, key: string): number | undefined => {
  const v = args[key]
  if (v === undefined || v === null || v === '') return undefined
  const n = typeof v === 'string' ? Number(v.trim().replace(',', '.').replace('−', '-')) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : reject(`«${key}» — число.`)
}
const integer = (args: Args, key: string, required = false): number | undefined => {
  const v = numberArg(args, key)
  if (v === undefined) return required ? reject(`Нужен параметр «${key}».`) : undefined
  return Number.isInteger(v) ? v : reject(`«${key}» — целое число.`)
}
const choice = <T extends string>(args: Args, key: string, values: readonly T[], required = false): T | undefined => {
  const v = text(args, key, required)
  if (v === undefined) return undefined
  return (values as readonly string[]).includes(v) ? (v as T) : reject(`«${key}»: «${v}» — не из списка: ${values.join(', ')}.`)
}
/** Поля личности НПС из аргументов (с пустыми строками — для update_npc, где пустая строка убирает поле). */
function personalityArgs(args: Args, keepEmpty = false): NpcPersonality {
  const out: NpcPersonality = {}
  for (const key of NPC_PERSONALITY_FIELDS) {
    const v = args[key]
    if (typeof v !== 'string') continue
    if (v.trim() || keepEmpty) out[key] = v.trim()
  }
  return out
}
const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е')

/** Найти по id или имени; несколько с одинаковым именем — попросить id. */
function findByName<T extends { id: string; name: string }>(list: readonly T[], query: string, what: string): T {
  const exact = list.find((x) => x.id === query)
  if (exact) return exact
  const named = list.filter((x) => norm(x.name) === norm(query))
  if (named.length === 1) return named[0]
  if (named.length > 1) return reject(`${what} с именем «${query}» несколько — укажи id: ${named.map((x) => x.id).join(', ')}.`)
  return reject(`${what} «${query}» здесь нет. Есть: ${list.map((x) => `${x.name} (${x.id})`).join(', ') || 'никого'}.`)
}

/** Урон или лечение героя и их последствия по SRD 5.2 (без сознания, гибель от массивного урона, приход в себя). */
function hpEvents(member: PartyMember, kind: 'damage' | 'healing', amount: number, damageType: DamageTypeId | undefined, author: ActionAuthor) {
  const c = member.character
  const events: ToolEvent[] = [{ event: { type: 'hpChanged', heroId: member.heroId, kind, amount, ...(damageType ? { damageType } : {}) }, author }]
  const hp = kind === 'damage' ? Math.max(0, c.hp - amount) : Math.min(c.maxHp, c.hp + amount)
  const has = (id: ConditionId) => c.conditions.some((x) => x.id === id)
  let died = false
  let unconscious = has('unconscious')
  if (kind === 'damage' && hp === 0) {
    // SRD 5.2: урон, который сверх нуля хитов достигает максимума хитов, убивает сразу; иначе — без сознания.
    if (amount - c.hp >= c.maxHp) {
      died = true
      events.push({ event: { type: 'heroDied', heroId: member.heroId }, author: ENGINE })
    } else if (!unconscious) {
      unconscious = true
      events.push({ event: { type: 'conditionsChanged', heroId: member.heroId, conditions: [...c.conditions, { id: 'unconscious' }] }, author: ENGINE })
    }
  }
  if (kind === 'healing' && c.hp === 0 && hp > 0 && unconscious) {
    unconscious = false
    events.push({ event: { type: 'conditionsChanged', heroId: member.heroId, conditions: c.conditions.filter((x) => x.id !== 'unconscious') }, author: ENGINE })
  }
  return { events, hp, died, unconscious }
}

function heroOf(state: StoryState, args: Args): PartyMember {
  const query = text(args, 'hero')
  const living = state.party.filter((m) => !m.fallen)
  if (!query) return living[0] ?? reject('В отряде нет живых героев.')
  const member = state.party.find((m) => m.heroId === query || norm(m.character.name) === norm(query))
  if (!member) return reject(`Героя «${query}» нет в отряде. В отряде: ${state.party.map((m) => m.character.name).join(', ')}.`)
  return member.fallen ? reject(`${member.character.name} погиб.`) : member
}

function itemOf(catalog: ItemCatalog, query: string) {
  const item = catalog[query] ?? Object.values(catalog).find((i) => norm(i.name) === norm(query))
  if (item) return item
  const near = Object.values(catalog)
    .filter((i) => norm(i.name).includes(norm(query)) || norm(query).includes(norm(i.name)))
    .slice(0, 5)
  return reject(`Предмета «${query}» нет в справочнике.${near.length ? ` Похожие: ${near.map((i) => `${i.name} (${i.id})`).join(', ')}.` : ''}`)
}

const currentLocationOf = (state: StoryState) => state.world.locations[state.world.currentLocationId]

/** Скорость, если у вида её нет в данных (фт.). */
const DEFAULT_SPEED = 30

/** reveals у проверки: скрытый НПС или объект текущей локации. */
function revealsOf(state: StoryState, args: Args): { kind: 'npc' | 'object'; id: string; name: string } | null {
  const query = text(args, 'reveals')
  if (!query) return null
  const location = currentLocationOf(state)
  const hidden = [
    ...location.npcs.filter((n) => n.hidden).map((n) => ({ id: n.id, name: n.name, kind: 'npc' as const })),
    ...location.objects.filter((o) => o.hidden).map((o) => ({ id: o.id, name: o.name, kind: 'object' as const })),
  ]
  if (!hidden.length) return reject('reveals: скрытых НПС и объектов здесь нет.')
  return findByName(hidden, query, 'Скрытого')
}
const heroesOnMap = (state: StoryState) => state.party.filter((m) => !m.fallen).map((m) => ({ name: m.character.name, position: m.position }))

/** id из названия: латиница/цифры не обязательны — берём короткий случайный хвост. */
const slugId = (prefix: string, existing: { id: string }[], newId: () => string) => {
  let id = `${prefix}-${newId()
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 8)
    .toLowerCase()}`
  while (existing.some((x) => x.id === id)) id += 'x'
  return id
}

// ---------- Инструменты ----------

type Handler = (state: StoryState, args: Args, ctx: ToolContext) => { events: ToolEvent[]; result: Record<string, unknown> }

const HANDLERS: Record<string, Handler> = {
  request_check(state, args, ctx) {
    const member = heroOf(state, args)
    const skill = choice<SkillId>(args, 'skill', SKILLS)
    const ability = choice<Ability>(args, 'ability', ABILITIES)
    const save = args.saving_throw === true
    if (!!skill === !!ability) reject('Укажи ровно одно: skill или ability.')
    if (save && !ability) reject('Спасбросок — с ability, а не со skill.')
    const dc = integer(args, 'dc', true)!
    const reason = text(args, 'reason', true)!
    const mode = choice<RollMode>(args, 'mode', ['normal', 'advantage', 'disadvantage']) ?? 'normal'
    const hidden = args.hidden === true
    if (args.passive === true) {
      if (save) reject('Спасбросок пассивным не бывает — бросай его (можно hidden: true).')
      if (dc < MIN_DC || dc > MAX_DC) reject(`Сл — от ${MIN_DC} до ${MAX_DC}.`)
      const subject = ctx.rules ? checkSubjectOf(member.character, ctx.rules) : member.character
      const target = skill ? { skill } : { ability: ability! }
      const score = passiveScore(subject, target, mode)
      const label = skill ? `пассивная ${SKILL_DEFINITIONS[skill].name}` : `пассивная проверка ${ABILITY_NAMES_GENITIVE[ability!]}`
      const success = score >= dc
      return {
        events: [],
        result: {
          check: label,
          hero: member.character.name,
          dc,
          passive: score,
          success,
          hidden: true,
          message: `${member.character.name}: ${label} ${score} против Сл ${dc} — ${success ? 'успех: герой замечает' : 'провал: герой ничего не замечает — не говори об этом игроку, просто продолжай рассказ'}. Броска не было, игрок ничего не видел.`,
        },
      }
    }
    let check: D20TestResult
    try {
      check = save
        ? savingThrow(member.character, ability!, { dc, mode, rng: ctx.rng })
        
        : abilityCheck(ctx.rules ? checkSubjectOf(member.character, ctx.rules) : member.character, skill ? { skill } : { ability: ability! }, { dc, mode, rng: ctx.rng })
    } catch (error) {
      if (error instanceof CheckError) return reject(error.message)
      throw error
    }
    const id = ctx.newId()
    const roll = check.roll ? { id: `roll-${id}`, label: check.label, timestamp: ctx.now(), result: check.roll } : undefined
    // Успех раскрывает скрытого НПС или объект (reveals).
    const revealed = revealsOf(state, args)
    const revealEvent: ToolEvent[] =
      revealed && check.success ? [{ event: { type: 'entityRevealed', locationId: currentLocationOf(state).id, kind: revealed.kind, entityId: revealed.id }, author: ENGINE }] : []
    return {
      events: [
        {
          event: {
            type: 'checkRolled',
            messageId: `check-${id}`,
            check: { heroId: member.heroId, heroName: member.character.name, reason, result: check, ...(hidden ? { hidden: true } : {}) },
            roll,
          },
          author: ENGINE,
        },
        ...revealEvent,
      ],
      result: {
        ...(revealEvent.length ? { revealed: revealed!.name, reveal_message: `«${revealed!.name}» обнаружен — теперь виден на карте.` } : {}),
        check: check.label,
        hero: member.character.name,
        dc,
        mode: check.mode,
        natural: check.roll?.natural ?? null,
        modifier: check.modifier,
        total: check.total,
        success: check.success,
        margin: check.margin,
        auto_fail: check.autoFailReason,
        ...(hidden ? { hidden: true } : {}),
        message: hidden
          ? `Скрытая проверка (игрок не видит): ${check.label}, Сл ${dc}: ${check.total ?? 'автоматический провал'} — ${check.success ? 'успех. Опиши, что герой заметил или понял' : 'провал. Не озвучивай провал («ты не заметил») — просто продолжай рассказ, как будто ничего не было'}.`
          : `${check.label}, Сл ${dc}: ${check.total ?? 'автоматический провал'} — ${check.success ? 'успех' : 'провал'}. Опиши исход.`,
      },
    }
  },

  give_item(state, args, ctx) {
    const member = heroOf(state, args)
    const item = itemOf(ctx.catalog, text(args, 'item', true)!)
    const quantity = integer(args, 'quantity') ?? 1
    if (quantity < 1) reject('«quantity» — не меньше 1.')
    const source = choice<RewardSource>(args, 'source', REWARD_SOURCES) ?? reject(SOURCE_REQUIRED)
    const resolved = resolveSource(state, source, text(args, 'from'))
    if (typeof resolved === 'string') reject(resolved)
    const problem = itemRewardProblem(item, quantity, partyLevel(state), source)
    if (problem) reject(problem)
    const events: ToolEvent[] = []
    let paid = ''
    if (source === 'purchase') {
      // Покупка: цену из справочника списывает движок — бесплатно «купить» нельзя.
      if (!item.cost) reject(`«${item.name}» не продаётся (нет цены в справочнике). Купить нельзя — обыграй это в рассказе.`)
      const cost = Math.round(item.cost! * 100) * quantity
      const coins = changeCoins(member.inventory.coins, -cost)
      if (!coins) reject(`Денег не хватает: у ${member.character.name} ${formatCoins(member.inventory.coins)}, а «${item.name}» стоит ${formatCp(-cost)}. Покупки нет — обыграй это в рассказе.`)
      events.push({ event: { type: 'moneyChanged', heroId: member.heroId, delta: -cost, coins: coins! }, author: MASTER })
      paid = ` Заплачено ${formatCp(-cost)}, в кошельке: ${formatCoins(coins!)}.`
    }
    events.push({ event: { type: 'itemsGranted', heroId: member.heroId, items: [{ itemId: item.id, quantity }] }, author: MASTER })
    return {
      events,
      result: { message: `${member.character.name} получает: ${item.name}${quantity > 1 ? ` ×${quantity}` : ''} (${(resolved as { label: string }).label}).${paid}` },
    }
  },

  remove_item(state, args, ctx) {
    const member = heroOf(state, args)
    const query = text(args, 'item', true)!
    const owned = member.inventory.items.map((e) => ctx.catalog[e.itemId]).filter(Boolean)
    const item = ctx.catalog[query] ?? owned.find((i) => norm(i.name) === norm(query)) ?? itemOf(ctx.catalog, query)
    const quantity = integer(args, 'quantity') ?? 1
    return {
      events: [{ event: { type: 'itemsRemoved', heroId: member.heroId, items: [{ itemId: item.id, quantity }] }, author: MASTER }],
      result: { message: `${member.character.name} лишается: ${item.name}${quantity > 1 ? ` ×${quantity}` : ''}.` },
    }
  },

  change_gold(state, args, ctx) {
    const member = heroOf(state, args)
    const priceId = text(args, 'price')
    let delta: number
    if (priceId) {
      const entry = ctx.prices?.[priceId] ?? reject(`В прейскуранте нет «${priceId}».${ctx.prices ? ` Есть: ${Object.keys(ctx.prices).join(', ')}.` : ''}`)
      const quantity = integer(args, 'quantity') ?? 1
      if (quantity < 1) reject('«quantity» — не меньше 1.')
      delta = -entry.cp * quantity
    } else {
      const amount = numberArg(args, 'amount') ?? reject('Нужен «amount» (с currency) или «price» из прейскуранта.')
      const currency = choice<CoinUnit>(args, 'currency', COIN_UNITS) ?? 'gp'
      const cp = priceToCp(amount, currency)
      if (cp === null) reject(`${amount} ${COIN_LABELS[currency]} — не целое число медных монет. 1 зм = 10 см = 100 мм.`)
      delta = cp!
      if (delta === 0) reject('«amount» — ненулевое число.')
    }
    let from = ''
    if (delta > 0) {
      // Доход — только из настоящего источника и в пределах таблицы по уровню отряда.
      const source = choice<RewardSource>(args, 'source', ['location', 'npc', 'quest', 'loot']) ?? reject(`${SOURCE_REQUIRED} Для денег — npc, location, quest или loot.`)
      const resolved = resolveSource(state, source, text(args, 'from'))
      if (typeof resolved === 'string') reject(resolved)
      const problem = goldRewardProblem(delta, partyLevel(state))
      if (problem) reject(problem)
      from = ` (${(resolved as { label: string }).label})`
    }
    const purse = member.inventory.coins
    const coins = changeCoins(purse, delta)
    if (!coins) reject(`Денег не хватает: у ${member.character.name} ${formatCoins(purse)}, а нужно ${formatCp(delta)}. Сделки нет — обыграй это в рассказе.`)
    return {
      events: [{ event: { type: 'moneyChanged', heroId: member.heroId, delta, coins: coins! }, author: MASTER }],
      result: {
        purse: formatCoins(coins!),
        message: `${member.character.name}: ${delta < 0 ? 'заплатил' : 'получил'} ${formatCp(delta)}${from}${delta < 0 && coins!.gp < purse.gp ? ' (со сдачей)' : ''}. В кошельке: ${formatCoins(coins!)}.`,
      },
    }
  },

  use_item(state, args, ctx) {
    const member = heroOf(state, args)
    const query = text(args, 'item', true)!
    const owned = member.inventory.items.map((e) => ctx.catalog[e.itemId]).filter(Boolean)
    const item = ctx.catalog[query] ?? owned.find((i) => norm(i.name) === norm(query)) ?? itemOf(ctx.catalog, query)
    if (!isUsable(item))
      reject(`«${item.name}» не расходуется при применении — просто опиши это в рассказе (отдал, потерял, сломал — remove_item).`)
    const quantity = integer(args, 'quantity') ?? 1
    if (quantity < 1) reject('«quantity» — не меньше 1.')
    const perItem = item.use?.charges
    const events: ToolEvent[] = [
      perItem
        ? { event: { type: 'itemChargesUsed', heroId: member.heroId, itemId: item.id, uses: quantity, perItem }, author: MASTER }
        : { event: { type: 'itemsRemoved', heroId: member.heroId, items: [{ itemId: item.id, quantity }] }, author: MASTER },
    ]
    const result: Record<string, unknown> = {}
    const healing = item.use?.effect?.healing
    if (healing) {
      // Эффект из справочника — бросает движок: каждое зелье отдельно.
      let total = 0
      const rolls: string[] = []
      for (let i = 0; i < quantity; i++) {
        const r = roll(healing, { rng: ctx.rng })
        total += r.total
        rolls.push(`${healing} = ${r.total}`)
        events.push({ event: { type: 'diceRolled', roll: { id: `roll-${ctx.newId()}`, timestamp: ctx.now(), result: r } }, author: ENGINE })
      }
      const hp = hpEvents(member, 'healing', total, undefined, ENGINE)
      events.push(...hp.events)
      result.healing = { rolls, total, hp: hp.hp, max_hp: member.character.maxHp }
    }
    const entry = member.inventory.items.find((e) => e.itemId === item.id)
    const leftUnits = entry ? (perItem ? (entry.quantity - 1) * perItem + (entry.charges ?? perItem) : entry.quantity) - quantity : -quantity
    return {
      events,
      result: {
        ...result,
        left: Math.max(0, leftUnits),
        message: `${member.character.name} применяет: ${item.name}${quantity > 1 ? ` ×${quantity}` : ''}${perItem ? ` (осталось применений: ${Math.max(0, leftUnits)})` : `, осталось ${Math.max(0, leftUnits)}`}.${
          healing ? ` Лечение ${result.healing && (result.healing as { total: number }).total}, хиты ${(result.healing as { hp: number }).hp}/${member.character.maxHp}.` : ''
        }`,
      },
    }
  },

  cast_spell(state, args, ctx) {
    const rules = ctx.rules ?? reject('Заклинания недоступны: нет справочника заклинаний.')
    const member = heroOf(state, args)
    const c = member.character
    const query = text(args, 'spell', true)!
    // Отказ всегда с причиной и списком того, что герой может сотворить, — ведущий исправит вызов.
    const available = () => ` Доступно ${c.name}: ${castableSpellsText(c, rules)}. Вызови cast_spell с id из списка.`
    // Мягко: id, название без учёта регистра и ё/е, с падежами («малой иллюзией»), — сначала среди заклинаний героя.
    const found = findSpell(query, knownSpells(c, rules).map((k) => k.spell), rules.spells)
    if (found && 'ambiguous' in found) return reject(`«${query}» подходит к нескольким заклинаниям: ${found.ambiguous.map((s) => `${s.name} (${s.id})`).join(', ')}.${available()}`)
    if (!found) return reject(`Заклинания «${query}» нет ни у ${c.name}, ни в справочнике.${available()}`)
    const spell = found.spell
    const slotLevel = integer(args, 'slot_level')
    const plan = planCast({ ...c }, { spellId: spell.id, slotLevel, ritual: args.ritual === true }, rules)
    if (typeof plan === 'string') return reject(`${plan}${available()}`)
    const events: ToolEvent[] = [
      {
        event: { type: 'spellCast', heroId: member.heroId, spellId: spell!.id, slotLevel: plan.slotLevel, freeKey: plan.freeKey, ritual: plan.ritual },
        author: MASTER,
      },
    ]
    const targetName = text(args, 'target')
    const targetHero = targetName ? state.party.find((m) => !m.fallen && (m.heroId === targetName || norm(m.character.name) === norm(targetName))) : undefined
    const result: Record<string, unknown> = {
      spell: spell!.name,
      level: spell!.level,
      spent: plan.slotLevel ? `ячейка ${plan.slotLevel}-го круга` : plan.freeKey ? 'бесплатное сотворение' : plan.ritual ? 'ритуал (без ячейки, +10 минут)' : 'заговор (без ячейки)',
      save_dc: plan.stats.saveDc,
      attack_bonus: plan.stats.attackBonus,
      concentration: spell!.concentration,
      duration: spell!.duration,
    }
    const notes: string[] = []
    const rollDice = (notation: string, label: string) => {
      const r = roll(notation, { rng: ctx.rng })
      events.push({ event: { type: 'diceRolled', roll: { id: `roll-${ctx.newId()}`, label, timestamp: ctx.now(), result: r } }, author: ENGINE })
      return r
    }
    const effect = spell!.effect
    const mod = plan.stats.modifier
    if (effect?.healing) {
      const heal = rollDice(`${effect.healing}${effect.addModifier && mod ? (mod > 0 ? `+${mod}` : `${mod}`) : ''}`, `${spell!.name}: лечение`)
      const amount = Math.max(1, heal.total)
      const patient = targetHero ?? (targetName ? undefined : member)
      result.healing = amount
      if (patient) {
        const hp = hpEvents(patient, 'healing', amount, undefined, ENGINE)
        events.push(...hp.events)
        result.hp = `${hp.hp}/${patient.character.maxHp}`
        notes.push(`${patient.character.name} восстанавливает ${amount} хитов (${hp.hp}/${patient.character.maxHp}).`)
      } else notes.push(`Лечение ${amount} хитов — цель «${targetName}» не герой отряда.`)
    }
    if (effect?.attack) {
      const attack = rollDice(`1d20${plan.stats.attackBonus >= 0 ? '+' : ''}${plan.stats.attackBonus}`, `${spell!.name}: атака заклинанием`)
      const natural = attack.natural
      result.attack = { total: attack.total, natural }
      notes.push(`Атака заклинанием: ${attack.total}${natural === 20 ? ' (натуральная 20 — критическое попадание)' : natural === 1 ? ' (натуральная 1 — промах)' : ''} — сравни с КД цели.`)
    }
    if (effect?.save) {
      result.save = { ability: effect.save, dc: plan.stats.saveDc }
      if (targetHero) {
        const check = savingThrow(targetHero.character, effect.save, { dc: plan.stats.saveDc, rng: ctx.rng })
        const id = ctx.newId()
        events.push({
          event: {
            type: 'checkRolled',
            messageId: `check-${id}`,
            check: { heroId: targetHero.heroId, heroName: targetHero.character.name, reason: `${spell!.name}`, result: check },
            roll: check.roll ? { id: `roll-${id}`, label: check.label, timestamp: ctx.now(), result: check.roll } : undefined,
          },
          author: ENGINE,
        })
        result.save = { ...(result.save as object), total: check.total, success: check.success }
        notes.push(`${targetHero.character.name}: ${check.label} ${check.total ?? '—'} против Сл ${plan.stats.saveDc} — ${check.success ? 'успех' : 'провал'}.`)
      } else notes.push(`Цель совершает спасбросок ${ABILITY_NAMES[effect.save]} Сл ${plan.stats.saveDc} — исход реши сам по силе цели.`)
    }
    if (effect?.damage) {
      const damage = rollDice(effect.damage.dice, `${spell!.name}: урон`)
      result.damage = { total: damage.total, type: effect.damage.type }
      const typeName = DAMAGE_TYPE_NAMES[effect.damage.type as DamageTypeId] ?? effect.damage.type
      const saved = effect.save && targetHero ? (result.save as { success?: boolean }).success : undefined
      if (targetHero && effect.save) {
        const amount = saved ? (effect.onSave === 'half' ? Math.floor(damage.total / 2) : 0) : damage.total
        if (amount > 0) {
          const hp = hpEvents(targetHero, 'damage', amount, effect.damage.type as DamageTypeId, ENGINE)
          events.push(...hp.events)
          notes.push(`${targetHero.character.name} получает ${amount} урона (${typeName}), хиты ${hp.hp}/${targetHero.character.maxHp}.`)
        } else notes.push(`${targetHero.character.name} не получает урона.`)
      } else
        notes.push(
          `Урон ${damage.total} (${typeName})${effect.save ? (effect.onSave === 'half' ? ', при успешном спасброске — половина' : ', при успешном спасброске — нет') : effect.attack ? ' при попадании' : ''}.`,
        )
    }
    if (effect?.light) notes.push('Свет: опиши, что теперь освещено.')
    if (!effect) notes.push('Эффект — по описанию заклинания: опиши его в рассказе.')
    const after = spellSlots({ ...c, magic: spendCast(c.magic, plan) }, rules)
    result.slots_left = after.map((s) => `${s.level}-й круг: ${s.left}/${s.total}`).join(', ') || 'нет ячеек'
    result.message = `${c.name} творит «${spell!.name}» (${result.spent}). ${notes.join(' ')}`
    return { events, result }
  },

  rest(state, args, ctx) {
    const rules = ctx.rules ?? reject('Отдых недоступен: нет данных правил.')
    const pending = state.pendingRest
    const kind = choice<'short' | 'long'>(args, 'kind', ['short', 'long']) ?? pending?.kind ?? reject('Нужен параметр «kind».')
    if (pending && pending.kind !== kind)
      reject(`Игрок попросил ${REST_NAMES[pending.kind].toLowerCase()}, а не ${REST_NAMES[kind!].toLowerCase()}: разреши его (kind: ${pending.kind}) или прерви (interrupt_rest).`)
    const lead = state.party.find((m) => !m.fallen)
    const hitDice = { ...(pending?.hitDice ?? {}) }
    const asked = integer(args, 'hit_dice')
    if (asked !== undefined && lead && kind === 'short') hitDice[lead.heroId] = asked
    if (!pending) {
      const problem = restRequestProblem(state, kind!, hitDice, rules)
      if (problem) reject(problem)
    }
    const events = restEvents(state, kind!, hitDice, { rules, rng: ctx.rng, now: ctx.now, newId: ctx.newId }).map((event) => ({ event, author: ENGINE }))
    const done = events.at(-1)!.event as Extract<StoryEvent, { type: 'restCompleted' }>
    const lines = done.heroes.map((r) => {
      const m = state.party.find((x) => x.heroId === r.heroId)!
      const hd = hitDiceOf(m.character, rules)
      return `${m.character.name}: +${r.hpGained} хитов${r.hitDiceRolls.length ? ` (кости хитов: ${r.hitDiceRolls.join(' + ')}; осталось ${hd.left - r.hitDiceRolls.length}/${hd.total})` : ''}${r.restoreSlots && Object.keys(m.character.magic?.slotsUsed ?? {}).length ? ', ячейки восстановлены' : ''}${Object.keys(r.resources).length ? ', умения восстановлены' : ''}${r.exhaustionRemoved ? ', Истощение −1' : ''}`
    })
    return { events, result: { kind, message: `${REST_NAMES[kind!]} окончен. ${lines.join('; ')}. Опиши отдых и что было потом.` } }
  },

  advance_time(state, args) {
    const reason = text(args, 'reason', true)!
    const minutesArg = integer(args, 'minutes')
    const until = choice<PartOfDay>(args, 'until', ['morning', 'day', 'evening', 'night'])
    const untilHour = integer(args, 'until_hour')
    const given = [minutesArg, until, untilHour].filter((x) => x !== undefined).length
    if (given !== 1) reject('Укажи ровно одно: minutes, until или until_hour.')
    const now = storyTime(state)
    if (untilHour !== undefined && (untilHour < 0 || untilHour > 23)) reject('«until_hour» — час от 0 до 23.')
    const minutes = minutesArg ?? (until ? minutesUntilPart(now, until) : minutesUntilHour(now, untilHour!))
    const problem = advanceProblem(minutes)
    if (problem) reject(problem)
    const after = now + minutes
    return {
      events: [{ event: { type: 'timeAdvanced', minutes, reason }, author: MASTER }],
      result: { time: timeText(after), message: `Прошло ${durationText(minutes)}: сейчас ${timeText(after)}. Учитывай время суток в рассказе.` },
    }
  },

  interrupt_rest(state, args, ctx) {
    if (!state.pendingRest) reject('Сейчас никто не отдыхает — прерывать нечего.')
    const reason = text(args, 'reason', true)!
    return {
      events: [{ event: { type: 'restInterrupted', messageId: ctx.newId(), reason }, author: MASTER }],
      result: { message: `Отдых прерван: ${reason}. Ничего не восстановлено — опиши, что случилось.` },
    }
  },

  use_feature(state, args, ctx) {
    const rules = ctx.rules ?? reject('Умения недоступны: нет данных правил.')
    const member = heroOf(state, args)
    const query = text(args, 'feature', true)!
    const states = featureResources(member.character, rules)
    const found = states.find((r) => r.resource.id === query || norm(r.resource.name) === norm(query))
    if (!found)
      reject(`У ${member.character.name} нет умения «${query}» с применениями.${states.length ? ` Есть: ${states.map((r) => `${r.resource.name} (${r.resource.id})`).join(', ')}.` : ''}`)
    const { resource, left, max } = found!
    if (left <= 0) reject(`«${resource.name}» у ${member.character.name} потрачено (0/${max}) — восстанавливается: ${recoveryText(resource)}.`)
    if (resource.pool) {
      const amount = integer(args, 'amount') ?? reject(`«${resource.name}» — запас: укажи amount (в запасе ${left}).`)
      if (amount! > left) reject(`В запасе «${resource.name}» осталось ${left}, а нужно ${amount}.`)
      const targetName = text(args, 'target')
      const patient = targetName ? state.party.find((m) => !m.fallen && (m.heroId === targetName || norm(m.character.name) === norm(targetName))) : member
      if (!patient) reject(`«${targetName}» — не герой отряда: опиши лечение НПС в рассказе, запас всё равно тратится только на героев.`)
      const hp = hpEvents(patient!, 'healing', amount!, undefined, ENGINE)
      return {
        events: [{ event: { type: 'featureUsed', heroId: member.heroId, featureId: resource.id, amount: amount! }, author: MASTER }, ...hp.events],
        result: { left: left - amount!, max, message: `${member.character.name}: «${resource.name}» — ${patient!.character.name} восстанавливает ${amount} хитов (${hp.hp}/${patient!.character.maxHp}); в запасе ${left - amount!}/${max}.` },
      }
    }
    const events: ToolEvent[] = [{ event: { type: 'featureUsed', heroId: member.heroId, featureId: resource.id }, author: MASTER }]
    let healing = ''
    if (resource.effect?.healing) {
      const lvl = member.character.level
      const r = roll(`${resource.effect.healing}${resource.effect.addLevel ? `+${lvl}` : ''}`, { rng: ctx.rng })
      events.push({ event: { type: 'diceRolled', roll: { id: `roll-${ctx.newId()}`, label: `${resource.name}: лечение`, timestamp: ctx.now(), result: r } }, author: ENGINE })
      const hp = hpEvents(member, 'healing', r.total, undefined, ENGINE)
      events.push(...hp.events)
      healing = ` Лечение ${r.total}, хиты ${hp.hp}/${member.character.maxHp}.`
    }
    const c = member.character
    const pb = proficiencyBonus(c.level)
    if (resource.effect?.damage) {
      const count = resource.effect.damage.count[Math.min(20, Math.max(1, c.level)) - 1]
      const type = rules.species[c.speciesId]?.choice?.options.find((o) => o.id === c.speciesOption)?.damageType
      const typeName = type ? (DAMAGE_TYPE_NAMES[type as DamageTypeId] ?? type) : ''
      const r = roll(`${count}d${resource.effect.damage.die}`, { rng: ctx.rng })
      events.push({ event: { type: 'diceRolled', roll: { id: `roll-${ctx.newId()}`, label: `${resource.name}: урон${typeName ? ` (${typeName})` : ''}`, timestamp: ctx.now(), result: r } }, author: ENGINE })
      healing += ` Урон ${r.total}${typeName ? ` (${typeName})` : ''} при провале, ${Math.floor(r.total / 2)} при успехе.`
    }
    if (resource.effect?.save) {
      const dc = 8 + abilityModifier(c.abilities[resource.effect.save.dcAbility]) + pb
      healing += ` Цели делают спасбросок ${ABILITY_NAMES_GENITIVE[resource.effect.save.ability]} Сл ${dc} — бросай их сам по правилам НПС.`
    }
    if (resource.effect?.tempHp === 'proficiency') healing += ` Временные хиты: ${pb} (учёт временных хитов появится с боевой системой — опиши в рассказе).`
    if (resource.id === 'relentless-endurance') {
      if (c.hp > 0) reject(`«${resource.name}» срабатывает, когда хиты опускаются до 0, а у ${c.name} сейчас ${c.hp}.`)
      const hp = hpEvents(member, 'healing', 1, undefined, ENGINE)
      events.push(...hp.events)
      healing += ` ${c.name} остаётся с 1 хитом.`
    }
    return { events, result: { left: left - 1, max, message: `${member.character.name} применяет «${resource.name}» (осталось ${left - 1}/${max}).${healing}` } }
  },

  change_hp(state, args, ctx) {
    const member = heroOf(state, args)
    const kind = choice<'damage' | 'healing'>(args, 'kind', ['damage', 'healing'], true)!
    const notation = text(args, 'dice')
    const damageType = choice<DamageTypeId>(args, 'damage_type', Object.keys(DAMAGE_TYPE_NAMES) as DamageTypeId[])
    const typeText = damageType ? ` (${DAMAGE_TYPE_NAMES[damageType]})` : ''
    const rolled: ToolEvent[] = []
    let amount: number
    let rollText = ''
    if (notation) {
      // Урон и лечение кубиками — бросает движок (запись — в журнале бросков).
      let r
      try {
        r = roll(notation, { rng: ctx.rng })
      } catch (error) {
        return reject(error instanceof DiceError ? `«dice»: ${error.message}` : '«dice» — запись кубиков, например 1d6+2.')
      }
      amount = Math.max(kind === 'damage' ? 1 : 0, r.total)
      const source = text(args, 'source')
      rolled.push({
        event: { type: 'diceRolled', roll: { id: `roll-${ctx.newId()}`, label: `${member.character.name}: ${kind === 'damage' ? `урон${typeText}` : 'лечение'}${source ? ` — ${source}` : ''}`, timestamp: ctx.now(), result: r } },
        author: ENGINE,
      })
      rollText = ` (бросок ${r.notation}: ${r.total})`
      if (amount < 1) reject(`Бросок ${r.notation} дал 0 — лечения нет.`)
    } else {
      if (kind === 'damage') reject('Урон бросает движок: укажи «dice» (например «1d6» за удар дубинкой). Числом урон не задаётся — ни игроком, ни ведущим.')
      amount = integer(args, 'amount') ?? reject('Нужен «dice» (кубики) или «amount» (хиты лечения).')
      if (amount < 1) reject('«amount» — не меньше 1.')
    }
    const c = member.character
    const { events: hpChange, hp, died, unconscious } = hpEvents(member, kind, amount, damageType, MASTER)
    const events = [...rolled, ...hpChange]
    return {
      events,
      result: {
        amount,
        hp: died ? 0 : hp,
        max_hp: c.maxHp,
        unconscious,
        died,
        message: died
          ? `${c.name} погибает от массивного урона${typeText}.`
          : `${c.name}: ${kind === 'damage' ? `урон ${amount}${typeText}` : `лечение ${amount}`}${rollText}, хиты ${hp}/${c.maxHp}${hp === 0 ? ', без сознания' : ''}.`,
      },
    }
  },

  move_npc(state, args) {
    const location = currentLocationOf(state)
    const npc = findByName(location.npcs, text(args, 'npc', true)!, 'НПС')
    const to = { x: integer(args, 'x', true)!, y: integer(args, 'y', true)! }
    const problem = placementProblem(location, heroesOnMap(state), to, { npcId: npc.id, creature: true })
    if (problem) reject(problem)
    return {
      events: [{ event: { type: 'npcMoved', locationId: location.id, npcId: npc.id, to }, author: MASTER }],
      result: { message: `${npc.name} — теперь в клетке (${to.x}, ${to.y}).` },
    }
  },

  add_npc(state, args, ctx) {
    const location = currentLocationOf(state)
    const name = text(args, 'name', true)!
    const x = integer(args, 'x', true)!
    const y = integer(args, 'y', true)!
    const attitude = choice<NpcAttitude>(args, 'attitude', NPC_ATTITUDES)
    const description = text(args, 'description')
    const personality = personalityArgs(args)
    const tooLong = npcChangesProblem(personality)
    if (tooLong) reject(tooLong)
    const problem = placementProblem(location, heroesOnMap(state), { x, y }, { creature: true })
    if (problem) reject(problem)
    const id = slugId('npc', location.npcs, ctx.newId)
    return {
      events: [
        {
          event: {
            type: 'npcAdded',
            locationId: location.id,
            npc: { id, name, x, y, ...(attitude ? { attitude } : {}), ...(description ? { description } : {}), ...personality },
          },
          author: MASTER,
        },
      ],
      result: { id, message: `${name} появляется в клетке (${x}, ${y}).` },
    }
  },

  update_npc(state, args) {
    const location = currentLocationOf(state)
    const npc = findByName(location.npcs, text(args, 'npc', true)!, 'НПС')
    const changes: NpcChanges = { ...personalityArgs(args, true) }
    const attitude = choice<NpcAttitude>(args, 'attitude', NPC_ATTITUDES)
    if (attitude) changes.attitude = attitude
    if (typeof args.description === 'string') changes.description = args.description
    if (Object.keys(changes).length === 0) reject('Нечего менять: укажи хотя бы одно поле.')
    const problem = npcChangesProblem(changes)
    if (problem) reject(problem)
    return {
      events: [{ event: { type: 'npcUpdated', locationId: location.id, npcId: npc.id, changes }, author: MASTER }],
      result: { message: `${npc.name}: обновлено — ${Object.keys(changes).join(', ')}.` },
    }
  },

  remove_npc(state, args) {
    const location = currentLocationOf(state)
    const npc = findByName(location.npcs, text(args, 'npc', true)!, 'НПС')
    const reason = choice<'left' | 'fled' | 'died'>(args, 'reason', ['left', 'fled', 'died']) ?? 'left'
    if (reason === 'died')
      reject(
        `Гибель существ — только по броскам движка в бою, а боевой системы пока нет. ${npc.name} жив: опиши попытку и её исход ` +
          '(ранен, отступает, сдаётся, бежит) или запроси проверку (request_check). Слова «убиваю одним ударом» — лишь попытка.',
      )
    return {
      events: [{ event: { type: 'npcRemoved', locationId: location.id, npcId: npc.id }, author: MASTER }],
      result: { message: `${npc.name} ${reason === 'fled' ? 'сбегает' : 'уходит'} с карты.` },
    }
  },

  add_condition(state, args) {
    const member = heroOf(state, args)
    const condition = choice<ConditionId>(args, 'condition', CONDITIONS, true)!
    const level = integer(args, 'level')
    const current = member.character.conditions
    let next: ActiveCondition[]
    if (condition === 'exhaustion') {
      const was = current.find((c) => c.id === 'exhaustion')?.level ?? 0
      const target = level ?? was + 1
      if (target < 1 || target > MAX_EXHAUSTION) reject(`Уровень Истощения — от 1 до ${MAX_EXHAUSTION}.`)
      next = [...current.filter((c) => c.id !== 'exhaustion'), { id: 'exhaustion', level: target }]
    } else {
      if (level !== undefined) reject('Уровень бывает только у Истощения.')
      if (current.some((c) => c.id === condition)) reject(`${member.character.name} уже: ${CONDITION_DEFINITIONS[condition].name}.`)
      next = [...current, { id: condition }]
    }
    return {
      events: [{ event: { type: 'conditionsChanged', heroId: member.heroId, conditions: next }, author: MASTER }],
      result: { message: `${member.character.name}: ${CONDITION_DEFINITIONS[condition].name}.`, effect: CONDITION_DEFINITIONS[condition].summary },
    }
  },

  remove_condition(state, args) {
    const member = heroOf(state, args)
    const condition = choice<ConditionId>(args, 'condition', CONDITIONS, true)!
    const current = member.character.conditions
    if (!current.some((c) => c.id === condition)) reject(`На ${member.character.name} нет состояния «${CONDITION_DEFINITIONS[condition].name}».`)
    return {
      events: [
        { event: { type: 'conditionsChanged', heroId: member.heroId, conditions: current.filter((c) => c.id !== condition) }, author: MASTER },
      ],
      result: { message: `С ${member.character.name} снято: ${CONDITION_DEFINITIONS[condition].name}.` },
    }
  },

  note_fact(state, args, ctx) {
    const factText = text(args, 'text', true)!
    const problem = factProblem(factText)
    if (problem) reject(problem)
    if (state.world.facts.some((f) => norm(f.text) === norm(factText))) return { events: [], result: { message: 'Этот факт уже записан.' } }
    // Повтор уже записанного (о том же) — обновляем старую запись, а не плодим похожие.
    const same = sameFact(state.world.facts, factText)
    if (same)
      return {
        events: [{ event: { type: 'factUpdated', factId: same.id, text: factText, at: ctx.now() }, author: MASTER }],
        result: { message: `Факт обновлён (было: «${same.text}»).` },
      }
    return {
      events: [{ event: { type: 'factRecorded', fact: { id: `fact-${ctx.newId()}`, text: factText, at: ctx.now() } }, author: MASTER }],
      result: { message: 'Факт записан в журнал.' },
    }
  },

  add_object(state, args, ctx) {
    const location = currentLocationOf(state)
    const name = text(args, 'name', true)!
    const type = choice<MapObjectType>(args, 'type', OBJECT_TYPES, true)!
    const x = integer(args, 'x', true)!
    const y = integer(args, 'y', true)!
    const w = integer(args, 'w') ?? 1
    const h = integer(args, 'h') ?? 1
    const description = text(args, 'description')
    const kind = location.scale?.kind ?? 'tactical'
    if (!MAP_KIND_OBJECTS[kind].includes(type)) reject(`На этой карте объекты «${type}» не ставятся. Можно: ${MAP_KIND_OBJECTS[kind].join(', ')}.`)
    const problem = placementProblem(location, heroesOnMap(state), { x, y, w, h }, { flat: FLAT_OBJECT_TYPES.includes(type) })
    if (problem) reject(problem)
    const object: MapObject = {
      id: slugId('obj', location.objects, ctx.newId),
      type,
      name,
      x,
      y,
      ...(w > 1 ? { w } : {}),
      ...(h > 1 ? { h } : {}),
      ...(description ? { description } : {}),
    }
    return {
      events: [{ event: { type: 'objectAdded', locationId: location.id, object }, author: MASTER }],
      result: { id: object.id, message: `На карте: ${name} (${x}, ${y}).` },
    }
  },

  remove_object(state, args) {
    const location = currentLocationOf(state)
    const obj = findByName(location.objects, text(args, 'object', true)!, 'Объекта')
    return {
      events: [{ event: { type: 'objectRemoved', locationId: location.id, objectId: obj.id }, author: MASTER }],
      result: { message: `${obj.name} убран(а) с карты.` },
    }
  },

  update_object(state, args) {
    const location = currentLocationOf(state)
    const obj = findByName(location.objects, text(args, 'object', true)!, 'Объекта')
    const changes: Partial<Omit<MapObject, 'id'>> = {}
    const name = text(args, 'name')
    const description = text(args, 'description')
    const type = choice<MapObjectType>(args, 'type', OBJECT_TYPES)
    if (name) changes.name = name
    if (description) changes.description = description
    if (type) changes.type = type
    for (const key of ['x', 'y', 'w', 'h'] as const) {
      const v = integer(args, key)
      if (v !== undefined) changes[key] = v
    }
    if (Object.keys(changes).length === 0) reject('Не указано, что изменить.')
    const next = { ...obj, ...changes }
    const problem = placementProblem(location, heroesOnMap(state), next, { objectId: obj.id, flat: FLAT_OBJECT_TYPES.includes(next.type) })
    if (problem) reject(problem)
    return {
      events: [{ event: { type: 'objectUpdated', locationId: location.id, objectId: obj.id, changes }, author: MASTER }],
      result: { message: `Объект изменён: ${next.name}${next.description ? ` — ${next.description}` : ''}.` },
    }
  },

  set_door(state, args) {
    const location = currentLocationOf(state)
    const door = findByName(location.doors, text(args, 'door', true)!, 'Двери')
    const doorState = choice<DoorState>(args, 'state', DOOR_STATES, true)!
    return {
      events: [{ event: { type: 'doorChanged', locationId: location.id, doorId: door.id, state: doorState }, author: MASTER }],
      result: { message: `${door.name}: ${doorState === 'open' ? 'открыта' : doorState === 'closed' ? 'закрыта' : 'заперта'}.` },
    }
  },

  move_hero(state, args) {
    const member = heroOf(state, args)
    const location = currentLocationOf(state)
    const name = member.character.name
    const targetQuery = text(args, 'target')
    const x = integer(args, 'x')
    const y = integer(args, 'y')
    const reason = text(args, 'reason')
    if (targetQuery && (x !== undefined || y !== undefined)) reject('Укажи либо target (идти к цели), либо x, y с reason (по сюжету), но не оба.')
    if (!targetQuery) {
      if (x === undefined || y === undefined) reject('Укажи target — id объекта, НПС или двери, к которой идёт герой.')
      if (!reason) reject('Координаты — только для перемещения по сюжету («отбросило взрывом»): укажи reason. Для обычной ходьбы — target.')
      return {
        events: [{ event: { type: 'heroMoved', heroId: member.heroId, to: { x: x!, y: y! }, forced: reason! }, author: ENGINE }],
        result: { message: `${name} — в клетке (${x}, ${y}): ${reason}. Скорость не тратится.`, x, y },
      }
    }
    const target = findMapTarget(location, targetQuery!)
    if (typeof target === 'string') return reject(target)
    const route = routeToTarget(location, state, member.heroId, target)
    if ('blocked' in route) return reject(`${route.blocked} ${name} остаётся на месте — обыграй это в рассказе.`)
    if (route.plan.path.length === 0) return { events: [], result: { message: `${name} уже рядом с «${target.name}».`, feet: 0 } }
    const limited = limitBySpeed(state, member.heroId, route.plan, location.cellFeet)
    if (limited.path.length === 0)
      reject(`Идёт бой: скорость ${name} в этом раунде кончилась (осталось ${limited.budget} фт.) — до «${target.name}» ${route.plan.feet} фт. Двигаться можно в следующем раунде.`)
    const to = limited.path.at(-1)!
    const notice = limited.short
      ? `${name}: скорости хватило на ${limited.feet} из ${route.plan.feet} фт. — до «${target.name}» ещё ${limited.short} фт.`
      : undefined
    return {
      events: [{ event: { type: 'heroMoved', heroId: member.heroId, to, ...(notice ? { notice } : {}) }, author: ENGINE }],
      result: {
        message: limited.short
          ? `${notice} Герой остановился в клетке (${to.x}, ${to.y}); игрок это видит. Дойдёт в следующем раунде.`
          : `${name} подходит к «${target.name}»: клетка (${to.x}, ${to.y}), ${limited.feet} фт.`,
        x: to.x,
        y: to.y,
        feet: limited.feet,
        ...(limited.short ? { short_by: limited.short } : {}),
      },
    }
  },

  ping(state, args, ctx) {
    const location = currentLocationOf(state)
    const label = text(args, 'label')
    if (label && label.length > 40) reject('Подпись — до 40 символов.')
    const query = text(args, 'target')
    let area: { x: number; y: number; w: number; h: number }
    let what: string
    if (query) {
      const target = findMapTarget(location, query)
      if (typeof target === 'string') return reject(target)
      if (target.hidden) reject(`«${target.name}» скрыт от игрока — сначала reveal (или не показывай).`)
      area = target.area
      what = `«${target.name}»`
    } else {
      const x = integer(args, 'x')
      const y = integer(args, 'y')
      if (x === undefined || y === undefined) return reject('Укажи target или x и y.')
      area = { x, y, w: 1, h: 1 }
      what = `клетка (${x}, ${y})`
    }
    return {
      events: [{ event: { type: 'mapPinged', ping: { id: `ping-${ctx.newId()}`, locationId: location.id, ...area, ...(label ? { label } : {}) } }, author: MASTER }],
      result: { message: `На карте подсвечено: ${what}.` },
    }
  },

  show_area(state, args, ctx) {
    const location = currentLocationOf(state)
    const label = text(args, 'label')
    if (label && label.length > 40) reject('Подпись — до 40 символов.')
    const shape = choice<AreaShape>(args, 'shape', AREA_SHAPES, true)!
    const size = integer(args, 'size', true)!
    const width = integer(args, 'width')
    const height = integer(args, 'height')
    // Начало и направление: герой, цель карты или клетка.
    const spaceOf = (query: string): { space: CellRect; name: string } => {
      const hero = state.party.find((m) => !m.fallen && (m.heroId === query || norm(m.character.name) === norm(query)))
      if (hero) return { space: { ...hero.position, w: 1, h: 1 }, name: hero.character.name }
      const target = findMapTarget(location, query)
      if (typeof target === 'string') return reject(target)
      if (target.hidden) reject(`«${target.name}» скрыт от игрока — сначала reveal (или не показывай).`)
      return { space: target.area, name: `«${target.name}»` }
    }
    const query = text(args, 'target')
    const x = integer(args, 'x')
    const y = integer(args, 'y')
    let from: { space: CellRect; name: string }
    if (query) from = spaceOf(query)
    else if (x !== undefined || y !== undefined) {
      if (x === undefined || y === undefined) return reject('Укажи и x, и y (или target).')
      from = { space: { x, y, w: 1, h: 1 }, name: `клетка (${x}, ${y})` }
    } else {
      const hero = heroOf(state, {})
      from = { space: { ...hero.position, w: 1, h: 1 }, name: hero.character.name }
    }
    const center = { x: from.space.x + from.space.w / 2, y: from.space.y + from.space.h / 2 }
    let direction: number | undefined
    const toward = text(args, 'toward')
    const compass = choice(args, 'direction', Object.keys(COMPASS))
    if (toward) {
      const to = spaceOf(toward).space
      const toCenter = { x: to.x + to.w / 2, y: to.y + to.h / 2 }
      if (toCenter.x === center.x && toCenter.y === center.y) reject('Цель направления совпадает с началом.')
      direction = directionBetween(center, toCenter)
    } else if (compass) direction = COMPASS[compass]
    if (DIRECTED_SHAPES.includes(shape) && direction === undefined) reject(`У фигуры «${AREA_SHAPE_NAMES[shape]}» нужно направление: toward или direction.`)
    const template: AreaTemplate = {
      shape,
      size,
      origin: DIRECTED_SHAPES.includes(shape) ? edgeOrigin(from.space, direction!, shape) : center,
      ...(DIRECTED_SHAPES.includes(shape) ? { direction: Math.round(direction! * 100) / 100 } : {}),
      ...(shape === 'emanation' ? { space: from.space } : {}),
      ...(shape === 'line' && width ? { width } : {}),
      ...(shape === 'cylinder' && height ? { height } : {}),
    }
    const problem = areaTemplateProblem(template, location)
    if (problem) reject(problem)
    const result = mapAreaResult(location, state.party, template, state.world.doors[location.id] ?? {})
    return {
      events: [{ event: { type: 'areaShown', area: { id: `area-${ctx.newId()}`, locationId: location.id, template, ...(label ? { label } : {}) } }, author: MASTER }],
      result: {
        message: `На карте показана область от ${from.name}. ${areaResultText(template, result)}`,
        cells: result.cells.length,
        creatures: result.creatures.map((c) => (c.hidden ? `${c.name} (скрыт от игрока)` : c.name)),
      },
    }
  },

  add_effect(state, args, ctx) {
    const location = currentLocationOf(state)
    const kind = choice<EffectKind>(args, 'kind', EFFECT_KINDS, true)!
    const x = integer(args, 'x', true)!
    const y = integer(args, 'y', true)!
    const w = integer(args, 'w') ?? 1
    const h = integer(args, 'h') ?? 1
    const name = text(args, 'name')
    if (w < 1 || h < 1 || x < 0 || y < 0 || x + w > location.width || y + h > location.height) reject(`Область выходит за карту ${location.width}×${location.height}.`)
    const effect: MapEffect = { id: slugId('fx', location.effects ?? [], ctx.newId), kind, ...(name ? { name } : {}), x, y, w, h }
    return {
      events: [{ event: { type: 'effectAdded', locationId: location.id, effect }, author: MASTER }],
      result: { id: effect.id, message: `На карте: ${name ?? EFFECT_KIND_NAMES[kind]} (${x}, ${y}, ${w}×${h}).` },
    }
  },

  remove_effect(state, args) {
    const location = currentLocationOf(state)
    const list = (location.effects ?? []).map((e) => ({ ...e, name: e.name ?? EFFECT_KIND_NAMES[e.kind] }))
    const effect = findByName(list, text(args, 'effect', true)!, 'Эффекта')
    return {
      events: [{ event: { type: 'effectRemoved', locationId: location.id, effectId: effect.id }, author: MASTER }],
      result: { message: `${effect.name} — убрано с карты.` },
    }
  },

  reveal(state, args) {
    const location = currentLocationOf(state)
    const hidden = [
      ...location.npcs.filter((n) => n.hidden).map((n) => ({ id: n.id, name: n.name, kind: 'npc' as const })),
      ...location.objects.filter((o) => o.hidden).map((o) => ({ id: o.id, name: o.name, kind: 'object' as const })),
    ]
    const query = text(args, 'target', true)!
    if (!hidden.length) reject('Скрытых НПС и объектов здесь нет — всё и так на виду.')
    const target = findByName(hidden, query, 'Скрытого')
    return {
      events: [{ event: { type: 'entityRevealed', locationId: location.id, kind: target.kind, entityId: target.id }, author: MASTER }],
      result: { message: `«${target.name}» теперь виден на карте.` },
    }
  },

  create_location(state, args) {
    let input = args.location
    // Модели иногда присылают JSON строкой — принимаем и так.
    if (typeof input === 'string') {
      try {
        input = JSON.parse(input)
      } catch {
        reject('location — JSON-объект локации (строка не разобралась как JSON).')
      }
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) reject('location — JSON-объект локации.')
    const id = (input as Args).id
    if (typeof id === 'string' && state.world.locations[id])
      reject(`Локация «${id}» уже есть в мире этой истории («${state.world.locations[id].name}») — не создавай заново; новой нужен другой id.`)
    const parsed = parseCreatedLocation(input)
    if (!parsed.ok) reject(`Локация не создана, исправь и вызови снова:\n- ${parsed.problems.join('\n- ')}`)
    const location = (parsed as { location: LocationData }).location
    const exits = (location.exits ?? []).map((e) => `${e.name} [${e.id}] (${e.x}, ${e.y})${e.to ? ` → ${e.to}` : ''}`)
    return {
      events: [{ event: { type: 'locationCreated', location }, author: MASTER }],
      result: {
        id: location.id,
        message: `Локация «${location.name}» создана: ${location.width}×${location.height} клеток, выходы: ${exits.join('; ')}. Она сохранена в мире истории — второй раз не создавай.`,
      },
    }
  },

  set_combat(state, args, ctx) {
    const what = choice<'start' | 'next_round' | 'end'>(args, 'state', ['start', 'next_round', 'end'], true)!
    if (what === 'end') {
      if (!state.combat) reject('Боя и так нет.')
      return { events: [{ event: { type: 'combatChanged', combat: null }, author: MASTER }], result: { message: 'Бой окончен: ходить можно без ограничений.' } }
    }
    if (what === 'next_round' && !state.combat) reject('Боя нет — начни его: state: start.')
    if (what === 'start' && state.combat) reject(`Бой уже идёт (раунд ${state.combat.round}).`)
    const speed = Object.fromEntries(
      state.party.filter((m) => !m.fallen).map((m) => [m.heroId, ctx.rules?.species?.[m.character.speciesId]?.speed ?? DEFAULT_SPEED]),
    )
    const round = what === 'start' ? 1 : state.combat!.round + 1
    return {
      events: [{ event: { type: 'combatChanged', combat: { round, speed, moved: {} } }, author: MASTER }],
      result: { message: `Раунд ${round}. Скорость: ${state.party.filter((m) => !m.fallen).map((m) => `${m.character.name} ${speed[m.heroId]} фт.`).join(', ')}.` },
    }
  },
}

/**
 * Исполнить вызов инструмента: проверить аргументы и состояние, получить действия и прогнать их через checkAction
 * на копии истории. Отказ — `ok: false` и причина для модели; история при этом не меняется.
 */
export function executeTool(state: StoryState, call: AiToolCall, ctx: ToolContext): ToolOutcome {
  const fail = (error: string): ToolOutcome => ({ ok: false, result: { ok: false, error }, events: [] })
  const handler = HANDLERS[call.name]
  if (!handler) return fail(`Инструмента «${call.name}» нет. Есть: ${Object.keys(HANDLERS).join(', ')}.`)
  if (call.argumentsError || !call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments))
    return fail('Аргументы — некорректный JSON-объект.')
  if (state.status === 'completed') return fail('История завершена — в ней больше ничего не происходит.')
  // Вопрос вне игры — не ход: ни один инструмент (даже бросок или время) не меняет игру.
  if (state.outOfGame) return fail(OUT_OF_GAME_REFUSAL)
  try {
    const { events, result } = handler(state, call.arguments as Args, ctx)
    // Последняя линия обороны — те же правила, что для любых действий истории.
    let probe = state
    for (const [i, { event, author }] of events.entries()) {
      const action = makeAction(state.id, i, event, author, ctx.now(), `probe-${i}`)
      const reason = checkAction(probe, action, { catalog: ctx.catalog, rules: ctx.rules })
      if (reason) return fail(reason)
      probe = applyAction(probe, action)
    }
    return { ok: true, result: { ok: true, ...result }, events }
  } catch (error) {
    if (error instanceof ToolRejected) return fail(error.message)
    throw error
  }
}
