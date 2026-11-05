import { describe, expect, it } from 'vitest'
import { aiResponse, fakeMaster } from '../ai/testing'
import type { AiRequest } from '../ai/types'
import adventureJson from '../data/adventures/drunken-griffin.json'
import fighterJson from '../data/characters/fighter-ratibor.json'
import itemsJson from '../data/items.json'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import { parseAdventure } from './adventure'
import { parseCharacterSheet } from './character'
import { parseItemCatalog } from './items'
import { parseLocation } from './location'
import { masterMessages, masterSystemPrompt } from './masterPrompt'
import { runMasterTurn } from './masterTurn'
import { applyAction, makeAction, MASTER, newStorySeed, player } from './storyActions'

const catalog = parseItemCatalog(itemsJson)
const location = parseLocation(drunkenGriffinJson)
const locations = { [location.id]: location }
const adventure = parseAdventure(adventureJson, locations)
const ratibor = parseCharacterSheet(fighterJson, catalog)

function story() {
  let state = newStorySeed({ id: 's1', title: 'Тень над трактом', tone: 'detective', adventure, locations, party: [ratibor], now: 1 })
  const events = [
    [{ type: 'masterNarrated', messageId: 'm1', text: 'Таверна шумит.' }, MASTER],
    [{ type: 'playerSpoke', heroId: 'ratibor', messageId: 'p1', text: 'Подхожу к стойке.' }, player('ratibor')],
  ] as const
  events.forEach(([event, author], i) => (state = applyAction(state, makeAction('s1', i + 1, event, author, 2 + i, `a${i}`))))
  return state
}

describe('запрос к ведущему по истории', () => {
  it('системный промт: роль, правила (кубики — код), история, тон, место, НПС, отряд, длина', () => {
    const prompt = masterSystemPrompt(story(), 'short')
    expect(prompt).toContain('Ты — ведущий')
    expect(prompt).toContain('только на русском')
    expect(prompt).toContain('не придумывай результаты бросков')
    expect(prompt).toContain('История: «Тень над трактом». Тон: Детектив.')
    expect(prompt).toContain('Место: Таверна «Пьяный грифон».')
    expect(prompt).toMatch(/- Гуннар/)
    expect(prompt).toContain('- Ратибор:')
    expect(prompt).toContain('Отвечай коротко')
  })

  it('лента: ведущий — assistant, игрок — user, после системного промта', () => {
    const messages = masterMessages(story(), 'normal')
    expect(messages[0].role).toBe('system')
    expect(messages.slice(-2)).toEqual([
      { role: 'assistant', content: 'Таверна шумит.' },
      { role: 'user', content: 'Подхожу к стойке.' },
    ])
  })
})

describe('ход ведущего', () => {
  it('через общий интерфейс: поток текста, лимит по длине ответа, итоговый текст', async () => {
    const requests: AiRequest[] = []
    const parts: string[] = []
    const { master } = fakeMaster([
      (req) => {
        requests.push(req)
        req.onText?.('Гуннар ')
        req.onText?.('кивает.')
        return aiResponse({ text: ' Гуннар кивает. ', streamed: true })
      },
    ])
    const result = await runMasterTurn(master, story(), { verbosity: 'detailed', onText: (d) => parts.push(d) })
    expect(result).toEqual({ text: 'Гуннар кивает.', truncated: false })
    expect(parts).toEqual(['Гуннар ', 'кивает.'])
    expect(requests[0].maxTokens).toBe(1600)
    expect(requests[0].tools).toBeUndefined()
  })

  it('пустой ответ — понятная ошибка', async () => {
    const { master } = fakeMaster([() => aiResponse({ text: '  ' })])
    await expect(runMasterTurn(master, story(), { verbosity: 'normal' })).rejects.toThrow('Ведущий прислал пустой ответ')
  })

  it('рассуждающая модель не успела ответить — объяснение, что делать', async () => {
    const { master } = fakeMaster([() => aiResponse({ reasoning: 'Игрок подходит к стойке, значит…', finishReason: 'length' })])
    await expect(runMasterTurn(master, story(), { verbosity: 'normal' })).rejects.toThrow('модель «размышляла»')
  })
})
