import { describe, it, expect } from 'vitest'
import {
  parseDate,
  parseAmount,
  computeImportHash,
  inferPaymentMethod,
  parseCSV,
} from '../utils'

describe('parseDate', () => {
  it('passes through YYYY-MM-DD format (Capital One)', () => {
    expect(parseDate('2025-03-15')).toBe('2025-03-15')
  })

  it('converts MM/DD/YYYY to ISO (AmEx, Chase, Lake Ridge)', () => {
    expect(parseDate('03/15/2025')).toBe('2025-03-15')
  })

  it('handles single-digit month and day', () => {
    expect(parseDate('1/5/2025')).toBe('2025-01-05')
  })

  it('strips surrounding quotes (Lake Ridge)', () => {
    expect(parseDate('"03/15/2025"')).toBe('2025-03-15')
  })

  it('throws on unparseable format', () => {
    expect(() => parseDate('March 15, 2025')).toThrow('Cannot parse date')
  })

  it('throws on empty string', () => {
    expect(() => parseDate('')).toThrow('Cannot parse date')
  })
})

describe('parseAmount', () => {
  it('parses plain number', () => {
    expect(parseAmount('123.45')).toBe(123.45)
  })

  it('parses negative number', () => {
    expect(parseAmount('-75.87')).toBe(-75.87)
  })

  it('strips dollar sign (Lake Ridge)', () => {
    expect(parseAmount('$762.00')).toBe(762)
  })

  it('strips dollar sign with negative (Lake Ridge)', () => {
    expect(parseAmount('-$75.87')).toBe(-75.87)
  })

  it('strips commas in large numbers', () => {
    expect(parseAmount('$1,234.56')).toBe(1234.56)
  })

  it('strips surrounding quotes', () => {
    expect(parseAmount('"$762.00"')).toBe(762)
  })

  it('returns 0 for empty string', () => {
    expect(parseAmount('')).toBe(0)
  })

  it('returns 0 for bare dash', () => {
    expect(parseAmount('-')).toBe(0)
  })

  it('throws on non-numeric input', () => {
    expect(() => parseAmount('abc')).toThrow('Cannot parse amount')
  })
})

describe('computeImportHash', () => {
  it('produces a hex string', () => {
    const hash = computeImportHash(1, '2025-03-15', -42.5, 'AMAZON')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic', () => {
    const a = computeImportHash(1, '2025-03-15', -42.5, 'AMAZON')
    const b = computeImportHash(1, '2025-03-15', -42.5, 'AMAZON')
    expect(a).toBe(b)
  })

  it('differs when any field changes', () => {
    const base = computeImportHash(1, '2025-03-15', -42.5, 'AMAZON')
    expect(computeImportHash(2, '2025-03-15', -42.5, 'AMAZON')).not.toBe(base)
    expect(computeImportHash(1, '2025-03-16', -42.5, 'AMAZON')).not.toBe(base)
    expect(computeImportHash(1, '2025-03-15', -42.51, 'AMAZON')).not.toBe(base)
    expect(computeImportHash(1, '2025-03-15', -42.5, 'AMAZON PRIME')).not.toBe(base)
  })

  it('trims description whitespace', () => {
    const a = computeImportHash(1, '2025-03-15', -42.5, 'AMAZON')
    const b = computeImportHash(1, '2025-03-15', -42.5, '  AMAZON  ')
    expect(a).toBe(b)
  })

  it('rounds amount to 2 decimal places', () => {
    const a = computeImportHash(1, '2025-03-15', -42.5, 'AMAZON')
    const b = computeImportHash(1, '2025-03-15', -42.50, 'AMAZON')
    expect(a).toBe(b)
  })
})

describe('inferPaymentMethod', () => {
  it('returns credit for credit_card accounts', () => {
    expect(inferPaymentMethod('credit_card', 'ANY DESCRIPTION')).toBe('credit')
  })

  it('returns check when check number is provided', () => {
    expect(inferPaymentMethod('checking', 'CHECK PAYMENT', '1234')).toBe('check')
  })

  it('ignores empty/whitespace-only check number', () => {
    expect(inferPaymentMethod('checking', 'SOME PAYMENT', '')).not.toBe('check')
    expect(inferPaymentMethod('checking', 'SOME PAYMENT', '  ')).not.toBe('check')
  })

  it('detects direct deposit', () => {
    expect(inferPaymentMethod('checking', 'DIRECT DEP ACME')).toBe('direct_deposit')
    expect(inferPaymentMethod('checking', 'PAYROLL DEPOSIT')).toBe('direct_deposit')
    expect(inferPaymentMethod('checking', 'DIR DEP EMPLOYER')).toBe('direct_deposit')
  })

  it('detects transfers', () => {
    expect(inferPaymentMethod('checking', 'TRANSFER FROM SAVINGS')).toBe('transfer')
    expect(inferPaymentMethod('checking', 'XFER TO CHECKING')).toBe('transfer')
  })

  it('detects ACH/electronic', () => {
    expect(inferPaymentMethod('checking', 'ACH DEBIT UTILITY')).toBe('ach')
    expect(inferPaymentMethod('checking', 'ELECTRONIC PAYMENT')).toBe('ach')
    expect(inferPaymentMethod('checking', 'AUTOPAY ELECTRIC')).toBe('ach')
  })

  it('detects cash/ATM', () => {
    expect(inferPaymentMethod('checking', 'ATM WITHDRAWAL')).toBe('cash')
    expect(inferPaymentMethod('checking', 'CASH ADVANCE')).toBe('cash')
    expect(inferPaymentMethod('checking', 'WITHDRAWAL 123')).toBe('cash')
  })

  it('defaults to ach for bank accounts with no keyword match', () => {
    expect(inferPaymentMethod('checking', 'RANDOM PAYMENT')).toBe('ach')
  })
})

describe('parseCSV', () => {
  it('parses simple comma-separated rows', () => {
    const result = parseCSV('a,b,c\n1,2,3')
    expect(result).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
  })

  it('handles quoted fields containing commas', () => {
    const result = parseCSV('"hello, world",foo,bar')
    expect(result).toEqual([['hello, world', 'foo', 'bar']])
  })

  it('handles escaped quotes (doubled)', () => {
    const result = parseCSV('"say ""hello""",other')
    expect(result).toEqual([['say "hello"', 'other']])
  })

  it('skips empty lines', () => {
    const result = parseCSV('a,b\n\nc,d\n')
    expect(result).toEqual([['a', 'b'], ['c', 'd']])
  })

  it('trims field whitespace', () => {
    const result = parseCSV(' a , b , c ')
    expect(result).toEqual([['a', 'b', 'c']])
  })

  it('handles all-quoted rows (Lake Ridge style)', () => {
    const result = parseCSV('"Date","Description","Amount"\n"01/15/2025","GROCERY STORE","$125.00"')
    expect(result).toEqual([
      ['Date', 'Description', 'Amount'],
      ['01/15/2025', 'GROCERY STORE', '$125.00'],
    ])
  })
})
