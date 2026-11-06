// «Проверить подключение»: три проверки по очереди — ключ принят; модель отвечает со стримингом;
// модель вызывает инструменты, в том числе несколько в одном ответе. Для каждой — что это значит для игры.
import { AiError } from './errors.ts'
import type { AiMaster, AiResponse, AiTool } from './types.ts'

export type CheckId = 'key' | 'stream' | 'tools'
export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skipped'

export interface CheckResult {
  id: CheckId
  title: string
  status: CheckStatus
  /** Что произошло и что это значит для игры. */
  detail: string
}

export const CHECK_TITLES: Record<CheckId, string> = {
  key: 'Ключ принят',
  stream: 'Модель отвечает со стримингом',
  tools: 'Модель вызывает инструменты (несколько в одном ответе)',
}

/** Два простых инструмента для проверки. */
export const CHECK_TOOLS: AiTool[] = [
  {
    name: 'add_numbers',
    description: 'Складывает два числа.',
    parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
  },
  {
    name: 'get_time_of_day',
    description: 'Сообщает время суток в указанном месте.',
    parameters: { type: 'object', properties: { place: { type: 'string' } }, required: ['place'] },
  },
]

const skipped = (id: CheckId): CheckResult => ({
  id,
  title: CHECK_TITLES[id],
  status: 'skipped',
  detail: 'Не проверялось: предыдущая проверка не прошла.',
})

/** Для игры: чем грозит ошибка подключения. */
function explain(error: unknown): string {
  if (!(error instanceof AiError)) return 'Неизвестная ошибка. Ведущий не сможет отвечать.'
  const consequence: Partial<Record<AiError['kind'], string>> = {
    auth: 'Без принятого ключа ведущий не сможет отвечать.',
    billing: 'Пока баланс не пополнен, ведущий не сможет отвечать.',
    'rate-limit': 'Ведущий будет отвечать с задержками; попробуйте проверить позже.',
    network: 'Ведущий не сможет отвечать, пока адрес недоступен.',
    'model-not-found': 'Ведущий не сможет отвечать, пока не указана существующая модель.',
    'not-found': 'Ведущий не сможет отвечать, пока адрес не исправлен.',
  }
  const where = error.stage ? ` Где споткнулась: ${error.stage}.` : ''
  return `${error.message} ${consequence[error.kind] ?? 'Ведущий не сможет отвечать.'}${where}`
}

/** Как пришёл ответ — для объяснения, если что-то не так. */
const how = (r: AiResponse) =>
  `Получено: ${r.stats.format === 'stream' ? `поток, событий ${r.stats.events}` : 'обычный JSON (не поток)'}` +
  `${r.stats.skipped ? `, пропущено непонятных строк ${r.stats.skipped}` : ''}, тип содержимого «${r.stats.contentType || 'не указан'}»,` +
  ` текста ${r.text.length} симв., «размышлений» ${r.reasoning.length} симв., причина окончания — ${r.finishReason}.`

export async function runConnectionCheck(
  master: AiMaster,
  onProgress?: (results: CheckResult[]) => void,
  signal?: AbortSignal,
): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  const push = (r: CheckResult) => {
    results.push(r)
    onProgress?.([...results])
  }

  // 1. Ключ: самый короткий запрос без стриминга.
  try {
    await master.complete({ messages: [{ role: 'user', content: 'Ответь одним словом: да.' }], maxTokens: 5, stream: false, signal })
    push({ id: 'key', title: CHECK_TITLES.key, status: 'ok', detail: 'Поставщик принял ключ и ответил.' })
  } catch (error) {
    // Отменено игроком — проверка прекращается целиком.
    if (signal?.aborted) throw error
    push({ id: 'key', title: CHECK_TITLES.key, status: 'fail', detail: explain(error) })
    push(skipped('stream'))
    push(skipped('tools'))
    return results
  }

  // 2. Стриминг: текст приходит частями. Лимит с запасом — рассуждающие модели сначала «думают».
  try {
    let parts = 0
    const response = await master.complete({
      messages: [{ role: 'user', content: 'Посчитай по-русски словами от одного до десяти через запятую.' }],
      maxTokens: 1000,
      onText: () => void parts++,
      signal,
    })
    const text = response.text.trim()
    if (parts > 1 && text)
      push({
        id: 'stream',
        title: CHECK_TITLES.stream,
        status: 'ok',
        detail: `Ответ пришёл частями (${parts}) — текст ведущего будет появляться по ходу.`,
      })
    else if (text)
      push({
        id: 'stream',
        title: CHECK_TITLES.stream,
        status: 'warn',
        detail: `Модель отвечает, но не потоком: текст ведущего будет появляться целиком, после паузы. ${how(response)}`,
      })
    else if (response.reasoning)
      push({
        id: 'stream',
        title: CHECK_TITLES.stream,
        status: 'warn',
        detail:
          `Модель рассуждающая: прислала только «размышления», а ответ не успел начаться${response.finishReason === 'length' ? ' — кончился лимит длины' : ''}. ` +
          `Ведущий будет отвечать медленнее и дороже; для игры лучше нерассуждающая модель. ${how(response)}`,
      })
    else
      push({
        id: 'stream',
        title: CHECK_TITLES.stream,
        status: 'fail',
        detail: `Модель прислала пустой ответ — ведущий будет молчать. Нажмите «Диагностика» и пришлите результат. ${how(response)}`,
      })
  } catch (error) {
    // Отменено игроком — проверка прекращается целиком.
    if (signal?.aborted) throw error
    push({ id: 'stream', title: CHECK_TITLES.stream, status: 'fail', detail: explain(error) })
  }

  // 3. Инструменты: просим вызвать оба в одном ответе.
  try {
    const response = await master.complete({
      messages: [
        {
          role: 'user',
          content: 'Вызови в одном ответе оба инструмента: add_numbers с a=2 и b=3, и get_time_of_day для места «Таверна». Текст не пиши.',
        },
      ],
      tools: CHECK_TOOLS,
      toolChoice: 'required',
      maxTokens: 1000,
      signal,
    })
    const names = new Set(response.toolCalls.map((c) => c.name))
    const broken = response.toolCalls.some((c) => c.argumentsError)
    if (names.has('add_numbers') && names.has('get_time_of_day') && !broken)
      push({
        id: 'tools',
        title: CHECK_TITLES.tools,
        status: 'ok',
        detail: 'Оба инструмента вызваны в одном ответе — ведущий сможет запрашивать проверки и броски за один ход.',
      })
    else if (response.toolCalls.length > 0)
      push({
        id: 'tools',
        title: CHECK_TITLES.tools,
        status: 'warn',
        detail: broken
          ? 'Модель вызывает инструменты, но иногда с неверными аргументами — код игры отклонит такие запросы, и ведущему придётся повторять.'
          : 'Модель вызывает инструменты только по одному — игра будет работать, но медленнее (больше запросов на ход).',
      })
    else
      push({
        id: 'tools',
        title: CHECK_TITLES.tools,
        status: 'fail',
        detail: `Модель не вызывает инструменты — ведущий не сможет запрашивать проверки, броски и изменения в игре. Выберите другую модель. ${how(response)}`,
      })
  } catch (error) {
    // Отменено игроком — проверка прекращается целиком.
    if (signal?.aborted) throw error
    push({ id: 'tools', title: CHECK_TITLES.tools, status: 'fail', detail: explain(error) })
  }
  return results
}
