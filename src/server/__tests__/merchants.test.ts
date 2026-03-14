import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb, seedTestAccounts } from './setup'
import { merchants, merchantPatterns, transactions } from '../db/schema'
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

function buildMultiPatternWhere(patterns: { pattern: string; matchType: 'contains' | 'starts_with' | 'exact' }[]) {
  return patterns
    .filter((p) => p.pattern.trim())
    .map((p) => `description LIKE '${buildLikePattern(p.pattern, p.matchType)}'`)
    .join(' OR ')
}

function seedTransactions() {
  db.insert(transactions).values([
    { accountId: 1, date: '2025-01-15', description: 'AMZN MKTP US*AB1CD ORDER 1', amount: -42.5, transactionType: 'expense', sourceFile: 'test.csv', importHash: 'm1' },
    { accountId: 1, date: '2025-01-16', description: 'AMZN MKTP US*EF2GH ORDER 2', amount: -14.99, transactionType: 'expense', sourceFile: 'test.csv', importHash: 'm2' },
    { accountId: 1, date: '2025-01-16', description: 'Amazon.com*ZZ9YY ORDER 3', amount: -9.99, transactionType: 'expense', sourceFile: 'test.csv', importHash: 'm2b' },
    { accountId: 3, date: '2025-01-17', description: 'NETFLIX.COM', amount: -15.99, transactionType: 'expense', sourceFile: 'test.csv', importHash: 'm3' },
    { accountId: 3, date: '2025-01-18', description: 'WHOLE FOODS MARKET #1234 AUSTIN TX', amount: -85.0, transactionType: 'expense', sourceFile: 'test.csv', importHash: 'm4' },
    { accountId: 3, date: '2025-01-19', description: 'WHOLE FOODS MARKET #5678 DALLAS TX', amount: -45.0, transactionType: 'expense', sourceFile: 'test.csv', importHash: 'm5' },
  ]).run()
}

function createMerchantWithPatterns(
  name: string,
  patterns: { pattern: string; matchType: 'contains' | 'starts_with' | 'exact' }[],
  defaultCategory?: string,
) {
  const merchant = db.insert(merchants).values({
    name,
    defaultCategory: defaultCategory ?? null,
  }).returning().get()

  for (const p of patterns) {
    db.insert(merchantPatterns).values({
      merchantId: merchant.id,
      pattern: p.pattern,
      matchType: p.matchType,
    }).run()
  }

  return merchant
}

beforeEach(() => {
  const testDb = createTestDb()
  db = testDb.db
  seedTestAccounts(db)
  seedTransactions()
})

describe('createMerchant with patterns', () => {
  it('assigns merchant_id to matching transactions using single pattern', () => {
    const merchant = createMerchantWithPatterns('Amazon', [
      { pattern: 'AMZN MKTP', matchType: 'contains' },
    ])

    const where = buildMultiPatternWhere([{ pattern: 'AMZN MKTP', matchType: 'contains' }])
    const result = db.run(
      sql.raw(`UPDATE transactions SET merchant_id = ${merchant.id} WHERE (${where}) AND merchant_id IS NULL`),
    )

    expect(result.changes).toBe(2)

    const matched = db.select().from(transactions).where(eq(transactions.merchantId, merchant.id)).all()
    expect(matched).toHaveLength(2)
  })

  it('assigns merchant_id using multiple OR patterns', () => {
    const merchant = createMerchantWithPatterns('Amazon', [
      { pattern: 'AMZN MKTP', matchType: 'starts_with' },
      { pattern: 'Amazon.com', matchType: 'starts_with' },
    ])

    const where = buildMultiPatternWhere([
      { pattern: 'AMZN MKTP', matchType: 'starts_with' },
      { pattern: 'Amazon.com', matchType: 'starts_with' },
    ])
    const result = db.run(
      sql.raw(`UPDATE transactions SET merchant_id = ${merchant.id} WHERE (${where}) AND merchant_id IS NULL`),
    )

    // Should match 3: two AMZN MKTP + one Amazon.com
    expect(result.changes).toBe(3)
  })

  it('auto-categorizes when defaultCategory is provided', () => {
    const merchant = createMerchantWithPatterns(
      'Amazon',
      [{ pattern: 'AMZN MKTP', matchType: 'contains' }],
      'Shopping',
    )

    const where = buildMultiPatternWhere([{ pattern: 'AMZN MKTP', matchType: 'contains' }])
    db.run(sql.raw(`UPDATE transactions SET merchant_id = ${merchant.id} WHERE (${where}) AND merchant_id IS NULL`))
    const catResult = db.run(
      sql`UPDATE transactions SET category = ${merchant.defaultCategory} WHERE merchant_id = ${merchant.id} AND category IS NULL`,
    )

    expect(catResult.changes).toBe(2)

    const t = db.select().from(transactions).where(eq(transactions.importHash, 'm1')).get()!
    expect(t.category).toBe('Shopping')
    expect(t.merchantId).toBe(merchant.id)
  })

  it('does not categorize already-categorized transactions', () => {
    db.update(transactions).set({ category: 'Existing' }).where(eq(transactions.importHash, 'm1')).run()

    const merchant = createMerchantWithPatterns(
      'Amazon',
      [{ pattern: 'AMZN MKTP', matchType: 'contains' }],
      'Shopping',
    )

    const where = buildMultiPatternWhere([{ pattern: 'AMZN MKTP', matchType: 'contains' }])
    db.run(sql.raw(`UPDATE transactions SET merchant_id = ${merchant.id} WHERE (${where}) AND merchant_id IS NULL`))
    db.run(sql`UPDATE transactions SET category = 'Shopping' WHERE merchant_id = ${merchant.id} AND category IS NULL`)

    const t = db.select().from(transactions).where(eq(transactions.importHash, 'm1')).get()!
    expect(t.category).toBe('Existing')
  })
})

describe('applyMerchantRules', () => {
  it('only assigns to unassigned transactions', () => {
    const amazon = createMerchantWithPatterns('Amazon', [
      { pattern: 'AMZN MKTP', matchType: 'contains' },
    ])
    const netflix = createMerchantWithPatterns('Netflix', [
      { pattern: 'NETFLIX', matchType: 'contains' },
    ])

    // Manually assign m3 to Netflix
    db.update(transactions).set({ merchantId: netflix.id }).where(eq(transactions.importHash, 'm3')).run()

    // Apply all merchant rules
    const allMerchants = db.select().from(merchants).all()
    const allPatterns = db.select().from(merchantPatterns).all()
    let totalMatched = 0
    for (const m of allMerchants) {
      const mPatterns = allPatterns
        .filter((p) => p.merchantId === m.id)
        .map((p) => ({ pattern: p.pattern, matchType: p.matchType as 'contains' | 'starts_with' | 'exact' }))
      const where = buildMultiPatternWhere(mPatterns)
      if (!where) continue
      const result = db.run(
        sql.raw(`UPDATE transactions SET merchant_id = ${m.id} WHERE (${where}) AND merchant_id IS NULL`),
      )
      totalMatched += result.changes
    }

    expect(totalMatched).toBe(2) // m1 and m2 (AMZN), m3 already assigned

    // m3 should still be Netflix
    const t = db.select().from(transactions).where(eq(transactions.importHash, 'm3')).get()!
    expect(t.merchantId).toBe(netflix.id)
  })
})

describe('deleteMerchant', () => {
  it('nullifies merchant_id on affected transactions and removes patterns', () => {
    const merchant = createMerchantWithPatterns('Amazon', [
      { pattern: 'AMZN MKTP', matchType: 'contains' },
    ])

    const where = buildMultiPatternWhere([{ pattern: 'AMZN MKTP', matchType: 'contains' }])
    db.run(sql.raw(`UPDATE transactions SET merchant_id = ${merchant.id} WHERE (${where})`))

    let matched = db.select().from(transactions).where(eq(transactions.merchantId, merchant.id)).all()
    expect(matched).toHaveLength(2)

    // Delete merchant
    db.run(sql`UPDATE transactions SET merchant_id = NULL WHERE merchant_id = ${merchant.id}`)
    db.delete(merchantPatterns).where(eq(merchantPatterns.merchantId, merchant.id)).run()
    db.delete(merchants).where(eq(merchants.id, merchant.id)).run()

    expect(db.select().from(merchants).all()).toHaveLength(0)
    expect(db.select().from(merchantPatterns).all()).toHaveLength(0)

    matched = db.select().from(transactions).where(eq(transactions.merchantId, merchant.id)).all()
    expect(matched).toHaveLength(0)
  })
})

describe('suggestMerchants', () => {
  it('groups unmatched transactions by smart prefix', () => {
    const prefixExpr = sql`UPPER(CASE
      WHEN INSTR(description, '*') > 0 THEN SUBSTR(description, 1, INSTR(description, '*') - 1)
      WHEN INSTR(description, '#') > 0 THEN SUBSTR(description, 1, INSTR(description, '#') - 1)
      ELSE SUBSTR(description, 1, 20)
    END)`

    const suggestions = db
      .select({
        prefix: sql<string>`${prefixExpr}`,
        count: sql<number>`count(*)`,
        sample: sql<string>`description`,
      })
      .from(transactions)
      .where(isNull(transactions.merchantId))
      .groupBy(prefixExpr)
      .having(sql`count(*) >= 2`)
      .orderBy(sql`count(*) DESC`)
      .limit(20)
      .all()

    // AMZN MKTP US should group (2 txns with * delimiter)
    const amznSuggestion = suggestions.find((s) => s.prefix.includes('AMZN'))
    expect(amznSuggestion).toBeDefined()
    expect(amznSuggestion!.count).toBe(2)

    // WHOLE FOODS MARKET should group (2 txns with # delimiter)
    const wholeFoodsSuggestion = suggestions.find((s) => s.prefix.includes('WHOLE'))
    expect(wholeFoodsSuggestion).toBeDefined()
    expect(wholeFoodsSuggestion!.count).toBe(2)
  })

  it('excludes transactions with a merchant already assigned', () => {
    const merchant = createMerchantWithPatterns('Amazon', [
      { pattern: 'AMZN MKTP', matchType: 'contains' },
    ])

    const where = buildMultiPatternWhere([{ pattern: 'AMZN MKTP', matchType: 'contains' }])
    db.run(sql.raw(`UPDATE transactions SET merchant_id = ${merchant.id} WHERE (${where})`))

    const prefixExpr = sql`UPPER(CASE
      WHEN INSTR(description, '*') > 0 THEN SUBSTR(description, 1, INSTR(description, '*') - 1)
      WHEN INSTR(description, '#') > 0 THEN SUBSTR(description, 1, INSTR(description, '#') - 1)
      ELSE SUBSTR(description, 1, 20)
    END)`

    const suggestions = db
      .select({
        prefix: sql<string>`${prefixExpr}`,
        count: sql<number>`count(*)`,
      })
      .from(transactions)
      .where(isNull(transactions.merchantId))
      .groupBy(prefixExpr)
      .having(sql`count(*) >= 2`)
      .all()

    const amznSuggestion = suggestions.find((s) => s.prefix.includes('AMZN'))
    expect(amznSuggestion).toBeUndefined()
  })
})
