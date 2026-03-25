import { describe, it, expect } from 'vitest'
import { importSchwab } from '../schwab'

const HEADER = '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"'

function csv(...rows: string[]) {
  return [HEADER, ...rows].join('\n')
}

describe('importSchwab', () => {
  it('imports MoneyLink Deposit rows', () => {
    const result = importSchwab(
      csv(
        '"03/13/2026","MoneyLink Deposit","","Handshake-OSV","","","","$150.00"',
      ),
      1,
      'schwab.csv',
    )
    expect(result).toHaveLength(1)
    expect(result[0]!.amount).toBe(150)
    expect(result[0]!.date).toBe('2026-03-13')
    expect(result[0]!.description).toBe('Handshake-OSV')
    expect(result[0]!.paymentMethod).toBe('ach')
  })

  it('filters out non-MoneyLink-Deposit rows', () => {
    const result = importSchwab(
      csv(
        '"03/23/2026","Sell to Open","TRIP 04/17/2026 10.50 C","CALL TRIPADVISOR INC $10.5 EXP 04/17/26","6","$0.31","$3.99","$182.01"',
        '"03/23/2026","Buy to Close","TRIP 03/27/2026 10.00 C","CALL TRIPADVISOR INC $10 EXP 03/27/26","6","$0.29","$3.97","-$177.97"',
        '"03/13/2026","MoneyLink Deposit","","Handshake-OSV","","","","$150.00"',
        '"03/23/2026","Journal","","JOURNAL TO ...849","","","","-$4000.00"',
      ),
      1,
      'schwab.csv',
    )
    expect(result).toHaveLength(1)
    expect(result[0]!.description).toBe('Handshake-OSV')
  })

  it('sets transactionType to unknown', () => {
    const result = importSchwab(
      csv('"01/15/2026","MoneyLink Deposit","","Test","","","","$500.00"'),
      1,
      'schwab.csv',
    )
    expect(result[0]!.transactionType).toBe('unknown')
  })

  it('throws on invalid header', () => {
    expect(() => importSchwab('Bad,Header\n1,2', 1, 'schwab.csv')).toThrow(
      'Invalid Schwab CSV',
    )
  })

  it('returns empty array when no MoneyLink Deposits exist', () => {
    const result = importSchwab(
      csv(
        '"03/23/2026","Sell to Open","TRIP 04/17/2026 10.50 C","CALL TRIPADVISOR","6","$0.31","$3.99","$182.01"',
      ),
      1,
      'schwab.csv',
    )
    expect(result).toHaveLength(0)
  })

  it('handles date with "as of" suffix gracefully', () => {
    const result = importSchwab(
      csv('"03/23/2026 as of 03/20/2026","MoneyLink Deposit","","Test Deposit","","","","$200.00"'),
      1,
      'schwab.csv',
    )
    expect(result).toHaveLength(1)
    expect(result[0]!.date).toBe('2026-03-23')
  })
})
