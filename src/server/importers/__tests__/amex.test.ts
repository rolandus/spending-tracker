import { describe, it, expect } from 'vitest'
import { importAmex } from '../amex'

const HEADER = 'Date,Description,Card Member,Account #,Amount'

function csv(...rows: string[]) {
  return [HEADER, ...rows].join('\n')
}

describe('importAmex', () => {
  it('negates positive amount (charge → negative stored)', () => {
    const result = importAmex(csv('01/15/2025,AMAZON PURCHASE,ROLAND G SCOTT,12345,42.50'), 1, 'amex.csv')
    expect(result).toHaveLength(1)
    expect(result[0]!.amount).toBe(-42.5)
  })

  it('negates negative amount (reward/refund → positive stored)', () => {
    const result = importAmex(csv('01/15/2025,REWARD CREDIT,ROLAND G SCOTT,12345,-10.00'), 1, 'amex.csv')
    expect(result[0]!.amount).toBe(10)
  })

  it('populates cardholder field', () => {
    const result = importAmex(csv('01/15/2025,PURCHASE,LISA M SCOTT,12345,25.00'), 1, 'amex.csv')
    expect(result[0]!.cardholder).toBe('LISA M SCOTT')
  })

  it('converts MM/DD/YYYY date to ISO', () => {
    const result = importAmex(csv('03/05/2025,PURCHASE,ROLAND G SCOTT,12345,10.00'), 1, 'amex.csv')
    expect(result[0]!.date).toBe('2025-03-05')
  })

  it('sets sourceCategory to null (AmEx has no categories)', () => {
    const result = importAmex(csv('01/15/2025,PURCHASE,ROLAND G SCOTT,12345,10.00'), 1, 'amex.csv')
    expect(result[0]!.sourceCategory).toBeNull()
  })

  it('sets postedDate to null', () => {
    const result = importAmex(csv('01/15/2025,PURCHASE,ROLAND G SCOTT,12345,10.00'), 1, 'amex.csv')
    expect(result[0]!.postedDate).toBeNull()
  })

  it('infers payment method as credit', () => {
    const result = importAmex(csv('01/15/2025,PURCHASE,ROLAND G SCOTT,12345,10.00'), 1, 'amex.csv')
    expect(result[0]!.paymentMethod).toBe('credit')
  })

  it('sets transactionType to unknown (AI classifies later)', () => {
    const result = importAmex(csv('01/15/2025,AMAZON PURCHASE,ROLAND G SCOTT,12345,42.50'), 1, 'amex.csv')
    expect(result[0]!.transactionType).toBe('unknown')
  })

  it('computes importHash', () => {
    const result = importAmex(csv('01/15/2025,PURCHASE,ROLAND G SCOTT,12345,10.00'), 1, 'amex.csv')
    expect(result[0]!.importHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('stores source file name', () => {
    const result = importAmex(csv('01/15/2025,PURCHASE,ROLAND G SCOTT,12345,10.00'), 1, 'amex-2025.csv')
    expect(result[0]!.sourceFile).toBe('amex-2025.csv')
  })

  it('parses multiple rows', () => {
    const result = importAmex(
      csv(
        '01/15/2025,PURCHASE A,ROLAND G SCOTT,12345,10.00',
        '01/16/2025,PURCHASE B,LISA M SCOTT,12345,20.00',
      ),
      1,
      'amex.csv',
    )
    expect(result).toHaveLength(2)
  })

  it('throws on invalid header', () => {
    expect(() => importAmex('Bad,Header,Row\n1,2,3', 1, 'amex.csv')).toThrow('Invalid AmEx CSV')
  })

  it('throws on row missing required fields', () => {
    expect(() => importAmex(csv('01/15/2025,,ROLAND G SCOTT,12345,10.00'), 1, 'amex.csv')).toThrow(
      'Invalid AmEx row',
    )
  })
})
