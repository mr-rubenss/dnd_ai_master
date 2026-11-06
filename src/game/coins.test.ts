import { describe, expect, it } from 'vitest'
import { addCoins, changeCoins, coinsFromGold, coinsValue, formatCoins, formatCp, isCoins, payCoins, priceToCp } from './coins'

describe('кошелёк: мм, см, зм', () => {
  it('старое золото числом → монеты', () => {
    expect(coinsFromGold(18)).toEqual({ gp: 18, sp: 0, cp: 0 })
    expect(coinsFromGold(15.55)).toEqual({ gp: 15, sp: 5, cp: 5 })
    expect(coinsFromGold(0)).toEqual({ gp: 0, sp: 0, cp: 0 })
  })

  it('оплата эля (4 мм) одним золотым — сдача серебром и медью', () => {
    expect(payCoins({ gp: 18, sp: 0, cp: 0 }, 4)).toEqual({ gp: 17, sp: 9, cp: 6 })
  })

  it('сначала мелкими монетами; размен серебряной, если не хватает меньше 10 мм', () => {
    expect(payCoins({ gp: 1, sp: 2, cp: 5 }, 4)).toEqual({ gp: 1, sp: 2, cp: 1 })
    expect(payCoins({ gp: 1, sp: 2, cp: 1 }, 4)).toEqual({ gp: 1, sp: 1, cp: 7 })
    expect(payCoins({ gp: 1, sp: 15, cp: 0 }, 200)).toEqual({ gp: 0, sp: 5, cp: 0 })
    expect(payCoins({ gp: 0, sp: 3, cp: 9 }, 35)).toEqual({ gp: 0, sp: 0, cp: 4 })
  })

  it('денег не хватает — null; стоимость кошелька сохраняется при любом платеже', () => {
    expect(payCoins({ gp: 0, sp: 0, cp: 3 }, 4)).toBeNull()
    for (const [purse, cost] of [
      [{ gp: 3, sp: 7, cp: 2 }, 189],
      [{ gp: 0, sp: 25, cp: 0 }, 133],
      [{ gp: 2, sp: 0, cp: 9 }, 199],
    ] as const) {
      const after = payCoins(purse, cost)!
      expect(isCoins(after)).toBe(true)
      expect(coinsValue(after)).toBe(coinsValue(purse) - cost)
    }
  })

  it('получение и изменение, форматы', () => {
    expect(addCoins({ gp: 1, sp: 0, cp: 0 }, 155)).toEqual({ gp: 2, sp: 5, cp: 5 })
    expect(changeCoins({ gp: 1, sp: 0, cp: 0 }, -150)).toBeNull()
    expect(formatCoins({ gp: 17, sp: 9, cp: 6 })).toBe('17 зм 9 см 6 мм')
    expect(formatCoins({ gp: 0, sp: 0, cp: 0 })).toBe('0 мм')
    expect(formatCp(-4)).toBe('4 мм')
    expect(priceToCp(4, 'cp')).toBe(4)
    expect(priceToCp(0.5, 'gp')).toBe(50)
    expect(priceToCp(0.5, 'cp')).toBeNull()
  })
})
