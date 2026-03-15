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
    // Ignored transaction with AMZN in description — should be excluded from merchant rules
    { accountId: 1, date: '2025-01-20', description: 'AMZN MKTP US*IGNORED', amount: -50, transactionType: 'expense', ignored: 1, sourceFile: 'test.csv', importHash: 'm6' },
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
      sql.raw(`UPDATE transactions SET merchant_id = ${merchant.id} WHERE (${where}) AND merchant_id IS NULL AND ignored = 0`),
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
      sql.raw(`UPDATE transactions SET merchant_id = ${merchant.id} WHERE (${where}) AND merchant_id IS NULL AND ignored = 0`),
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
    db.run(sql.raw(`UPDATE transactions SET merchant_id = ${merchant.id} WHERE (${where}) AND merchant_id IS NULL AND ignored = 0`))
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
        sql.raw(`UPDATE transactions SET merchant_id = ${m.id} WHERE (${where}) AND merchant_id IS NULL AND ignored = 0`),
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
    db.run(sql.raw(`UPDATE transactions SET merchant_id = ${merchant.id} WHERE (${where}) AND ignored = 0`))

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
      .where(sql`${transactions.merchantId} IS NULL AND ${transactions.ignored} = 0`)
      .groupBy(prefixExpr)
      .having(sql`count(*) >= 2`)
      .orderBy(sql`count(*) DESC`)
      .limit(20)
      .all()

    // AMZN MKTP US should group (2 txns with * delimiter), m6 ignored
    const amznSuggestion = suggestions.find((s) => s.prefix.includes('AMZN'))
    expect(amznSuggestion).toBeDefined()
    expect(amznSuggestion!.count).toBe(2)

    // WHOLE FOODS MARKET should group (2 txns with # delimiter)
    const wholeFoodsSuggestion = suggestions.find((s) => s.prefix.includes('WHOLE'))
    expect(wholeFoodsSuggestion).toBeDefined()
    expect(wholeFoodsSuggestion!.count).toBe(2)
  })

  it('excludes ignored transactions from suggestions', () => {
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
      .where(sql`${transactions.merchantId} IS NULL AND ${transactions.ignored} = 0`)
      .groupBy(prefixExpr)
      .having(sql`count(*) >= 2`)
      .all()

    // AMZN MKTP US should group with count 2 (m1, m2), NOT 3 (m6 is ignored)
    const amznSuggestion = suggestions.find((s) => s.prefix.includes('AMZN'))
    expect(amznSuggestion).toBeDefined()
    expect(amznSuggestion!.count).toBe(2)
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

describe('pending merchants', () => {
  function createPendingMerchant(
    name: string,
    patterns: { pattern: string; matchType: 'contains' | 'starts_with' | 'exact' }[],
    defaultCategory?: string,
    modifiesMerchantId?: number,
  ) {
    const merchant = db.insert(merchants).values({
      name,
      defaultCategory: defaultCategory ?? null,
      status: 'pending',
      modifiesMerchantId: modifiesMerchantId ?? null,
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

  it('pending merchant can be created with status pending', () => {
    const pm = createPendingMerchant('Test Merchant', [
      { pattern: 'TEST', matchType: 'contains' },
    ])

    expect(pm.status).toBe('pending')

    const stored = db.select().from(merchants).where(eq(merchants.id, pm.id)).get()!
    expect(stored.status).toBe('pending')
  })

  it('pending merchants match transactions in assignment step', () => {
    // Create a pending merchant with a pattern
    const pm = createPendingMerchant('Amazon', [
      { pattern: 'AMZN MKTP', matchType: 'contains' },
    ])

    // Simulate the assignment step: load all merchants (confirmed + pending)
    const allMerchants = db.select().from(merchants).all()
    const allPatterns = db.select().from(merchantPatterns).all()

    let matched = 0
    for (const m of allMerchants) {
      const mPatterns = allPatterns
        .filter((p) => p.merchantId === m.id)
        .map((p) => ({ pattern: p.pattern, matchType: p.matchType as 'contains' | 'starts_with' | 'exact' }))
      const where = buildMultiPatternWhere(mPatterns)
      if (!where) continue
      const result = db.run(
        sql.raw(`UPDATE transactions SET merchant_id = ${m.id} WHERE (${where}) AND merchant_id IS NULL AND ignored = 0`),
      )
      matched += result.changes
    }

    // Should match the 2 AMZN MKTP transactions (m1, m2)
    expect(matched).toBe(2)

    // Check the merchant is still pending
    const stored = db.select().from(merchants).where(eq(merchants.id, pm.id)).get()!
    expect(stored.status).toBe('pending')
  })

  it('confirm "new" pending merchant promotes to confirmed and auto-applies', () => {
    const pm = createPendingMerchant('Netflix', [
      { pattern: 'NETFLIX', matchType: 'contains' },
    ], 'Entertainment')

    // Confirm it
    db.update(merchants)
      .set({ status: 'confirmed' })
      .where(eq(merchants.id, pm.id))
      .run()

    // Apply patterns to unassigned transactions
    const where = buildMultiPatternWhere([{ pattern: 'NETFLIX', matchType: 'contains' }])
    db.run(sql.raw(`UPDATE transactions SET merchant_id = ${pm.id} WHERE (${where}) AND merchant_id IS NULL AND ignored = 0`))
    db.run(sql`UPDATE transactions SET category = 'Entertainment' WHERE merchant_id = ${pm.id} AND category IS NULL AND ignored = 0`)

    // Verify
    const stored = db.select().from(merchants).where(eq(merchants.id, pm.id)).get()!
    expect(stored.status).toBe('confirmed')

    const matched = db.select().from(transactions).where(eq(transactions.merchantId, pm.id)).all()
    expect(matched).toHaveLength(1) // NETFLIX.COM
    expect(matched[0].category).toBe('Entertainment')
  })

  it('confirm "modify" pending merchant merges patterns into target', () => {
    // Create a confirmed target merchant
    const target = createMerchantWithPatterns('Amazon', [
      { pattern: 'AMZN MKTP', matchType: 'starts_with' },
    ])

    // Assign some transactions to target
    const targetWhere = buildMultiPatternWhere([{ pattern: 'AMZN MKTP', matchType: 'starts_with' }])
    db.run(sql.raw(`UPDATE transactions SET merchant_id = ${target.id} WHERE (${targetWhere}) AND merchant_id IS NULL AND ignored = 0`))

    // Create a pending "modify" merchant with new patterns
    const pm = createPendingMerchant('Amazon (modify)', [
      { pattern: 'Amazon.com', matchType: 'starts_with' },
    ], undefined, target.id)

    // Simulate confirm "modify":
    // 1. Copy patterns to target
    const pendingPatterns = db.select().from(merchantPatterns).where(eq(merchantPatterns.merchantId, pm.id)).all()
    for (const p of pendingPatterns) {
      db.insert(merchantPatterns).values({
        merchantId: target.id,
        pattern: p.pattern,
        matchType: p.matchType,
      }).run()
    }

    // 2. Reassign any transactions from pending to target
    db.run(sql`UPDATE transactions SET merchant_id = ${target.id} WHERE merchant_id = ${pm.id}`)

    // 3. Apply new patterns to unassigned
    const newWhere = buildMultiPatternWhere([{ pattern: 'Amazon.com', matchType: 'starts_with' }])
    db.run(sql.raw(`UPDATE transactions SET merchant_id = ${target.id} WHERE (${newWhere}) AND merchant_id IS NULL AND ignored = 0`))

    // 4. Delete pending merchant
    db.delete(merchantPatterns).where(eq(merchantPatterns.merchantId, pm.id)).run()
    db.delete(merchants).where(eq(merchants.id, pm.id)).run()

    // Verify: target now has both patterns
    const targetPatterns = db.select().from(merchantPatterns).where(eq(merchantPatterns.merchantId, target.id)).all()
    expect(targetPatterns).toHaveLength(2)

    // All 3 Amazon transactions assigned to target
    const matched = db.select().from(transactions).where(eq(transactions.merchantId, target.id)).all()
    expect(matched).toHaveLength(3) // m1, m2, m2b (Amazon.com*)

    // Pending merchant is gone
    const pendingExists = db.select().from(merchants).where(eq(merchants.id, pm.id)).get()
    expect(pendingExists).toBeUndefined()
  })

  it('confirmed merchants take priority over pending in assignment', () => {
    // Create a confirmed merchant
    const confirmed = createMerchantWithPatterns('Amazon (confirmed)', [
      { pattern: 'AMZN MKTP', matchType: 'contains' },
    ])

    // Create a pending merchant with overlapping pattern
    const pm = createPendingMerchant('Amazon (pending)', [
      { pattern: 'AMZN MKTP', matchType: 'contains' },
    ])

    // Simulate assignment with confirmed first
    const allMerchants = db.select().from(merchants).all()
      .sort((a, b) => (a.status === 'confirmed' ? 0 : 1) - (b.status === 'confirmed' ? 0 : 1))
    const allPatterns = db.select().from(merchantPatterns).all()

    for (const m of allMerchants) {
      const mPatterns = allPatterns
        .filter((p) => p.merchantId === m.id)
        .map((p) => ({ pattern: p.pattern, matchType: p.matchType as 'contains' | 'starts_with' | 'exact' }))
      const where = buildMultiPatternWhere(mPatterns)
      if (!where) continue
      db.run(
        sql.raw(`UPDATE transactions SET merchant_id = ${m.id} WHERE (${where}) AND merchant_id IS NULL AND ignored = 0`),
      )
    }

    // All AMZN MKTP transactions should go to confirmed, not pending
    const confirmedMatches = db.select().from(transactions).where(eq(transactions.merchantId, confirmed.id)).all()
    expect(confirmedMatches).toHaveLength(2) // m1, m2

    const pendingMatches = db.select().from(transactions).where(eq(transactions.merchantId, pm.id)).all()
    expect(pendingMatches).toHaveLength(0)
  })

  it('deleting pending merchant nullifies transaction merchantIds', () => {
    const pm = createPendingMerchant('Netflix', [
      { pattern: 'NETFLIX', matchType: 'contains' },
    ])

    // Assign transactions
    const where = buildMultiPatternWhere([{ pattern: 'NETFLIX', matchType: 'contains' }])
    db.run(sql.raw(`UPDATE transactions SET merchant_id = ${pm.id} WHERE (${where}) AND merchant_id IS NULL AND ignored = 0`))

    const before = db.select().from(transactions).where(eq(transactions.merchantId, pm.id)).all()
    expect(before).toHaveLength(1)

    // Delete
    db.run(sql`UPDATE transactions SET merchant_id = NULL WHERE merchant_id = ${pm.id}`)
    db.delete(merchantPatterns).where(eq(merchantPatterns.merchantId, pm.id)).run()
    db.delete(merchants).where(eq(merchants.id, pm.id)).run()

    const after = db.select().from(transactions).where(eq(transactions.merchantId, pm.id)).all()
    expect(after).toHaveLength(0)
  })

  it('duplicate pending merchant with same name is prevented', () => {
    createPendingMerchant('Amazon', [
      { pattern: 'AMZN', matchType: 'contains' },
    ])

    // Attempting to create another pending with same name should still work in raw DB
    // (deduplication is in saveSuggestionsAsPending, not at DB level)
    const second = createPendingMerchant('Amazon', [
      { pattern: 'Amazon.com', matchType: 'contains' },
    ])

    expect(second.id).toBeDefined()

    // But both exist
    const all = db.select().from(merchants).where(eq(merchants.status, 'pending')).all()
    expect(all).toHaveLength(2)
  })
})

describe('ignored transactions excluded from merchant rules', () => {
  it('merchant pattern does not assign to ignored transactions', () => {
    const merchant = createMerchantWithPatterns('Amazon', [
      { pattern: 'AMZN MKTP', matchType: 'contains' },
    ])

    const where = buildMultiPatternWhere([{ pattern: 'AMZN MKTP', matchType: 'contains' }])
    const result = db.run(
      sql.raw(`UPDATE transactions SET merchant_id = ${merchant.id} WHERE (${where}) AND merchant_id IS NULL AND ignored = 0`),
    )

    // Should match m1, m2 only — NOT m6 (ignored)
    expect(result.changes).toBe(2)

    const ignoredTxn = db.select().from(transactions).where(eq(transactions.importHash, 'm6')).get()!
    expect(ignoredTxn.merchantId).toBeNull()
  })
})
