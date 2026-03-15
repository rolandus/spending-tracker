import { createServerFn } from '@tanstack/react-start'
import { db } from '../db'
import { merchants, merchantPatterns, transactions } from '../db/schema'
import { eq, sql, desc, isNull, and, lt, notInArray } from 'drizzle-orm'

export type { PatternInput } from '../../shared/pattern-matching'
export { matchesPattern, matchesAnyPattern } from '../../shared/pattern-matching'
import type { PatternInput } from '../../shared/pattern-matching'

/**
 * Get all pending merchants with their patterns.
 */
export const getPendingMerchants = createServerFn({ method: 'GET' }).handler(async () => {
  const rows = db
    .select()
    .from(merchants)
    .where(eq(merchants.status, 'pending'))
    .orderBy(merchants.name)
    .all()

  const patterns = db.select().from(merchantPatterns).all()

  return rows.map((m) => ({
    id: m.id,
    name: m.name,
    defaultCategory: m.defaultCategory,
    status: 'pending' as const,
    modifiesMerchantId: m.modifiesMerchantId,
    patterns: patterns
      .filter((p) => p.merchantId === m.id)
      .map((p) => ({
        pattern: p.pattern,
        matchType: p.matchType as 'contains' | 'starts_with' | 'exact',
      })),
  }))
})

/**
 * List all merchants with their patterns and transaction counts.
 */
export const getMerchants = createServerFn({ method: 'GET' }).handler(async () => {
  const rows = db.select().from(merchants).orderBy(merchants.name).all()

  const patterns = db.select().from(merchantPatterns).all()
  const patternMap = new Map<number, typeof patterns>()
  for (const p of patterns) {
    const list = patternMap.get(p.merchantId) ?? []
    list.push(p)
    patternMap.set(p.merchantId, list)
  }

  const counts = db
    .select({
      merchantId: transactions.merchantId,
      count: sql<number>`count(*)`,
    })
    .from(transactions)
    .where(sql`${transactions.merchantId} IS NOT NULL AND ${transactions.ignored} = 0`)
    .groupBy(transactions.merchantId)
    .all()

  const countMap = new Map(counts.map((c) => [c.merchantId, c.count]))

  return rows.map((m) => ({
    ...m,
    patterns: patternMap.get(m.id) ?? [],
    transactionCount: countMap.get(m.id) ?? 0,
  }))
})

/**
 * Create a merchant with multiple patterns and apply to matching transactions.
 */
export const createMerchant = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: {
      name: string
      patterns: PatternInput[]
      defaultCategory?: string | null
    }) => data,
  )
  .handler(async ({ data }) => {
    const merchant = db
      .insert(merchants)
      .values({
        name: data.name,
        defaultCategory: data.defaultCategory ?? null,
      })
      .returning()
      .get()

    // Insert patterns
    for (const p of data.patterns) {
      db.insert(merchantPatterns)
        .values({
          merchantId: merchant.id,
          pattern: p.pattern,
          matchType: p.matchType,
        })
        .run()
    }

    // Apply all patterns (OR'd) to matching transactions
    const whereClause = buildMultiPatternWhere(data.patterns)
    if (!whereClause) return { merchant, matched: 0, categorized: 0 }

    const matchResult = db.run(
      sql`UPDATE transactions SET merchant_id = ${merchant.id} WHERE (${whereClause}) AND merchant_id IS NULL AND ignored = 0`,
    )

    // If there's a default category, also categorize uncategorized matches
    let categorized = 0
    if (data.defaultCategory) {
      const catResult = db.run(
        sql`UPDATE transactions SET category = ${data.defaultCategory} WHERE merchant_id = ${merchant.id} AND category IS NULL AND ignored = 0`,
      )
      categorized = catResult.changes
    }

    return { merchant, matched: matchResult.changes, categorized }
  })

/**
 * Update a merchant. If patterns are provided, replaces all existing patterns.
 */
export const updateMerchant = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: {
      id: number
      name?: string
      defaultCategory?: string | null
      patterns?: PatternInput[]
      reapply?: boolean
    }) => data,
  )
  .handler(async ({ data }) => {
    const { id, patterns, reapply, ...fields } = data
    const updates: Record<string, unknown> = {}

    if (fields.name !== undefined) updates.name = fields.name
    if ('defaultCategory' in fields) updates.defaultCategory = fields.defaultCategory

    if (Object.keys(updates).length > 0) {
      db.update(merchants).set(updates).where(eq(merchants.id, id)).run()
    }

    if (patterns) {
      db.delete(merchantPatterns).where(eq(merchantPatterns.merchantId, id)).run()
      for (const p of patterns) {
        db.insert(merchantPatterns)
          .values({ merchantId: id, pattern: p.pattern, matchType: p.matchType })
          .run()
      }
    }

    let matched = 0
    let categorized = 0
    if (reapply && patterns) {
      const whereClause = buildMultiPatternWhere(patterns)
      if (whereClause) {
        const result = db.run(
          sql`UPDATE transactions SET merchant_id = ${id} WHERE (${whereClause}) AND merchant_id IS NULL AND ignored = 0`,
        )
        matched = result.changes

        const merchant = db.select().from(merchants).where(eq(merchants.id, id)).get()
        if (merchant?.defaultCategory) {
          const catResult = db.run(
            sql`UPDATE transactions SET category = ${merchant.defaultCategory} WHERE merchant_id = ${id} AND category IS NULL AND ignored = 0`,
          )
          categorized = catResult.changes
        }
      }
    }

    return { success: true, matched, categorized }
  })

/**
 * Delete a merchant, clearing merchantId on affected transactions.
 */
export const deleteMerchant = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    db.run(sql`UPDATE transactions SET merchant_id = NULL WHERE merchant_id = ${data.id}`)
    db.delete(merchantPatterns).where(eq(merchantPatterns.merchantId, data.id)).run()
    db.delete(merchants).where(eq(merchants.id, data.id)).run()
    return { success: true }
  })

/**
 * Re-scan all transactions against all merchant patterns.
 * Only sets merchantId on transactions where it's currently NULL.
 */
export const applyMerchantRules = createServerFn({ method: 'POST' }).handler(async () => {
  const allMerchants = db.select().from(merchants).all()
  const allPatterns = db.select().from(merchantPatterns).all()
  let totalMatched = 0

  for (const m of allMerchants) {
    const mPatterns = allPatterns
      .filter((p) => p.merchantId === m.id)
      .map((p) => ({ pattern: p.pattern, matchType: p.matchType }))

    const whereClause = buildMultiPatternWhere(mPatterns)
    if (!whereClause) continue

    const result = db.run(
      sql`UPDATE transactions SET merchant_id = ${m.id} WHERE (${whereClause}) AND merchant_id IS NULL AND ignored = 0`,
    )
    totalMatched += result.changes
  }

  return { totalMatched, merchantsProcessed: allMerchants.length }
})

/**
 * Suggest merchants by grouping common unmatched description fragments.
 */
export const suggestMerchants = createServerFn({ method: 'GET' }).handler(async () => {
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
    .where(and(isNull(transactions.merchantId), eq(transactions.ignored, 0)))
    .groupBy(prefixExpr)
    .having(sql`count(*) >= 2`)
    .orderBy(desc(sql`count(*)`))
    .limit(30)
    .all()
})

/**
 * Preview how many unassigned transactions match a set of OR'd patterns,
 * plus a random sample of 10 matching descriptions.
 */
export const previewMerchantPatterns = createServerFn({ method: 'GET' })
  .inputValidator(
    (data: { patterns: PatternInput[] }) => data,
  )
  .handler(async ({ data }) => {
    const whereClause = buildMultiPatternWhere(data.patterns)
    if (!whereClause) return { matchCount: 0, sampleDescriptions: [] }

    const countResult = db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(sql`(${whereClause}) AND merchant_id IS NULL AND ignored = 0`)
      .get()

    const samples = db
      .select({ description: sql<string>`DISTINCT description` })
      .from(transactions)
      .where(sql`(${whereClause}) AND merchant_id IS NULL AND ignored = 0`)
      .orderBy(sql`RANDOM()`)
      .limit(10)
      .all()

    return {
      matchCount: countResult?.count ?? 0,
      sampleDescriptions: samples.map((s) => s.description),
    }
  })

/**
 * Get merchant assignment stats for progress bar.
 */
export const getMerchantStats = createServerFn({ method: 'GET' }).handler(async () => {
  const total = db
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(eq(transactions.ignored, 0))
    .get()

  const assigned = db
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(sql`${transactions.merchantId} IS NOT NULL AND ${transactions.ignored} = 0`)
    .get()

  const totalCount = total?.count ?? 0
  const assignedCount = assigned?.count ?? 0

  return {
    total: totalCount,
    assigned: assignedCount,
    unassigned: totalCount - assignedCount,
    percentage: totalCount > 0 ? Math.round((assignedCount / totalCount) * 100) : 0,
  }
})

/**
 * Build a SQL fragment with OR'd LIKE conditions for multiple patterns.
 */
export function buildMultiPatternWhere(patterns: PatternInput[]) {
  const validPatterns = patterns.filter((p) => p.pattern.trim())
  if (validPatterns.length === 0) return null

  const parts = validPatterns.map((p) => {
    const likePattern = buildLikePattern(p.pattern, p.matchType)
    return sql`description LIKE ${likePattern}`
  })

  let combined = parts[0]
  for (let i = 1; i < parts.length; i++) {
    combined = sql`${combined} OR ${parts[i]}`
  }
  return combined
}

/**
 * Append patterns to an existing merchant without replacing existing ones,
 * then apply the new patterns to unassigned transactions DB-wide.
 */
export const addMerchantPatterns = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: { merchantId: number; patterns: PatternInput[] }) => data,
  )
  .handler(async ({ data }) => {
    for (const p of data.patterns) {
      db.insert(merchantPatterns)
        .values({
          merchantId: data.merchantId,
          pattern: p.pattern,
          matchType: p.matchType,
        })
        .run()
    }

    const whereClause = buildMultiPatternWhere(data.patterns)
    if (!whereClause) return { matched: 0 }

    const result = db.run(
      sql`UPDATE transactions SET merchant_id = ${data.merchantId} WHERE (${whereClause}) AND merchant_id IS NULL AND ignored = 0`,
    )
    return { matched: result.changes }
  })

/**
 * Confirm a pending merchant — either promote it (new) or merge patterns into the target (modify).
 */
export const confirmMerchant = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    const pending = db.select().from(merchants).where(eq(merchants.id, data.id)).get()
    if (!pending || pending.status !== 'pending') {
      return { success: false, error: 'Merchant not found or not pending' }
    }

    const pendingPatterns = db
      .select()
      .from(merchantPatterns)
      .where(eq(merchantPatterns.merchantId, pending.id))
      .all()
      .map((p) => ({ pattern: p.pattern, matchType: p.matchType as 'contains' | 'starts_with' | 'exact' }))

    if (pending.modifiesMerchantId) {
      // "modify" type — merge patterns into the target merchant
      const target = db.select().from(merchants).where(eq(merchants.id, pending.modifiesMerchantId)).get()
      if (!target) {
        return { success: false, error: 'Target merchant not found' }
      }

      // Copy patterns to target
      for (const p of pendingPatterns) {
        db.insert(merchantPatterns)
          .values({
            merchantId: target.id,
            pattern: p.pattern,
            matchType: p.matchType,
          })
          .run()
      }

      // Reassign transactions from pending → target
      db.run(
        sql`UPDATE transactions SET merchant_id = ${target.id} WHERE merchant_id = ${pending.id}`,
      )

      // Apply new patterns to unassigned transactions
      const whereClause = buildMultiPatternWhere(pendingPatterns)
      if (whereClause) {
        db.run(
          sql`UPDATE transactions SET merchant_id = ${target.id} WHERE (${whereClause}) AND merchant_id IS NULL AND ignored = 0`,
        )
      }

      // Delete the pending merchant and its patterns
      db.delete(merchantPatterns).where(eq(merchantPatterns.merchantId, pending.id)).run()
      db.delete(merchants).where(eq(merchants.id, pending.id)).run()

      return { success: true, merchantId: target.id, merged: true }
    } else {
      // "new" type — promote to confirmed
      db.update(merchants)
        .set({ status: 'confirmed' })
        .where(eq(merchants.id, pending.id))
        .run()

      // Apply patterns to unassigned transactions
      const whereClause = buildMultiPatternWhere(pendingPatterns)
      if (whereClause) {
        db.run(
          sql`UPDATE transactions SET merchant_id = ${pending.id} WHERE (${whereClause}) AND merchant_id IS NULL AND ignored = 0`,
        )

        // Categorize if default category is set
        if (pending.defaultCategory) {
          db.run(
            sql`UPDATE transactions SET category = ${pending.defaultCategory} WHERE merchant_id = ${pending.id} AND category IS NULL AND ignored = 0`,
          )
        }
      }

      return { success: true, merchantId: pending.id, merged: false }
    }
  })

export function buildLikePattern(
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

/**
 * Standalone server function for the merchants page.
 * Uses expense-only filtering.
 */
export const suggestMerchantsAI = createServerFn({ method: 'POST' }).handler(
  async () => {
    const descriptions = db
      .select({
        description: transactions.description,
        count: sql<number>`count(*)`,
      })
      .from(transactions)
      .where(
        and(
          isNull(transactions.merchantId),
          eq(transactions.ignored, 0),
          lt(transactions.amount, 0),
          notInArray(transactions.transactionType, [
            'internal_transfer',
            'cc_payment',
          ]),
        ),
      )
      .groupBy(transactions.description)
      .orderBy(sql`count(*) DESC`)
      .all()

    const { callMerchantAI } = await import('./ai-merchants')
    return callMerchantAI({ data: { descriptions } })
  },
)
