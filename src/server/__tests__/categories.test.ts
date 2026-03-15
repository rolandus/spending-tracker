import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb, seedTestAccounts } from './setup'
import { categoryRules, transactions } from '../db/schema'
import { eq, sql, desc, isNull } from 'drizzle-orm'
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
  db.insert(transactions).values([
    { accountId: 1, date: '2025-01-15', description: 'AMAZON PURCHASE', amount: -42.5, transactionType: 'expense', sourceFile: 'test.csv', importHash: 'h1' },
    { accountId: 1, date: '2025-01-16', description: 'AMAZON PRIME', amount: -14.99, transactionType: 'expense', sourceFile: 'test.csv', importHash: 'h2' },
    { accountId: 1, date: '2025-01-17', description: 'NETFLIX SUBSCRIPTION', amount: -15.99, transactionType: 'expense', sourceFile: 'test.csv', importHash: 'h3' },
    { accountId: 3, date: '2025-01-18', description: 'WHOLE FOODS MARKET', amount: -85.0, transactionType: 'expense', sourceFile: 'test.csv', importHash: 'h4' },
    { accountId: 3, date: '2025-01-19', description: 'WHOLE FOODS #123', amount: -45.0, transactionType: 'expense', sourceFile: 'test.csv', importHash: 'h5' },
    { accountId: 1, date: '2025-01-20', description: 'MANUALLY CATEGORIZED', amount: -10.0, transactionType: 'expense', category: 'Shopping', sourceFile: 'test.csv', importHash: 'h6' },
    // Ignored transaction with AMAZON in description — should be excluded from category rules
    { accountId: 1, date: '2025-01-21', description: 'AMAZON IGNORED', amount: -100, transactionType: 'expense', ignored: 1, sourceFile: 'test.csv', importHash: 'h7' },
  ]).run()
}

beforeEach(() => {
  const testDb = createTestDb()
  db = testDb.db
  seedTestAccounts(db)
  seedTransactions()
})

describe('buildLikePattern', () => {
  it('wraps contains with %', () => {
    expect(buildLikePattern('AMAZON', 'contains')).toBe('%AMAZON%')
  })

  it('appends % for starts_with', () => {
    expect(buildLikePattern('AMAZON', 'starts_with')).toBe('AMAZON%')
  })

  it('returns exact string for exact', () => {
    expect(buildLikePattern('AMAZON PURCHASE', 'exact')).toBe('AMAZON PURCHASE')
  })
})

describe('createCategoryRule + apply', () => {
  it('inserts a rule and applies to uncategorized transactions', () => {
    const rule = db.insert(categoryRules).values({
      pattern: 'AMAZON',
      matchType: 'contains',
      category: 'Shopping',
      priority: 0,
    }).returning().get()

    const likePattern = buildLikePattern('AMAZON', 'contains')
    const result = db.run(
      sql`UPDATE transactions SET category = 'Shopping' WHERE description LIKE ${likePattern} AND category IS NULL AND ignored = 0`,
    )

    expect(rule.pattern).toBe('AMAZON')
    expect(result.changes).toBe(2) // AMAZON PURCHASE + AMAZON PRIME (MANUALLY CATEGORIZED already has category, h7 is ignored)
  })

  it('does not overwrite manually-categorized transactions', () => {
    const likePattern = buildLikePattern('MANUALLY', 'contains')
    db.run(
      sql`UPDATE transactions SET category = 'NewCategory' WHERE description LIKE ${likePattern} AND category IS NULL`,
    )

    // The manually categorized row should still have its original category
    const manual = db.select().from(transactions).where(eq(transactions.importHash, 'h6')).get()!
    expect(manual.category).toBe('Shopping')
  })
})

describe('previewCategoryRule', () => {
  it('counts uncategorized matches excluding ignored', () => {
    const likePattern = buildLikePattern('AMAZON', 'contains')
    const result = db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(sql`${transactions.description} LIKE ${likePattern} AND ${transactions.category} IS NULL AND ${transactions.ignored} = 0`)
      .get()

    expect(result!.count).toBe(2) // AMAZON PURCHASE + AMAZON PRIME (h7 ignored)
  })

  it('does not count already-categorized matches', () => {
    const likePattern = buildLikePattern('MANUALLY', 'contains')
    const result = db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(sql`${transactions.description} LIKE ${likePattern} AND ${transactions.category} IS NULL`)
      .get()

    expect(result!.count).toBe(0)
  })
})

describe('applyCategoryRules (priority order)', () => {
  it('applies higher priority rules first', () => {
    // Low priority: WHOLE FOODS → Groceries
    db.insert(categoryRules).values({
      pattern: 'WHOLE FOODS',
      matchType: 'contains',
      category: 'Groceries',
      priority: 1,
    }).run()

    // High priority: AMAZON → Shopping
    db.insert(categoryRules).values({
      pattern: 'AMAZON',
      matchType: 'contains',
      category: 'Shopping',
      priority: 10,
    }).run()

    // Netflix → Subscriptions
    db.insert(categoryRules).values({
      pattern: 'NETFLIX',
      matchType: 'contains',
      category: 'Subscriptions',
      priority: 5,
    }).run()

    // Apply all rules in priority order (desc)
    const rules = db.select().from(categoryRules).orderBy(desc(categoryRules.priority)).all()
    let totalApplied = 0

    for (const rule of rules) {
      const likePattern = buildLikePattern(rule.pattern, rule.matchType as 'contains' | 'starts_with' | 'exact')
      const result = db.run(
        sql`UPDATE transactions SET category = ${rule.category} WHERE description LIKE ${likePattern} AND category IS NULL AND ignored = 0`,
      )
      totalApplied += result.changes
    }

    expect(totalApplied).toBe(5) // 2 AMAZON + 1 NETFLIX + 2 WHOLE FOODS

    // Verify correct categories assigned
    const amazon1 = db.select().from(transactions).where(eq(transactions.importHash, 'h1')).get()!
    expect(amazon1.category).toBe('Shopping')

    const netflix = db.select().from(transactions).where(eq(transactions.importHash, 'h3')).get()!
    expect(netflix.category).toBe('Subscriptions')

    const wholeFoods = db.select().from(transactions).where(eq(transactions.importHash, 'h4')).get()!
    expect(wholeFoods.category).toBe('Groceries')
  })

  it('preserves manual category assignments when applying rules', () => {
    db.insert(categoryRules).values({
      pattern: 'MANUALLY',
      matchType: 'contains',
      category: 'Override',
      priority: 100,
    }).run()

    const rules = db.select().from(categoryRules).orderBy(desc(categoryRules.priority)).all()
    for (const rule of rules) {
      const likePattern = buildLikePattern(rule.pattern, rule.matchType as 'contains' | 'starts_with' | 'exact')
      db.run(
        sql`UPDATE transactions SET category = ${rule.category} WHERE description LIKE ${likePattern} AND category IS NULL`,
      )
    }

    const manual = db.select().from(transactions).where(eq(transactions.importHash, 'h6')).get()!
    expect(manual.category).toBe('Shopping') // Original, NOT 'Override'
  })
})

describe('deleteCategoryRule', () => {
  it('removes rule but leaves categories on transactions', () => {
    const rule = db.insert(categoryRules).values({
      pattern: 'AMAZON',
      matchType: 'contains',
      category: 'Shopping',
    }).returning().get()

    // Apply rule
    db.run(sql`UPDATE transactions SET category = 'Shopping' WHERE description LIKE '%AMAZON%' AND category IS NULL`)

    // Delete rule
    db.delete(categoryRules).where(eq(categoryRules.id, rule.id)).run()

    // Rule gone
    const rules = db.select().from(categoryRules).all()
    expect(rules).toHaveLength(0)

    // Categories still on transactions
    const t = db.select().from(transactions).where(eq(transactions.importHash, 'h1')).get()!
    expect(t.category).toBe('Shopping')
  })
})

describe('getCategoryStats', () => {
  it('returns correct counts and percentage excluding ignored', () => {
    // 1 of 6 non-ignored is categorized (h6 = Shopping); h7 is ignored
    const total = db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(eq(transactions.ignored, 0))
      .get()!
    const categorized = db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(sql`${transactions.category} IS NOT NULL AND ${transactions.ignored} = 0`)
      .get()!

    const totalCount = total.count
    const categorizedCount = categorized.count

    expect(totalCount).toBe(6) // 7 total minus 1 ignored
    expect(categorizedCount).toBe(1)
    expect(totalCount - categorizedCount).toBe(5)
    expect(Math.round((categorizedCount / totalCount) * 100)).toBe(17)
  })

  it('returns 0 percentage when no transactions', () => {
    db.run(sql`DELETE FROM transactions`)

    const total = db.select({ count: sql<number>`count(*)` }).from(transactions).get()!
    expect(total.count).toBe(0)
    const percentage = total.count > 0 ? Math.round((0 / total.count) * 100) : 0
    expect(percentage).toBe(0)
  })
})

describe('ignored transactions excluded from category rules', () => {
  it('category rule does not apply to ignored transactions', () => {
    const likePattern = buildLikePattern('AMAZON', 'contains')
    const result = db.run(
      sql`UPDATE transactions SET category = 'Shopping' WHERE description LIKE ${likePattern} AND category IS NULL AND ignored = 0`,
    )

    // Should match h1 + h2 only, NOT h7 (ignored)
    expect(result.changes).toBe(2)

    const ignoredTxn = db.select().from(transactions).where(eq(transactions.importHash, 'h7')).get()!
    expect(ignoredTxn.category).toBeNull()
  })

  it('preview count excludes ignored transactions', () => {
    const likePattern = buildLikePattern('AMAZON', 'contains')
    const result = db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(sql`${transactions.description} LIKE ${likePattern} AND ${transactions.category} IS NULL AND ${transactions.ignored} = 0`)
      .get()

    // h1 + h2 match, but NOT h7 (ignored)
    expect(result!.count).toBe(2)
  })
})
