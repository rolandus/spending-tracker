import { describe, it, expect } from 'vitest'
import { importLakeRidge } from '../lake-ridge'

const HEADER = '"Date","Description","Comments","Check Number","Amount","Balance"'

function csv(...rows: string[]) {
  return [HEADER, ...rows].join('\n')
}

describe('importLakeRidge', () => {
  it('parses dollar-sign amounts', () => {
    const result = importLakeRidge(csv('"01/15/2025","GROCERY STORE","","","$125.00","$1000.00"'), 4, 'checking.csv')
    expect(result[0]!.amount).toBe(125)
  })

  it('parses negative dollar-sign amounts', () => {
    const result = importLakeRidge(csv('"01/15/2025","ELECTRIC CO","","","-$75.87","$924.13"'), 4, 'checking.csv')
    expect(result[0]!.amount).toBe(-75.87)
  })

  it('sets transactionType to unknown (AI classifies later)', () => {
    const result = importLakeRidge(csv('"01/15/2025","PURCHASE","","","-$50.00","$500.00"'), 4, 'lake-ridge-checking.csv')
    expect(result[0]!.transactionType).toBe('unknown')
  })

  it('sets transactionType to unknown for savings too', () => {
    const result = importLakeRidge(csv('"01/15/2025","INTEREST PAID","","","$0.50","$500.50"'), 5, 'lake-ridge-savings-2025.csv')
    expect(result[0]!.transactionType).toBe('unknown')
  })

  it('extracts check number', () => {
    const result = importLakeRidge(csv('"01/15/2025","CHECK PAYMENT","","1234","-$200.00","$800.00"'), 4, 'checking.csv')
    expect(result[0]!.checkNumber).toBe('1234')
    expect(result[0]!.paymentMethod).toBe('check')
  })

  it('sets null check number when empty', () => {
    const result = importLakeRidge(csv('"01/15/2025","PURCHASE","","","-$50.00","$450.00"'), 4, 'checking.csv')
    expect(result[0]!.checkNumber).toBeNull()
  })

  it('converts MM/DD/YYYY to ISO', () => {
    const result = importLakeRidge(csv('"03/05/2025","PURCHASE","","","-$10.00","$490.00"'), 4, 'checking.csv')
    expect(result[0]!.date).toBe('2025-03-05')
  })

  it('strips quotes from description', () => {
    const result = importLakeRidge(csv('"01/15/2025","GROCERY STORE","","","-$50.00","$450.00"'), 4, 'checking.csv')
    expect(result[0]!.description).toBe('GROCERY STORE')
  })

  it('sets sourceCategory to null', () => {
    const result = importLakeRidge(csv('"01/15/2025","PURCHASE","","","-$10.00","$490.00"'), 4, 'checking.csv')
    expect(result[0]!.sourceCategory).toBeNull()
  })

  it('sets cardholder to null', () => {
    const result = importLakeRidge(csv('"01/15/2025","PURCHASE","","","-$10.00","$490.00"'), 4, 'checking.csv')
    expect(result[0]!.cardholder).toBeNull()
  })

  it('throws on invalid header', () => {
    expect(() => importLakeRidge('Bad,Header\n1,2', 4, 'checking.csv')).toThrow('Invalid Lake Ridge CSV')
  })

  it('sets unknown transactionType but preserves paymentMethod for direct deposit', () => {
    const result = importLakeRidge(csv('"01/15/2025","DIRECT DEP ACME CORP","","","$2000.00","$3000.00"'), 6, 'spending.csv')
    expect(result[0]!.transactionType).toBe('unknown')
    expect(result[0]!.paymentMethod).toBe('direct_deposit')
  })

  it('sets unknown transactionType but preserves paymentMethod for transfer', () => {
    const result = importLakeRidge(csv('"01/15/2025","TRANSFER TO CHECKING","","","-$500.00","$2500.00"'), 6, 'spending.csv')
    expect(result[0]!.transactionType).toBe('unknown')
    expect(result[0]!.paymentMethod).toBe('transfer')
  })
})
