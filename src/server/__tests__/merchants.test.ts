import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb, seedTestAccounts } from './setup'
import { merchants, transactions } from '../db/schema'
import { eq, sql, isNull } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type * as schema from '../db/schema'

let db: BetterSQLite3Database<typeof schema>

function buildLikePattern(pattern: string, matchType: 'contains' | 'starts_with' | 'exact'): string {
  switch (matchType) {
    case 'contains': return `%${pattern}%`
    case 'starts_with': return `${pattern}%`
    case 'exact': return pattern
  }
}

function seedTransactions() {
  // Descriptions must share the same first-20-char prefix (uppercased) for suggestMerchants grouping to work
  db.insert(transactions).values([
    { accountId: 1, date: '2025-01-15', description: 'AMZN MKTP US PURCHASEAB1CD ORDER 1', amount: -42.5, transactionType: 'expense', sourceFile: 'test.csv', importHash: 'm1' },
    { accountId: 1, date: '2025-01-16', description: 'AMZN MKTP US PURCHASEEF2GH ORDER 2', amount: -14.99, transactionType: 'expense', sourceFile: 'test.csv', importHash: 'm2' },
    { accountId: 3, date: '2025-01-17', description: 'NETFLIX.COM', amount: -15.99, transactionType: 'expense', sourceFile: 'test.csv', importHash: 'm3' },
    { accountId: 3, date: '2025-01-18', description: 'WHOLE FOODS MARKET #1234 AUSTIN TX', amount: -85.0, transactionType: 'expense', sourceFile: 'test.csv', importHash: 'm4' },
    { accountId: 3, date: '2025-01-19', description: 'WHOLE FOODS MARKET #5678 DALLAS TX', amount: -45.0, transactionType: 'expense', sourceFile: 'test.csv', importHash: 'm5' },
  ]).run()
}

beforeEach(() => {
  const testDb = createTestDb()
  db = testDb.db
  seedTestAccounts(db)
  seedTransactions()
})

describe('createMerchant', () => {
  it('assigns merchant_id to matching transactions', () => {
    const merchant = db.insert(merchants).values({
      name: 'Amazon',
      pattern: 'AMZN MKTP',
      matchType: 'contains',
    }).returning().get()

    const likePattern = buildLikePattern('AMZN MKTP', 'contains')
    const result = db.run(
      sql`UPDATE transactions SET merchant_id = ${merchant.id} WHERE description LIKE ${likePattern} AND merchant_id IS NULL`,
    )

    expect(result.changes).toBe(2)

    const matched = db.select().from(transactions).where(eq(transactions.merchantId, merchant.id)).all()
    expect(matched).toHaveLength(2)
  })

  it('auto-categorizes when defaultCategory is provided', () => {
    const merchant = db.insert(merchants).values({
      name: 'Amazon',
      pattern: 'AMZN MKTP',
      matchType: 'contains',
      defaultCategory: 'Shopping',
    }).returning().get()

    // Apply merchant
    const likePattern = buildLikePattern('AMZN MKTP', 'contains')
    db.run(sql`UPDATE transactions SET merchant_id = ${merchant.id} WHERE description LIKE ${likePattern} AND merchant_id IS NULL`)

    // Apply default category
    const catResult = db.run(
      sql`UPDATE transactions SET category = ${merchant.defaultCategory} WHERE merchant_id = ${merchant.id} AND category IS NULL`,
    )

    expect(catResult.changes).toBe(2)

    const t = db.select().from(transactions).where(eq(transactions.importHash, 'm1')).get()!
    expect(t.category).toBe('Shopping')
    expect(t.merchantId).toBe(merchant.id)
  })

  it('does not categorize already-categorized transactions', () => {
    // Pre-categorize one transaction
    db.update(transactions).set({ category: 'Existing' }).where(eq(transactions.importHash, 'm1')).run()

    const merchant = db.insert(merchants).values({
      name: 'Amazon',
      pattern: 'AMZN MKTP',
      matchType: 'contains',
      defaultCategory: 'Shopping',
    }).returning().get()

    db.run(sql`UPDATE transactions SET merchant_id = ${merchant.id} WHERE description LIKE '%AMZN MKTP%' AND merchant_id IS NULL`)
    db.run(sql`UPDATE transactions SET category = 'Shopping' WHERE merchant_id = ${merchant.id} AND category IS NULL`)

    const t = db.select().from(transactions).where(eq(transactions.importHash, 'm1')).get()!
    expect(t.category).toBe('Existing') // Not overwritten
  })
})

describe('applyMerchantRules', () => {
  it('only assigns to unassigned transactions', () => {
    const amazon = db.insert(merchants).values({
      name: 'Amazon',
      pattern: 'AMZN MKTP',
      matchType: 'contains',
    }).returning().get()

    // Manually assign m1 to a different merchant first
    const netflix = db.insert(merchants).values({
      name: 'Netflix',
      pattern: 'NETFLIX',
      matchType: 'contains',
    }).returning().get()

    db.update(transactions).set({ merchantId: netflix.id }).where(eq(transactions.importHash, 'm3')).run()

    // Apply all merchant rules
    const allMerchants = db.select().from(merchants).all()
    let totalMatched = 0
    for (const m of allMerchants) {
      const likePattern = buildLikePattern(m.pattern, m.matchType as 'contains' | 'starts_with' | 'exact')
      const result = db.run(
        sql`UPDATE transactions SET merchant_id = ${m.id} WHERE description LIKE ${likePattern} AND merchant_id IS NULL`,
      )
      totalMatched += result.changes
    }

    expect(totalMatched).toBe(2) // m1 and m2 (AMZN), m3 already assigned

    // m3 should still be Netflix, not reassigned
    const t = db.select().from(transactions).where(eq(transactions.importHash, 'm3')).get()!
    expect(t.merchantId).toBe(netflix.id)
  })
})

describe('deleteMerchant', () => {
  it('nullifies merchant_id on affected transactions', () => {
    const merchant = db.insert(merchants).values({
      name: 'Amazon',
      pattern: 'AMZN MKTP',
      matchType: 'contains',
    }).returning().get()

    db.run(sql`UPDATE transactions SET merchant_id = ${merchant.id} WHERE description LIKE '%AMZN MKTP%'`)

    // Verify assigned
    let matched = db.select().from(transactions).where(eq(transactions.merchantId, merchant.id)).all()
    expect(matched).toHaveLength(2)

    // Delete merchant
    db.run(sql`UPDATE transactions SET merchant_id = NULL WHERE merchant_id = ${merchant.id}`)
    db.delete(merchants).where(eq(merchants.id, merchant.id)).run()

    // Verify merchant gone
    expect(db.select().from(merchants).all()).toHaveLength(0)

    // Verify merchant_id cleared
    matched = db.select().from(transactions).where(eq(transactions.merchantId, merchant.id)).all()
    expect(matched).toHaveLength(0)
  })
})

describe('suggestMerchants', () => {
  it('groups unmatched transactions by description prefix', () => {
    const suggestions = db
      .select({
        prefix: sql<string>`UPPER(SUBSTR(description, 1, 20))`,
        count: sql<number>`count(*)`,
        sample: sql<string>`description`,
      })
      .from(transactions)
      .where(isNull(transactions.merchantId))
      .groupBy(sql`UPPER(SUBSTR(description, 1, 20))`)
      .having(sql`count(*) >= 2`)
      .orderBy(sql`count(*) DESC`)
      .limit(20)
      .all()

    // AMZN MKTP US* should group (2 transactions share the prefix)
    // WHOLE FOODS should group (2 transactions share the prefix)
    expect(suggestions.length).toBeGreaterThanOrEqual(2)

    const amznSuggestion = suggestions.find(s => s.prefix.includes('AMZN'))
    expect(amznSuggestion).toBeDefined()
    expect(amznSuggestion!.count).toBe(2)

    const wholeFoodsSuggestion = suggestions.find(s => s.prefix.includes('WHOLE'))
    expect(wholeFoodsSuggestion).toBeDefined()
    expect(wholeFoodsSuggestion!.count).toBe(2)
  })

  it('excludes transactions with a merchant already assigned', () => {
    const merchant = db.insert(merchants).values({
      name: 'Amazon',
      pattern: 'AMZN MKTP',
      matchType: 'contains',
    }).returning().get()

    db.run(sql`UPDATE transactions SET merchant_id = ${merchant.id} WHERE description LIKE '%AMZN MKTP%'`)

    const suggestions = db
      .select({
        prefix: sql<string>`UPPER(SUBSTR(description, 1, 20))`,
        count: sql<number>`count(*)`,
      })
      .from(transactions)
      .where(isNull(transactions.merchantId))
      .groupBy(sql`UPPER(SUBSTR(description, 1, 20))`)
      .having(sql`count(*) >= 2`)
      .all()

    // AMZN should no longer appear
    const amznSuggestion = suggestions.find(s => s.prefix.includes('AMZN'))
    expect(amznSuggestion).toBeUndefined()
  })
})
