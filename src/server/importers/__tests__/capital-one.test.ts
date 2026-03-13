import { describe, it, expect } from 'vitest'
import { importCapitalOne } from '../capital-one'

const HEADER = 'Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit'

function csv(...rows: string[]) {
  return [HEADER, ...rows].join('\n')
}

describe('importCapitalOne', () => {
  it('converts debit to negative amount', () => {
    const result = importCapitalOne(csv('2025-01-15,2025-01-16,4880,GROCERY STORE,Merchandise,42.50,'), 1, 'cap1.csv')
    expect(result[0]!.amount).toBe(-42.5)
  })

  it('keeps credit as positive amount', () => {
    const result = importCapitalOne(csv('2025-01-15,2025-01-16,4880,PAYMENT THANK YOU,,, 500.00'), 1, 'cap1.csv')
    expect(result[0]!.amount).toBe(500)
  })

  it('passes through YYYY-MM-DD dates unchanged', () => {
    const result = importCapitalOne(csv('2025-03-15,2025-03-16,4880,PURCHASE,Shopping,10.00,'), 1, 'cap1.csv')
    expect(result[0]!.date).toBe('2025-03-15')
  })

  it('stores posted date', () => {
    const result = importCapitalOne(csv('2025-01-15,2025-01-17,4880,PURCHASE,Shopping,25.00,'), 1, 'cap1.csv')
    expect(result[0]!.postedDate).toBe('2025-01-17')
  })

  it('handles missing posted date', () => {
    const result = importCapitalOne(csv('2025-01-15,,4880,PURCHASE,Shopping,25.00,'), 1, 'cap1.csv')
    expect(result[0]!.postedDate).toBeNull()
  })

  it('preserves source category', () => {
    const result = importCapitalOne(csv('2025-01-15,2025-01-16,4880,STORE,Dining,15.00,'), 1, 'cap1.csv')
    expect(result[0]!.sourceCategory).toBe('Dining')
  })

  it('sets cardholder to null', () => {
    const result = importCapitalOne(csv('2025-01-15,2025-01-16,4880,STORE,Dining,15.00,'), 1, 'cap1.csv')
    expect(result[0]!.cardholder).toBeNull()
  })

  it('infers payment method as credit', () => {
    const result = importCapitalOne(csv('2025-01-15,2025-01-16,4880,STORE,Shopping,10.00,'), 1, 'cap1.csv')
    expect(result[0]!.paymentMethod).toBe('credit')
  })

  it('throws on invalid header', () => {
    expect(() => importCapitalOne('Bad,Header,Row\n1,2,3', 1, 'cap1.csv')).toThrow('Invalid Capital One CSV')
  })

  it('throws on row missing required fields', () => {
    expect(() => importCapitalOne(csv(',,,,,10.00,'), 1, 'cap1.csv')).toThrow('Invalid Capital One row')
  })
})
