import { createServerFn } from '@tanstack/react-start'
import { db } from '../db'
import { merchants, transactions } from '../db/schema'
import { eq, sql, desc, isNull } from 'drizzle-orm'

/**
 * List all merchants.
 */
export const getMerchants = createServerFn({ method: 'GET' }).handler(async () => {
  const rows = db.select().from(merchants).orderBy(merchants.name).all()

  // Also count how many transactions each merchant is linked to
  const counts = db
    .select({
      merchantId: transactions.merchantId,
      count: sql<number>`count(*)`,
    })
    .from(transactions)
    .where(sql`${transactions.merchantId} IS NOT NULL`)
    .groupBy(transactions.merchantId)
    .all()

  const countMap = new Map(counts.map((c) => [c.merchantId, c.count]))

  return rows.map((m) => ({
    ...m,
    transactionCount: countMap.get(m.id) ?? 0,
  }))
})

/**
 * Create a merchant and apply it to matching transactions.
 * Also auto-categorizes if defaultCategory is provided.
 */
export const createMerchant = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: {
      name: string
      pattern: string
      matchType?: 'contains' | 'starts_with' | 'exact'
      defaultCategory?: string | null
    }) => data,
  )
  .handler(async ({ data }) => {
    const matchType = data.matchType ?? 'contains'

    const merchant = db
      .insert(merchants)
      .values({
        name: data.name,
        pattern: data.pattern,
        matchType,
        defaultCategory: data.defaultCategory ?? null,
      })
      .returning()
      .get()

    // Apply to matching transactions
    const likePattern = buildLikePattern(data.pattern, matchType)
    const matchResult = db.run(
      sql`UPDATE transactions SET merchant_id = ${merchant.id} WHERE description LIKE ${likePattern} AND merchant_id IS NULL`,
    )

    // If there's a default category, also categorize uncategorized matches
    let categorized = 0
    if (data.defaultCategory) {
      const catResult = db.run(
        sql`UPDATE transactions SET category = ${data.defaultCategory} WHERE merchant_id = ${merchant.id} AND category IS NULL`,
      )
      categorized = catResult.changes
    }

    return { merchant, matched: matchResult.changes, categorized }
  })

/**
 * Update a merchant.
 */
export const updateMerchant = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: {
      id: number
      name?: string
      pattern?: string
      matchType?: 'contains' | 'starts_with' | 'exact'
      defaultCategory?: string | null
    }) => data,
  )
  .handler(async ({ data }) => {
    const { id, ...fields } = data
    const updates: Record<string, unknown> = {}

    if (fields.name !== undefined) updates.name = fields.name
    if (fields.pattern !== undefined) updates.pattern = fields.pattern
    if (fields.matchType !== undefined) updates.matchType = fields.matchType
    if ('defaultCategory' in fields) updates.defaultCategory = fields.defaultCategory

    db.update(merchants).set(updates).where(eq(merchants.id, id)).run()
    return { success: true }
  })

/**
 * Delete a merchant, clearing merchantId on affected transactions.
 */
export const deleteMerchant = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    db.run(sql`UPDATE transactions SET merchant_id = NULL WHERE merchant_id = ${data.id}`)
    db.delete(merchants).where(eq(merchants.id, data.id)).run()
    return { success: true }
  })

/**
 * Re-scan all transactions against all merchant patterns.
 * Only sets merchantId on transactions where it's currently NULL.
 */
export const applyMerchantRules = createServerFn({ method: 'POST' }).handler(async () => {
  const allMerchants = db.select().from(merchants).all()
  let totalMatched = 0

  for (const m of allMerchants) {
    const likePattern = buildLikePattern(m.pattern, m.matchType)
    const result = db.run(
      sql`UPDATE transactions SET merchant_id = ${m.id} WHERE description LIKE ${likePattern} AND merchant_id IS NULL`,
    )
    totalMatched += result.changes
  }

  return { totalMatched, merchantsProcessed: allMerchants.length }
})

/**
 * Suggest merchants by grouping common unmatched description fragments.
 * Returns the top frequent description prefixes that don't have a merchant assigned.
 */
export const suggestMerchants = createServerFn({ method: 'GET' }).handler(async () => {
  // Get descriptions without a merchant, group by first 20 chars
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
    .orderBy(desc(sql`count(*)`))
    .limit(20)
    .all()

  return suggestions
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
