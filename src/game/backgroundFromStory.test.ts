// «По моей истории»: предложение предыстории ИИ (ответ ИИ подменён) — корректное, нарушающее шаблон, пустое.
import { describe, expect, it } from 'vitest'
import { AiError } from '../ai/errors'
import { aiResponse, fakeMaster } from '../ai/testing'
import type { AiRequest } from '../ai/types'
import { itemCatalog, rulesData } from '../data'
import fighterJson from '../data/characters/fighter-ratibor.json'
import {
  BACKGROUND_PROMPT,
  backgroundShopItems,
  backstoryProblem,
  choicesText,
  partialName,
  MAX_PROPOSAL_ATTEMPTS,
  parseProposal,
  PROPOSE_TOOL,
  proposeTool,
  suggestBackground,
} from './backgroundFromStory'
import { parseCharacterSheet } from './character'
import { applyBackgroundProposal, backgroundOf, chooseCustomBackground, decideProposalDetail, emptyDraft } from './creation'
import { heroPastText } from './masterState'
import { validateBackgroundTemplate } from './backgroundTemplate'

const BACKSTORY = 'Бывший моряк, сбежал с корабля после бунта, ищет брата.'

const VALID = {
  name: 'Беглый матрос',
  description: 'Ходил на торговом когге, после бунта бежал на берег.',
  abilities: ['str', 'dex', 'con'],
  skills: ['athletics', 'perception'],
  tool: 'navigators-tools',
  feat: 'savage-attacker',
  equipment: [
    { item: 'spear', quantity: 1 },
    { item: 'crowbar', quantity: 1 },
    { item: 'backpack', quantity: 1 },
  ],
  explanations: {
    name: 'Моряк, сбежавший после бунта.',
    abilities: 'Сила и выносливость — годы на вантах, Ловкость — качка.',
    skills: 'Атлетика — паруса и такелаж; Внимательность — вахта на марсе.',
    tool: 'Навигационные инструменты — вёл корабль по звёздам.',
    feat: 'Дикий атакующий — бунт научил драться грязно.',
    equipment: 'Копьё, ломик и рюкзак — всё, что унёс с корабля.',
  },
  extra_details: ['Родом из портового Вельгарда.', 'Брат служил юнгой на том же корабле.'],
}

const toolCall = (args: unknown, id = 'c1') => ({ id, name: PROPOSE_TOOL, arguments: args, rawArguments: JSON.stringify(args) })
const proposing = (args: unknown) => () => aiResponse({ toolCalls: [toolCall(args)], finishReason: 'tool_calls' })

describe('История героя → предыстория (ИИ)', () => {
  it('корректный ответ: предложение по шаблону, объяснения, дописанные детали отдельно', async () => {
    const { master, requests } = fakeMaster([proposing(VALID)])
    const proposal = await suggestBackground(master, BACKSTORY, rulesData)
    expect(proposal.input).toMatchObject({ name: 'Беглый матрос', abilities: ['str', 'dex', 'con'], skills: ['athletics', 'perception'], tool: 'navigators-tools', feat: 'savage-attacker' })
    expect(proposal.input.items).toEqual([
      { itemId: 'spear', quantity: 1 },
      { itemId: 'crowbar', quantity: 1 },
      { itemId: 'backpack', quantity: 1 },
    ])
    expect(proposal.explanations.skills).toBe('Атлетика — паруса и такелаж; Внимательность — вахта на марсе.')
    expect(proposal.details).toEqual([
      { text: 'Родом из портового Вельгарда.', status: 'pending' },
      { text: 'Брат служил юнгой на том же корабле.', status: 'pending' },
    ])
    // Запрос: инструмент с JSON-схемой и обязательным вызовом, промт, справочник и слова игрока.
    const req = requests[0] as AiRequest
    expect(req.tools?.map((t) => t.name)).toEqual([PROPOSE_TOOL])
    expect(req.toolChoice).toEqual({ name: PROPOSE_TOOL })
    expect(req.messages[0].content).toContain(BACKGROUND_PROMPT)
    expect(req.messages[0].content).toContain('navigators-tools — ')
    expect(req.messages[0].content).toContain('savage-attacker — ')
    expect(req.messages[1].content).toContain(BACKSTORY)
  })

  it('нарушение шаблона: модель получает ошибки той же функции шаблона и исправляет', async () => {
    const broken = {
      ...VALID,
      abilities: ['str', 'str'],
      feat: 'archery',
      equipment: [{ item: 'navigators-tools', quantity: 3 }],
      explanations: { ...VALID.explanations, feat: '' },
    }
    const { master, requests } = fakeMaster([proposing(broken), proposing(VALID)])
    const proposal = await suggestBackground(master, BACKSTORY, rulesData)
    expect(proposal.input.name).toBe('Беглый матрос')
    const fix = requests[1].messages
    expect(fix.at(-2)).toMatchObject({ role: 'assistant', toolCalls: [{ name: PROPOSE_TOOL }] })
    const result = JSON.parse(fix.at(-1)!.content as string) as { ok: boolean; errors: string[] }
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('Выберите 3 разные характеристики для прибавок (выбрано 2)')
    expect(result.errors).toContain(`«${rulesData.feats.archery.name}» — не черта происхождения`)
    expect(result.errors).toContain('Снаряжение стоит 75 зм — больше 50 зм')
    expect(result.errors).toContain('Нет объяснения: Черта.')
  })

  it('не исправила за отведённые попытки — понятная ошибка с нарушенными правилами', async () => {
    const tooRich = { ...VALID, equipment: [{ item: 'navigators-tools', quantity: 3 }] }
    const { master, requests } = fakeMaster(Array.from({ length: MAX_PROPOSAL_ATTEMPTS }, () => proposing(tooRich)))
    const error = await suggestBackground(master, BACKSTORY, rulesData).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AiError)
    expect((error as AiError).message).toBe(
      'ИИ не смог предложить предысторию по шаблону: Снаряжение стоит 75 зм — больше 50 зм Попробуйте ещё раз или заполните вручную.',
    )
    expect(requests).toHaveLength(MAX_PROPOSAL_ATTEMPTS)
  })

  it('пустой ответ модели (ни вызова, ни текста) — просьба вызвать инструмент, затем корректный', async () => {
    const { master, requests } = fakeMaster([() => aiResponse({ text: '' }), proposing(VALID)])
    expect((await suggestBackground(master, BACKSTORY, rulesData)).input.name).toBe('Беглый матрос')
    expect(requests[1].messages.at(-1)).toEqual({ role: 'user', content: `Код игры не принял ответ: Ответь вызовом инструмента ${PROPOSE_TOOL}.` })
  })

  it('сервис не умеет вызывать инструменты — JSON в тексте тоже принимается', async () => {
    const { master } = fakeMaster([() => aiResponse({ text: `Вот предложение:\n${JSON.stringify(VALID)}` })])
    expect((await suggestBackground(master, BACKSTORY, rulesData)).input.feat).toBe('savage-attacker')
  })

  it('пустая или слишком короткая история — без запроса к ИИ', async () => {
    const { master, requests } = fakeMaster([])
    await expect(suggestBackground(master, '   ', rulesData)).rejects.toThrow('Напишите «Историю героя» — по ней ИИ подберёт предысторию.')
    await expect(suggestBackground(master, 'Моряк.', rulesData)).rejects.toThrow('История слишком короткая')
    expect(requests).toHaveLength(0)
    expect(backstoryProblem(BACKSTORY)).toBeNull()
  })

  it('«Предложить иначе» — прошлое предложение уходит модели с просьбой выбрать другое', async () => {
    const first = await suggestBackground(fakeMaster([proposing(VALID)]).master, BACKSTORY, rulesData)
    const { master, requests } = fakeMaster([proposing({ ...VALID, name: 'Корабельный навигатор' })])
    const second = await suggestBackground(master, BACKSTORY, rulesData, { previous: first })
    expect(second.input.name).toBe('Корабельный навигатор')
    expect(requests[0].messages[1].content).toContain('## Прошлое предложение (игрок просит предложить иначе — выбери заметно другое)')
    expect(requests[0].messages[1].content).toContain('"name":"Беглый матрос"')
  })

  it('этапы для индикатора: отправка → чтение (пошли куски) → проверка → исправление (попытка 2 из 3) → проверка', async () => {
    const broken = { ...VALID, abilities: ['str'] }
    const stages: string[] = []
    const previews: (string | null)[] = []
    const { master } = fakeMaster([
      (req) => {
        req.onProgress?.({ events: 1, textChars: 0, reasoningChars: 0, toolChars: 20, toolArgs: '{"name":"Беглый ма' })
        return proposing(broken)()
      },
      proposing(VALID),
    ])
    await suggestBackground(master, BACKSTORY, rulesData, {
      onStage: (stage, attempt) => stages.push(`${stage}:${attempt}`),
      onProgress: (p) => previews.push(partialName(p.toolArgs)),
    })
    expect(stages).toEqual(['sending:1', 'reading:1', 'checking:1', 'fixing:2', 'checking:2'])
    expect(previews).toEqual(['Беглый ма'])
  })

  it('запрос сокращён: в справочнике только то, что влезает в 50 зм, без доспехов; в схеме нет списка всех предметов', () => {
    const text = choicesText(rulesData)
    expect(text).not.toContain('plate-armor')
    expect(text).not.toContain('chain-mail')
    expect(text).toContain('rope — ')
    expect(backgroundShopItems(rulesData).every((i) => i.cost! <= 50 && i.category !== 'armor')).toBe(true)
    const schema = proposeTool(rulesData).parameters as { properties: { equipment: { items: { properties: { item: { enum?: unknown } } } } } }
    expect(schema.properties.equipment.items.properties.item.enum).toBeUndefined()
  })

  it('дописанных деталей не больше трёх; схема инструмента — только варианты из данных игры', () => {
    const many = { ...VALID, extra_details: ['а', 'б', 'в', 'г'] }
    expect(parseProposal(many, rulesData)).toEqual({ problems: ['Дописанных деталей — не больше 3.'] })
    const schema = proposeTool(rulesData).parameters as { properties: Record<string, { enum?: string[]; items?: { enum?: string[] } }> }
    expect(schema.properties.feat.enum).toEqual(['alert', 'magic-initiate', 'savage-attacker', 'skilled'])
    expect(schema.properties.abilities.items?.enum).toEqual(['str', 'dex', 'con', 'int', 'wis', 'cha'])
    expect(schema.properties.tool.enum).toContain('navigators-tools')
  })
})

describe('история героя в черновике, листе и контексте ведущего', () => {
  it('предложение заполняет свою предысторию (её можно править), детали дописываются только по решению игрока', async () => {
    const proposal = await suggestBackground(fakeMaster([proposing(VALID)]).master, BACKSTORY, rulesData)
    let draft = { ...emptyDraft(), backstory: BACKSTORY }
    draft = applyBackgroundProposal(draft, proposal, rulesData)
    expect(draft.backgroundSource).toBe('story')
    const background = backgroundOf(draft, rulesData)!
    expect(validateBackgroundTemplate(background, { feats: rulesData.feats, catalog: itemCatalog })).toEqual([])
    draft = decideProposalDetail(draft, 0, true)
    draft = decideProposalDetail(draft, 1, false)
    expect(draft.backstory).toBe(`${BACKSTORY} Родом из портового Вельгарда.`)
    expect(draft.backgroundProposal!.details.map((d) => d.status)).toEqual(['accepted', 'rejected'])
    // Повторное решение ничего не меняет.
    expect(decideProposalDetail(draft, 0, true)).toBe(draft)
    // Ручной режим не теряет историю.
    expect(chooseCustomBackground(draft, 'manual', rulesData).backstory).toBe(draft.backstory)
  })

  it('лист персонажа хранит историю; ведущий видит её и летопись', () => {
    const sheet = parseCharacterSheet(fighterJson, itemCatalog)
    const withPast = {
      ...sheet.character,
      backstory: BACKSTORY,
      chronicle: [
        { storyId: 's0', storyTitle: 'Тень над трактом', endedAt: 1, summary: 'Разоблачил вора Тобиаса.', outcome: 'Гильдия затаила злобу.', startLevel: 1, endLevel: 2, finds: [], fate: 'survived' as const },
      ],
    }
    expect(parseCharacterSheet({ ...sheet, character: withPast }, itemCatalog).character.backstory).toBe(BACKSTORY)
    expect(() => parseCharacterSheet({ ...sheet, character: { ...withPast, backstory: 'х'.repeat(2001) } }, itemCatalog)).toThrow('character.backstory')
    const text = heroPastText(withPast).join('\n')
    expect(text).toContain(`История героя (словами игрока; источник зацепок для сюжета): ${BACKSTORY}`)
    expect(text).toContain('- «Тень над трактом» (ур. 1→2): Разоблачил вора Тобиаса. Гильдия затаила злобу.')
    expect(heroPastText(sheet.character)).toEqual([])
  })

})
