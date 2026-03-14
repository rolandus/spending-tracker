import { createServerFn } from '@tanstack/react-start'
import { db } from '../db'
import { merchants, merchantPatterns, transactions } from '../db/schema'
import { eq, sql, desc, isNull } from 'drizzle-orm'

type PatternInput = { pattern: string; matchType: 'contains' | 'starts_with' | 'exact' }

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
    .where(sql`${transactions.merchantId} IS NOT NULL`)
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
      sql`UPDATE transactions SET merchant_id = ${merchant.id} WHERE (${whereClause}) AND merchant_id IS NULL`,
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
 * Update a merchant. If patterns are provided, replaces all existing patterns.
 */
export const updateMerchant = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: {
      id: number
      name?: string
      defaultCategory?: string | null
      patterns?: PatternInput[]
    }) => data,
  )
  .handler(async ({ data }) => {
    const { id, patterns, ...fields } = data
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

    return { success: true }
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
      sql`UPDATE transactions SET merchant_id = ${m.id} WHERE (${whereClause}) AND merchant_id IS NULL`,
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
    .where(isNull(transactions.merchantId))
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
      .where(sql`(${whereClause}) AND merchant_id IS NULL`)
      .get()

    const samples = db
      .select({ description: sql<string>`DISTINCT description` })
      .from(transactions)
      .where(sql`(${whereClause}) AND merchant_id IS NULL`)
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
    .get()

  const assigned = db
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(sql`${transactions.merchantId} IS NOT NULL`)
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
function buildMultiPatternWhere(patterns: PatternInput[]) {
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
