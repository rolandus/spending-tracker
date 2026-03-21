import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb, seedTestAccounts } from './setup'
import { accounts, transactions } from '../db/schema'
import { eq, sql } from 'drizzle-orm'
import { getImporter } from '../importers'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type * as schema from '../db/schema'

let db: BetterSQLite3Database<typeof schema>

beforeEach(() => {
  const testDb = createTestDb()
  db = testDb.db
  seedTestAccounts(db)
})

function importCSV(data: { accountId: number; csvContent: string; fileName: string }) {
  const account = db.select().from(accounts).where(eq(accounts.id, data.accountId)).get()
  if (!account) return { inserted: 0, skipped: 0, errors: [`Account ID ${data.accountId} not found`] }

  const importer = getImporter(account.institution)
  const parsed = importer(data.csvContent, data.accountId, data.fileName)

  let inserted = 0
  let skipped = 0
  const errors: string[] = []

  for (const txn of parsed) {
    try {
      const result = db.insert(transactions).values(txn).onConflictDoNothing({ target: transactions.importHash }).run()
      if (result.changes > 0) inserted++
      else skipped++
    } catch (err) {
      errors.push(`Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { inserted, skipped, errors }
}

describe('import pipeline integration', () => {
  it('imports AmEx CSV into the database', () => {
    const csv = 'Date,Description,Card Member,Account #,Amount\n01/15/2025,AMAZON,ROLAND G SCOTT,12345,42.50'
    const result = importCSV({ accountId: 1, csvContent: csv, fileName: 'amex.csv' })

    expect(result.inserted).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.errors).toHaveLength(0)

    const rows = db.select().from(transactions).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.amount).toBe(-42.5) // AmEx sign inversion
    expect(rows[0]!.cardholder).toBe('ROLAND G SCOTT')
  })

  it('imports Capital One CSV into the database', () => {
    const csv = 'Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n2025-01-15,2025-01-16,4880,GROCERY STORE,Merchandise,42.50,'
    const result = importCSV({ accountId: 2, csvContent: csv, fileName: 'cap1.csv' })

    expect(result.inserted).toBe(1)
    const rows = db.select().from(transactions).all()
    expect(rows[0]!.amount).toBe(-42.5)
    expect(rows[0]!.sourceCategory).toBe('Merchandise')
    expect(rows[0]!.postedDate).toBe('2025-01-16')
  })

  it('imports Chase CSV into the database', () => {
    const csv = 'Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n01/15/2025,01/16/2025,AMAZON,Shopping,Sale,-42.50,'
    const result = importCSV({ accountId: 3, csvContent: csv, fileName: 'chase.csv' })

    expect(result.inserted).toBe(1)
    const rows = db.select().from(transactions).all()
    expect(rows[0]!.amount).toBe(-42.5)
    expect(rows[0]!.sourceCategory).toBe('Shopping')
  })

  it('imports Lake Ridge CSV into the database', () => {
    const csv = '"Date","Description","Comments","Check Number","Amount","Balance"\n"01/15/2025","GROCERY STORE","","","-$75.87","$924.13"'
    const result = importCSV({ accountId: 4, csvContent: csv, fileName: 'checking.csv' })

    expect(result.inserted).toBe(1)
    const rows = db.select().from(transactions).all()
    expect(rows[0]!.amount).toBe(-75.87)
  })

  describe('deduplication', () => {
    const amexCsv = 'Date,Description,Card Member,Account #,Amount\n01/15/2025,AMAZON,ROLAND G SCOTT,12345,42.50'

    it('skips duplicate rows on second import', () => {
      const first = importCSV({ accountId: 1, csvContent: amexCsv, fileName: 'amex.csv' })
      expect(first.inserted).toBe(1)

      const second = importCSV({ accountId: 1, csvContent: amexCsv, fileName: 'amex.csv' })
      expect(second.inserted).toBe(0)
      expect(second.skipped).toBe(1)

      const rows = db.select().from(transactions).all()
      expect(rows).toHaveLength(1)
    })

    it('import_hash uniqueness enforced at DB level', () => {
      importCSV({ accountId: 1, csvContent: amexCsv, fileName: 'amex.csv' })

      // Try direct insert with same hash
      const existing = db.select().from(transactions).get()!
      const result = db
        .insert(transactions)
        .values({ ...existing, id: undefined as unknown as number })
        .onConflictDoNothing({ target: transactions.importHash })
        .run()

      expect(result.changes).toBe(0)
    })
  })

  it('returns error for unknown account ID', () => {
    const csv = 'Date,Description,Card Member,Account #,Amount\n01/15/2025,AMAZON,ROLAND,12345,42.50'
    const result = importCSV({ accountId: 999, csvContent: csv, fileName: 'amex.csv' })
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('not found')
  })

  it('getImporter throws for unknown institution', () => {
    expect(() => getImporter('unknown_bank')).toThrow('No importer found')
  })

  describe('transaction defaults on import', () => {
    it('sets transactionType=unknown and ignored=0 for all transactions (AI classifies later)', () => {
      const csv = 'Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n01/15/2025,01/16/2025,AUTOMATIC PAYMENT - THANK,Shopping,Payment,500.00,'
      const result = importCSV({ accountId: 3, csvContent: csv, fileName: 'chase.csv' })

      expect(result.inserted).toBe(1)
      const rows = db.select().from(transactions).all()
      expect(rows[0]!.transactionType).toBe('unknown')
      expect(rows[0]!.ignored).toBe(0)
    })

    it('sets transactionType=unknown for Lake Ridge transfers (AI classifies later)', () => {
      const csv = '"Date","Description","Comments","Check Number","Amount","Balance"\n"01/15/2025","TRANSFER TO SAVINGS","","","-$500.00","$1,000.00"'
      const result = importCSV({ accountId: 4, csvContent: csv, fileName: 'checking.csv' })

      expect(result.inserted).toBe(1)
      const rows = db.select().from(transactions).all()
      expect(rows[0]!.transactionType).toBe('unknown')
      expect(rows[0]!.ignored).toBe(0)
    })

    it('sets ignored=0 for regular expense transactions', () => {
      const csv = 'Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n01/15/2025,01/16/2025,AMAZON,Shopping,Sale,-42.50,'
      const result = importCSV({ accountId: 3, csvContent: csv, fileName: 'chase.csv' })

      expect(result.inserted).toBe(1)
      const rows = db.select().from(transactions).all()
      expect(rows[0]!.transactionType).toBe('unknown')
      expect(rows[0]!.ignored).toBe(0)
    })
  })
})
