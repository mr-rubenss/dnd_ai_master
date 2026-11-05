import { describe, expect, it } from 'vitest'
import { runConnectionCheck } from './check'
import { AiError } from './errors'
import { aiResponse, fakeMaster } from './testing'
import type { AiRequest } from './types'

const reply = aiResponse
const call = (name: string, args: unknown = {}, error?: string) => ({ id: name, name, arguments: args, rawArguments: JSON.stringify(args), ...(error ? { argumentsError: error } : {}) })

const streamed = (req: AiRequest) => {
  for (const p of ['Один, ', 'два, ', 'три.']) req.onText?.(p)
  return reply({ text: 'Один, два, три.', streamed: true })
}

describe('проверка подключения', () => {
  it('всё работает: ключ, стриминг, два инструмента в одном ответе', async () => {
    const progress: number[] = []
    const { master, requests } = fakeMaster([
      () => reply({ text: 'да' }),
      streamed,
      () => reply({ toolCalls: [call('add_numbers', { a: 2, b: 3 }), call('get_time_of_day', { place: 'Таверна' })], finishReason: 'tool_calls' }),
    ])
    const results = await runConnectionCheck(master, (r) => progress.push(r.length))
    expect(results.map((r) => [r.id, r.status])).toEqual([
      ['key', 'ok'],
      ['stream', 'ok'],
      ['tools', 'ok'],
    ])
    expect(progress).toEqual([1, 2, 3])
    expect(requests[0].stream).toBe(false)
    expect(requests[1].stream).not.toBe(false)
    expect(requests[2].tools?.map((t) => t.name)).toEqual(['add_numbers', 'get_time_of_day'])
    expect(requests[2].toolChoice).toBe('required')
  })

  it('ключ не принят — объяснение для игры, остальное не проверяется', async () => {
    const { master, requests } = fakeMaster([
      () => {
        throw new AiError('auth', { status: 401 })
      },
    ])
    const results = await runConnectionCheck(master)
    expect(results.map((r) => r.status)).toEqual(['fail', 'skipped', 'skipped'])
    expect(results[0].detail).toBe('Ключ API не принят. Проверьте ключ в «Настройки» → «Ведущий». Без принятого ключа ведущий не сможет отвечать. Где споткнулась: ответ сервера HTTP 401.')
    expect(requests).toHaveLength(1)
  })

  it('без стриминга — частично; инструменты по одному — частично', async () => {
    const { master } = fakeMaster([
      () => reply({ text: 'да' }),
      () => reply({ text: 'Один, два.' }),
      () => reply({ toolCalls: [call('add_numbers', { a: 2, b: 3 })] }),
    ])
    const [, stream, tools] = await runConnectionCheck(master)
    expect(stream.status).toBe('warn')
    expect(stream.detail).toContain('будет появляться целиком')
    expect(tools.status).toBe('warn')
    expect(tools.detail).toContain('только по одному')
  })

  it('инструменты не вызываются — объяснение, что ведущий не сможет запрашивать проверки', async () => {
    const { master } = fakeMaster([() => reply({ text: 'да' }), streamed, () => reply({ text: 'Сумма 5, сейчас вечер.' })])
    const results = await runConnectionCheck(master)
    expect(results[2]).toMatchObject({ status: 'fail' })
    expect(results[2].detail).toContain('не сможет запрашивать проверки, броски')
  })

  it('кривые аргументы инструментов — частично; ошибка на шаге — провал этого шага', async () => {
    const { master } = fakeMaster([
      () => reply({ text: 'да' }),
      () => {
        throw new AiError('model-not-found')
      },
      () => reply({ toolCalls: [call('add_numbers', null, 'Аргументы инструмента — некорректный JSON.'), call('get_time_of_day')] }),
    ])
    const [, stream, tools] = await runConnectionCheck(master)
    expect(stream.status).toBe('fail')
    expect(stream.detail).toContain('Модель не найдена')
    expect(tools.status).toBe('warn')
    expect(tools.detail).toContain('неверными аргументами')
  })
})
