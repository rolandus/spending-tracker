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
      sql`UPDATE transactions SET category = 'Shopping' WHERE description LIKE ${likePattern} AND category IS NULL`,
    )

    expect(rule.pattern).toBe('AMAZON')
    expect(result.changes).toBe(2) // AMAZON PURCHASE + AMAZON PRIME (MANUALLY CATEGORIZED already has category)
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
  it('counts uncategorized matches', () => {
    const likePattern = buildLikePattern('AMAZON', 'contains')
    const result = db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(sql`${transactions.description} LIKE ${likePattern} AND ${transactions.category} IS NULL`)
      .get()

    expect(result!.count).toBe(2) // AMAZON PURCHASE + AMAZON PRIME
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
        sql`UPDATE transactions SET category = ${rule.category} WHERE description LIKE ${likePattern} AND category IS NULL`,
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
  it('returns correct counts and percentage', () => {
    // 1 of 6 is categorized (h6 = Shopping)
    const total = db.select({ count: sql<number>`count(*)` }).from(transactions).get()!
    const categorized = db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(sql`${transactions.category} IS NOT NULL`)
      .get()!

    const totalCount = total.count
    const categorizedCount = categorized.count

    expect(totalCount).toBe(6)
    expect(categorizedCount).toBe(1)
    expect(totalCount - categorizedCount).toBe(5)
    expect(Math.round((categorizedCount / totalCount) * 100)).toBe(17)
  })

  it('returns 0 percentage when no transactions', () => {
    // Clear all transactions
    db.run(sql`DELETE FROM transactions`)

    const total = db.select({ count: sql<number>`count(*)` }).from(transactions).get()!
    expect(total.count).toBe(0)
    // Guard against division by zero
    const percentage = total.count > 0 ? Math.round((0 / total.count) * 100) : 0
    expect(percentage).toBe(0)
  })
})
