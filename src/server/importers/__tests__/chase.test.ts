import { describe, it, expect } from 'vitest'
import { importChase } from '../chase'

const HEADER = 'Transaction Date,Post Date,Description,Category,Type,Amount,Memo'

function csv(...rows: string[]) {
  return [HEADER, ...rows].join('\n')
}

describe('importChase', () => {
  it('passes through negative amounts as-is (expense)', () => {
    const result = importChase(csv('01/15/2025,01/16/2025,AMAZON,Shopping,Sale,-42.50,'), 1, 'chase.csv')
    expect(result[0]!.amount).toBe(-42.5)
  })

  it('passes through positive amounts as-is (payment/credit)', () => {
    const result = importChase(csv('01/15/2025,01/16/2025,PAYMENT THANK YOU,Payment,Payment,500.00,'), 1, 'chase.csv')
    expect(result[0]!.amount).toBe(500)
  })

  it('converts MM/DD/YYYY date to ISO', () => {
    const result = importChase(csv('03/05/2025,03/06/2025,PURCHASE,Shopping,Sale,-10.00,'), 1, 'chase.csv')
    expect(result[0]!.date).toBe('2025-03-05')
  })

  it('stores posted date', () => {
    const result = importChase(csv('01/15/2025,01/17/2025,PURCHASE,Shopping,Sale,-10.00,'), 1, 'chase.csv')
    expect(result[0]!.postedDate).toBe('2025-01-17')
  })

  it('preserves source category', () => {
    const result = importChase(csv('01/15/2025,01/16/2025,STORE,Food & Drink,Sale,-15.00,'), 1, 'chase.csv')
    expect(result[0]!.sourceCategory).toBe('Food & Drink')
  })

  it('sets transactionType to unknown (AI classifies later)', () => {
    const result = importChase(csv('01/15/2025,01/16/2025,GROCERY STORE,Shopping,Sale,-75.00,'), 1, 'chase.csv')
    expect(result[0]!.transactionType).toBe('unknown')
  })

  it('infers payment method as credit', () => {
    const result = importChase(csv('01/15/2025,01/16/2025,STORE,Shopping,Sale,-10.00,'), 1, 'chase.csv')
    expect(result[0]!.paymentMethod).toBe('credit')
  })

  it('throws on invalid header', () => {
    expect(() => importChase('Bad,Header\n1,2', 1, 'chase.csv')).toThrow('Invalid Chase CSV')
  })

  it('throws on row missing required fields', () => {
    expect(() => importChase(csv('01/15/2025,01/16/2025,STORE,Shopping,Sale,,'), 1, 'chase.csv')).not.toThrow()
    // Amount is "undefined" string — rawAmount === undefined check
    expect(() => importChase(csv(',,STORE,Shopping,Sale,-10.00,'), 1, 'chase.csv')).toThrow('Invalid Chase row')
  })
})
