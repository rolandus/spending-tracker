import { createServerFn } from '@tanstack/react-start'
import { db } from '../db'
import { categoryRules, transactions } from '../db/schema'
import { eq, like, sql, isNull, desc } from 'drizzle-orm'
import type { CategoryRule } from '../db/schema'

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
    (data: { pattern: string; matchType: 'contains' | 'starts_with' | 'exact' }) => data,
  )
  .handler(async ({ data }) => {
    const likePattern = buildLikePattern(data.pattern, data.matchType)

    const result = db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(sql`${transactions.description} LIKE ${likePattern} AND ${transactions.category} IS NULL`)
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
      sql`UPDATE transactions SET category = ${data.category} WHERE description LIKE ${likePattern} AND category IS NULL`,
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
      sql`UPDATE transactions SET category = ${rule.category} WHERE description LIKE ${likePattern} AND category IS NULL`,
    )
    totalApplied += result.changes
  }

  return { totalApplied, rulesProcessed: rules.length }
})

/**
 * Suggest category rules by grouping uncategorized transactions by description prefix.
 */
export const suggestCategories = createServerFn({ method: 'GET' }).handler(async () => {
  return db
    .select({
      prefix: sql<string>`UPPER(SUBSTR(description, 1, 20))`,
      count: sql<number>`count(*)`,
      sample: sql<string>`description`,
    })
    .from(transactions)
    .where(isNull(transactions.category))
    .groupBy(sql`UPPER(SUBSTR(description, 1, 20))`)
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
    .get()

  const categorized = db
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(sql`${transactions.category} IS NOT NULL`)
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
