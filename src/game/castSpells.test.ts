// Каст заклинаний героя: мягкое сопоставление названий, список заклинаний в запросе ведущему (и при обрезке
// контекста), сверка «игрок колдует — cast_spell не вызван», ходы с подменённым ответом ИИ.
import { describe, expect, it } from 'vitest'
import { aiResponse, fakeMaster } from '../ai/testing'
import type { AiRequest } from '../ai/types'
import { itemCatalog, priceList, rulesData } from '../data'
import adventureJson from '../data/adventures/drunken-griffin.json'
import fighterJson from '../data/characters/fighter-ratibor.json'
import drunkenGriffinJson from '../data/locations/drunken-griffin.json'
import type { ActionAuthor, StoryEvent, StoryState } from '../types/story'
import { parseAdventure } from './adventure'
import { parseCharacterSheet } from './character'
import { castIntent, castProblems } from './claimCheck'
import { parseLocation } from './location'
import { knownSpells } from './magic'
import { buildMasterRequest } from './masterPrompt'
import { runMasterTurn } from './masterTurn'
import { applyAction, checkAction, makeAction, MASTER, newStorySeed, player } from './storyActions'
import { findSpell, sameWord, spellMatches } from './spellMatch'

const location = parseLocation(drunkenGriffinJson)
const locations = { [location.id]: location }
const adventure = parseAdventure(adventureJson, locations)
const ratibor = parseCharacterSheet(fighterJson, itemCatalog)
const context = { catalog: itemCatalog, rules: rulesData, prices: priceList }
const spells = rulesData.spells

/** Ратибор — лесной гном: заговор «Малая иллюзия» и «Разговор с животными» от вида (магии класса нет). */
function gnomeStory(said: string): StoryState {
  let state = newStorySeed({ id: 's1', title: 'Тест', tone: 'detective', adventure, locations, party: [ratibor], now: 1 })
  state = { ...state, party: [{ ...state.party[0], character: { ...state.party[0].character, speciesId: 'gnome', speciesOption: 'forest-gnome' } }] }
  const events: [StoryEvent, ActionAuthor][] = [
    [{ type: 'masterNarrated', messageId: 'm1', text: 'За дверью кладовой кто-то возится.' }, MASTER],
    [{ type: 'playerSpoke', heroId: 'ratibor', messageId: 'p1', text: said }, player('ratibor')],
  ]
  events.forEach(([event, author], i) => (state = applyAction(state, makeAction('s1', i + 1, event, author, 2 + i, `a${i}`))))
  return state
}

function runtimeFor(initial: StoryState) {
  let state = initial
  let seq = 100
  const committed: string[] = []
  let n = 0
  return {
    committed,
    current: () => state,
    runtime: {
      getStory: () => state,
      commit: (event: StoryEvent, author: ActionAuthor) => {
        const action = makeAction(state.id, seq++, event, author, 5, `x${seq}`)
        const reason = checkAction(state, action, { catalog: itemCatalog, rules: rulesData })
        if (reason) return reason
        state = applyAction(state, action)
        committed.push(event.type)
        return null
      },
      tools: { ...context, rng: () => 0.5, now: () => 7, newId: () => `t${++n}` },
    },
  }
}

const call = (name: string, args: unknown, id = name) => ({ id, name, arguments: args, rawArguments: JSON.stringify(args) })
const endTurn = (id = 'end') => call('end_turn', { changes: [] }, id)
const lastUser = (req: AiRequest) => req.messages.at(-1) as { role: string; content: string }

describe('сопоставление названия заклинания', () => {
  it('слова в разных падежах — по началу корня', () => {
    expect(sameWord('малой', 'малая')).toBe(true)
    expect(sameWord('иллюзией', 'иллюзия')).toBe(true)
    expect(sameWord('стрелу', 'стрела')).toBe(true)
    expect(sameWord('свет', 'священное')).toBe(false)
  })

  it('id, название без регистра и ё/е, падежи, английское название; лишних частичных совпадений нет', () => {
    const mi = spells['minor-illusion']
    for (const q of ['minor-illusion', 'Малая иллюзия', 'малой иллюзией', 'МАЛУЮ ИЛЛЮЗИЮ', 'Minor Illusion']) expect(spellMatches(mi, q), q).not.toBeNull()
    expect(spellMatches(spells['fire-bolt'], 'огненный шар')).toBeNull()
    expect(spellMatches(spells['shield'], 'щитом')).not.toBeNull()
    const known = [spells['fire-bolt'], spells['magic-missile']]
    expect(findSpell('волшебной стрелой', known, spells)).toEqual({ spell: spells['magic-missile'] })
    // Не у героя, но в справочнике — найдено (движок скажет «не знает»); нет нигде — null.
    expect(findSpell('лечение ран', known, spells)).toEqual({ spell: spells['cure-wounds'] })
    expect(findSpell('полёт', known, spells)).toBeNull()
  })
})

describe('игрок заявил каст заклинания героя', () => {
  const known = knownSpells(gnomeStory('').party[0].character, rulesData).map((k) => k.spell)

  it('«кастую малой иллюзией…» — заклинание героя; «кастую летать», «бросаю кинжал» — нет', () => {
    expect(known.map((s) => s.id)).toEqual(['minor-illusion', 'speak-with-animals'])
    expect(castIntent('Кастую малой иллюзией — пусть за дверью раздадутся шаги стражи', known)?.id).toBe('minor-illusion')
    expect(castIntent('Колдую разговор с животными на кота', known)?.id).toBe('speak-with-animals')
    expect(castIntent('Кастую летать', known)).toBeNull()
    expect(castIntent('Бросаю кинжал в стол', known)).toBeNull()
    // Без глагола каста — просто упоминание.
    expect(castIntent('А что такое малая иллюзия?', known)).toBeNull()
  })

  it('cast_spell не вызван — просьба; вызван (даже с отказом движка) — нет', () => {
    const problems = castProblems('кастую малой иллюзией', known, [])
    expect(problems).toEqual([expect.stringContaining('игрок сотворяет «Малая иллюзия» — это заклинание героя (minor-illusion), но cast_spell не вызван')])
    const refused = { call: call('cast_spell', { spell: 'x' }), outcome: { ok: false, result: { ok: false, error: 'нет' }, events: [] } }
    expect(castProblems('кастую малой иллюзией', known, [refused])).toEqual([])
  })
})

describe('список заклинаний героя в запросе ведущему', () => {
  it('у каждого заклинания id, название, круг и остаток; строка «Может сотворить»', () => {
    const system = buildMasterRequest(gnomeStory('кастую малой иллюзией'), { verbosity: 'normal', context }).messages[0].content as string
    expect(system).toContain('Малая иллюзия [minor-illusion; заговор]')
    expect(system).toMatch(/Разговор с животными \[speak-with-animals; 1-й круг; без ячейки \d+\/\d+[;\]]/)
    expect(system).toContain('Может сотворить (cast_spell, spell = id из скобок): Малая иллюзия [minor-illusion; заговор]')
  })

  it('при обрезке контекста (окно модели почти заполнено) список заклинаний остаётся — убираются лента, сводка и факты', () => {
    let story = gnomeStory('кастую малой иллюзией')
    for (let i = 0; i < 60; i++)
      story = applyAction(story, makeAction('s1', 10 + i, { type: 'masterNarrated', messageId: `x${i}`, text: 'Длинная сцена в таверне. '.repeat(40) }, MASTER, 10 + i, `b${i}`))
    story = { ...story, memory: { summary: 'Сводка. '.repeat(400), covered: 0, compactions: 1, updatedAt: 1 } }
    const plan = buildMasterRequest(story, { verbosity: 'normal', context, budget: { contextWindow: 16_000, targetTokens: 8_000, maxResponseTokens: 800 } })
    expect(plan.dropped).toBeGreaterThan(0)
    expect(plan.messages[0].content).toContain('Может сотворить (cast_spell, spell = id из скобок): Малая иллюзия [minor-illusion; заговор]')
  })
})

describe('ход ведущего с подменённым ответом ИИ', () => {
  it('ведущий отказал в заговоре героя без вызова — просьба вызвать cast_spell; движок узнаёт «малой иллюзией», ответ переписан', async () => {
    const story = gnomeStory('Кастую малой иллюзией — пусть за дверью раздадутся тяжёлые шаги')
    const env = runtimeFor(story)
    const { master, requests } = fakeMaster([
      () => aiResponse({ text: 'Ты не владеешь магией, так что ничего не выходит.', toolCalls: [endTurn()] }),
      () =>
        aiResponse({
          text: 'Ты шепчешь слово — и за дверью гремят тяжёлые шаги. Возня в кладовой мгновенно стихает.',
          toolCalls: [call('cast_spell', { spell: 'малой иллюзией', target: 'шаги за дверью' }, 'c1')],
        }),
    ])
    const result = await runMasterTurn(master, story, { verbosity: 'normal', context, runtime: env.runtime })
    expect(requests).toHaveLength(2)
    expect(lastUser(requests[1]).content).toContain('игрок сотворяет «Малая иллюзия» — это заклинание героя (minor-illusion), но cast_spell не вызван')
    expect(result.toolCalls[0].outcome.ok).toBe(true)
    expect(env.committed).toContain('spellCast')
    expect(result.text).toBe('Ты шепчешь слово — и за дверью гремят тяжёлые шаги. Возня в кладовой мгновенно стихает.')
  })

  it('ведущий сразу вызывает cast_spell с названием в падеже — заговор сотворён, лишних запросов нет', async () => {
    const story = gnomeStory('кастую малой иллюзией')
    const env = runtimeFor(story)
    const { master, requests } = fakeMaster([
      () => aiResponse({ toolCalls: [call('cast_spell', { spell: 'Малой Иллюзией' }, 'c1')] }),
      () => aiResponse({ text: 'Над столом мерцает призрачная кружка.', toolCalls: [endTurn()] }),
    ])
    const result = await runMasterTurn(master, story, { verbosity: 'normal', context, runtime: env.runtime })
    expect(requests).toHaveLength(2)
    expect(JSON.parse(requests[1].messages.find((m) => m.role === 'tool')!.content as string)).toMatchObject({ ok: true, spell: 'Малая иллюзия' })
    expect(result.claims).toBeUndefined()
  })

  it('«кастую летать» — заклинания нет: вежливый отказ без вызова не считается ошибкой', async () => {
    const story = gnomeStory('Кастую летать и взмываю к потолку')
    const env = runtimeFor(story)
    const { master, requests } = fakeMaster([
      () => aiResponse({ text: 'Ты тянешься к магии, но такого заклинания ты не знаешь. Зато малая иллюзия может отвлечь всех.', toolCalls: [endTurn()] }),
    ])
    const result = await runMasterTurn(master, story, { verbosity: 'normal', context, runtime: env.runtime })
    expect(requests).toHaveLength(1)
    expect(result.claims).toBeUndefined()
  })

  it('ведущий вызвал «Полёт» — движок отказывает с причиной и списком доступного; просьбы сверки нет', async () => {
    const story = gnomeStory('Кастую полёт')
    const env = runtimeFor(story)
    const { master, requests } = fakeMaster([
      () => aiResponse({ toolCalls: [call('cast_spell', { spell: 'Полёт' }, 'c1')] }),
      () => aiResponse({ text: 'Ты пытаешься вспомнить формулу полёта — но её никогда не знал.', toolCalls: [endTurn()] }),
    ])
    await runMasterTurn(master, story, { verbosity: 'normal', context, runtime: env.runtime })
    expect(requests).toHaveLength(2)
    const refusal = JSON.parse(requests[1].messages.find((m) => m.role === 'tool')!.content as string) as { ok: boolean; error: string }
    expect(refusal.ok).toBe(false)
    expect(refusal.error).toMatch(/^Заклинания «Полёт» нет ни у Ратибор, ни в справочнике\. Доступно Ратибор: Малая иллюзия \[minor-illusion; заговор\]/)
  })
})
