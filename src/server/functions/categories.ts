import { createServerFn } from '@tanstack/react-start'
import { db } from '../db'
import { categories, categoryRules, transactions } from '../db/schema'
import { eq, like, sql, isNull, desc, and, notInArray, lt, asc } from 'drizzle-orm'
import type { CategoryRule } from '../db/schema'

/**
 * Get all categories from the DB.
 */
export const getCategories = createServerFn({ method: 'GET' }).handler(async () => {
  return db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name)).all()
})

/**
 * Get categories with transaction counts.
 */
export const getCategoriesWithCounts = createServerFn({ method: 'GET' }).handler(async () => {
  const result = db
    .select({
      id: categories.id,
      name: categories.name,
      sortOrder: categories.sortOrder,
      transactionCount: sql<number>`(SELECT count(*) FROM transactions WHERE category = ${categories.name} AND ignored = 0)`,
      merchantCount: sql<number>`(SELECT count(DISTINCT merchant_id) FROM merchant_patterns WHERE default_category = ${categories.name})`,
    })
    .from(categories)
    .orderBy(asc(categories.sortOrder), asc(categories.name))
    .all()

  return result
})

/**
 * Create a new category.
 */
export const createCategory = createServerFn({ method: 'POST' })
  .inputValidator((data: { name: string }) => data)
  .handler(async ({ data }) => {
    const maxOrder = db
      .select({ max: sql<number>`COALESCE(MAX(sort_order), 0)` })
      .from(categories)
      .get()

    const row = db
      .insert(categories)
      .values({ name: data.name.trim(), sortOrder: (maxOrder?.max ?? 0) + 1 })
      .returning()
      .get()

    return row
  })

/**
 * Rename a category. Updates all transactions and merchant defaults that used the old name.
 */
export const renameCategory = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: number; newName: string }) => data)
  .handler(async ({ data }) => {
    const existing = db.select().from(categories).where(eq(categories.id, data.id)).get()
    if (!existing) throw new Error('Category not found')

    const oldName = existing.name
    const newName = data.newName.trim()

    db.update(categories).set({ name: newName }).where(eq(categories.id, data.id)).run()

    // Update transactions
    const txResult = db.run(
      sql`UPDATE transactions SET category = ${newName} WHERE category = ${oldName} AND ignored = 0`,
    )

    // Update merchant pattern defaults
    const mResult = db.run(
      sql`UPDATE merchant_patterns SET default_category = ${newName} WHERE default_category = ${oldName}`,
    )

    // Update category rules
    const rResult = db.run(
      sql`UPDATE category_rules SET category = ${newName} WHERE category = ${oldName}`,
    )

    return {
      success: true,
      transactionsUpdated: txResult.changes,
      merchantsUpdated: mResult.changes,
      rulesUpdated: rResult.changes,
    }
  })

/**
 * Delete a category. Uncategorizes all transactions that used it.
 */
export const deleteCategory = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    const existing = db.select().from(categories).where(eq(categories.id, data.id)).get()
    if (!existing) throw new Error('Category not found')

    // Uncategorize transactions
    const txResult = db.run(
      sql`UPDATE transactions SET category = NULL WHERE category = ${existing.name}`,
    )

    // Clear merchant pattern defaults
    const mResult = db.run(
      sql`UPDATE merchant_patterns SET default_category = NULL WHERE default_category = ${existing.name}`,
    )

    // Delete category rules that used this category
    const rResult = db.run(
      sql`DELETE FROM category_rules WHERE category = ${existing.name}`,
    )

    // Delete the category
    db.delete(categories).where(eq(categories.id, data.id)).run()

    return {
      success: true,
      transactionsUncategorized: txResult.changes,
      merchantsCleared: mResult.changes,
      rulesDeleted: rResult.changes,
    }
  })

/**
 * List all category rules, ordered by priority descending.
 */
export const getCategoryRules = createServerFn({ method: 'GET' }).handler(async () => {
  return db.select().from(categoryRules).orderBy(desc(categoryRules.priority)).all()
})

/**
 * Preview how many uncategorized transactions match a pattern.
 */
export const previewCategoryRule = createServerFn({ method: 'GET' })
  .inputValidator(
    (data: {
      pattern: string
      matchType: 'contains' | 'starts_with' | 'exact'
      expenseOnly?: boolean
    }) => data,
  )
  .handler(async ({ data }) => {
    const likePattern = buildLikePattern(data.pattern, data.matchType)

    const conditions = data.expenseOnly
      ? and(
          sql`${transactions.description} LIKE ${likePattern}`,
          isNull(transactions.category),
          eq(transactions.ignored, 0),
          notInArray(transactions.transactionType, ['internal_transfer', 'cc_payment']),
          lt(transactions.amount, 0),
        )
      : and(
          sql`${transactions.description} LIKE ${likePattern}`,
          isNull(transactions.category),
          eq(transactions.ignored, 0),
        )

    const result = db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(conditions)
      .get()

    return { matchCount: result?.count ?? 0 }
  })

/**
 * Create a category rule and immediately apply it to uncategorized transactions.
 */
export const createCategoryRule = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: {
      pattern: string
      matchType?: 'contains' | 'starts_with' | 'exact'
      category: string
      priority?: number
    }) => data,
  )
  .handler(async ({ data }) => {
    const matchType = data.matchType ?? 'contains'

    // Insert the rule
    const rule = db
      .insert(categoryRules)
      .values({
        pattern: data.pattern,
        matchType,
        category: data.category,
        priority: data.priority ?? 0,
      })
      .returning()
      .get()

    // Apply immediately to uncategorized transactions
    const likePattern = buildLikePattern(data.pattern, matchType)
    const result = db.run(
      sql`UPDATE transactions SET category = ${data.category} WHERE description LIKE ${likePattern} AND category IS NULL AND ignored = 0`,
    )

    return { rule, appliedCount: result.changes }
  })

/**
 * Update an existing category rule.
 */
export const updateCategoryRule = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: {
      id: number
      pattern?: string
      matchType?: 'contains' | 'starts_with' | 'exact'
      category?: string
      priority?: number
    }) => data,
  )
  .handler(async ({ data }) => {
    const { id, ...fields } = data
    const updates: Record<string, unknown> = {}

    if (fields.pattern !== undefined) updates.pattern = fields.pattern
    if (fields.matchType !== undefined) updates.matchType = fields.matchType
    if (fields.category !== undefined) updates.category = fields.category
    if (fields.priority !== undefined) updates.priority = fields.priority

    db.update(categoryRules).set(updates).where(eq(categoryRules.id, id)).run()

    return { success: true }
  })

/**
 * Delete a category rule.
 */
export const deleteCategoryRule = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    db.delete(categoryRules).where(eq(categoryRules.id, data.id)).run()
    return { success: true }
  })

/**
 * Re-run all rules against uncategorized transactions, in priority order.
 * Only touches rows where category IS NULL, so manual assignments are preserved.
 */
export const applyCategoryRules = createServerFn({ method: 'POST' }).handler(async () => {
  const rules = db
    .select()
    .from(categoryRules)
    .orderBy(desc(categoryRules.priority))
    .all()

  let totalApplied = 0

  for (const rule of rules) {
    const likePattern = buildLikePattern(rule.pattern, rule.matchType)
    const result = db.run(
      sql`UPDATE transactions SET category = ${rule.category} WHERE description LIKE ${likePattern} AND category IS NULL AND ignored = 0`,
    )
    totalApplied += result.changes
  }

  return { totalApplied, rulesProcessed: rules.length }
})

/**
 * Suggest category rules by grouping uncategorized transactions by description prefix.
 */
export const suggestCategories = createServerFn({ method: 'GET' }).handler(async () => {
  // Group by the "stable" part of the description: everything before the
  // first '*' or '#' (which usually starts a unique order/check number),
  // falling back to the first 20 characters.
  const prefixExpr = sql`UPPER(CASE
    WHEN INSTR(description, '*') > 0 THEN SUBSTR(description, 1, INSTR(description, '*') - 1)
    WHEN INSTR(description, '#') > 0 THEN SUBSTR(description, 1, INSTR(description, '#') - 1)
    ELSE SUBSTR(description, 1, 20)
  END)`

  return db
    .select({
      prefix: sql<string>`${prefixExpr}`,
      count: sql<number>`count(*)`,
      sample: sql<string>`description`,
    })
    .from(transactions)
    .where(
      and(
        isNull(transactions.category),
        eq(transactions.ignored, 0),
        notInArray(transactions.transactionType, ['internal_transfer', 'cc_payment']),
        lt(transactions.amount, 0),
      ),
    )
    .groupBy(prefixExpr)
    .having(sql`count(*) >= 2`)
    .orderBy(desc(sql`count(*)`))
    .limit(30)
    .all()
})

/**
 * Get categorization stats.
 */
export const getCategoryStats = createServerFn({ method: 'GET' }).handler(async () => {
  const total = db
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(eq(transactions.ignored, 0))
    .get()

  const categorized = db
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(and(sql`${transactions.category} IS NOT NULL`, eq(transactions.ignored, 0)))
    .get()

  const totalCount = total?.count ?? 0
  const categorizedCount = categorized?.count ?? 0

  return {
    total: totalCount,
    categorized: categorizedCount,
    uncategorized: totalCount - categorizedCount,
    percentage: totalCount > 0 ? Math.round((categorizedCount / totalCount) * 100) : 0,
  }
})

function buildLikePattern(
  pattern: string,
  matchType: 'contains' | 'starts_with' | 'exact',
): string {
  switch (matchType) {
    case 'contains':
      return `%${pattern}%`
    case 'starts_with':
      return `${pattern}%`
    case 'exact':
      return pattern
  }
}
