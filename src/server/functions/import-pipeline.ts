import { createServerFn } from '@tanstack/react-start'
import { db } from '../db'
import { accounts, transactions, merchants, merchantPatterns } from '../db/schema'
import { eq } from 'drizzle-orm'
import { getImporter } from '../importers'
import type { NormalizedTransaction, PipelineTransaction } from '../importers'
import {
  findMatchingPattern,
  type PatternInput,
  confirmMerchant,
} from './merchants'
import { callMerchantAI, type PendingMerchant } from './ai-merchants'

// ── Step 1: Parse & Normalize ────────────────────────────────────────

export const parseAndNormalize = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: { accountId: number; csvContent: string; fileName: string }) => data,
  )
  .handler(async ({ data }) => {
    const { accountId, csvContent, fileName } = data

    const account = db
      .select()
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .get()

    if (!account) {
      return { transactions: [] as NormalizedTransaction[], errors: [`Account ID ${accountId} not found`] }
    }

    const importer = getImporter(account.institution)

    try {
      const parsed = importer(csvContent, accountId, fileName)
      return { transactions: parsed, errors: [] }
    } catch (err) {
      return {
        transactions: [] as NormalizedTransaction[],
        errors: [`Parse error: ${err instanceof Error ? err.message : String(err)}`],
      }
    }
  })

// ── Step 2: Detect Duplicates ────────────────────────────────────────

export const detectDuplicates = createServerFn({ method: 'POST' })
  .inputValidator((data: { transactions: NormalizedTransaction[] }) => data)
  .handler(async ({ data }) => {
    const newTransactions: NormalizedTransaction[] = []
    let duplicateCount = 0

    for (const txn of data.transactions) {
      const existing = db
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.importHash, txn.importHash))
        .get()

      if (existing) {
        duplicateCount++
      } else {
        newTransactions.push(txn)
      }
    }

    return { newTransactions, duplicateCount }
  })

// ── Step 3: Assign Existing Merchants ────────────────────────────────

export const assignExistingMerchants = createServerFn({ method: 'POST' })
  .inputValidator((data: { transactions: PipelineTransaction[] }) => data)
  .handler(async ({ data }) => {
    // Load all merchants (confirmed + pending) and their patterns
    const allMerchants = db.select().from(merchants).all()
    const allPatterns = db.select().from(merchantPatterns).all()

    // Build a lookup: merchant -> its patterns (with per-pattern defaults)
    // Sort confirmed first so they take priority over pending
    const merchantRules = allMerchants
      .map((m) => ({
        id: m.id,
        name: m.name,
        status: m.status as 'confirmed' | 'pending',
        patterns: allPatterns
          .filter((p) => p.merchantId === m.id)
          .map((p) => ({
            pattern: p.pattern,
            matchType: p.matchType as PatternInput['matchType'],
            defaultCategory: p.defaultCategory ?? null,
            defaultTransactionType: p.defaultTransactionType ?? null,
            defaultIgnored: p.defaultIgnored === 1,
          })),
      }))
      .sort((a, b) => (a.status === 'confirmed' ? 0 : 1) - (b.status === 'confirmed' ? 0 : 1))

    let autoAssignedCount = 0
    const pipelineTransactions: PipelineTransaction[] = []
    const unassignedDescMap = new Map<string, number>()

    for (const txn of data.transactions) {
      // Skip already-assigned transactions
      if (txn.ignored || txn.merchantId) {
        pipelineTransactions.push(txn)
        continue
      }

      let matched = false
      for (const rule of merchantRules) {
        const matchedPattern = findMatchingPattern(txn.description, rule.patterns)
        if (matchedPattern) {
          pipelineTransactions.push({
            ...txn,
            merchantId: rule.id,
            merchantName: rule.name,
            merchantStatus: rule.status,
            ignored: matchedPattern.defaultIgnored ? 1 : (txn.ignored ?? 0),
            category: matchedPattern.defaultIgnored
              ? (txn.category ?? null)
              : (txn.category ?? matchedPattern.defaultCategory ?? null),
            transactionType:
              txn.transactionType === 'unknown' && matchedPattern.defaultTransactionType
                ? (matchedPattern.defaultTransactionType as typeof txn.transactionType)
                : txn.transactionType,
          })
          autoAssignedCount++
          matched = true
          break
        }
      }

      if (!matched) {
        pipelineTransactions.push({
          ...txn,
          merchantId: null,
          merchantName: null,
        })
        // Count unassigned descriptions (de-duplicated)
        const key = txn.description
        unassignedDescMap.set(key, (unassignedDescMap.get(key) ?? 0) + 1)
      }
    }

    const unassignedDescriptions = Array.from(unassignedDescMap.entries())
      .map(([description, count]) => ({ description, count }))
      .sort((a, b) => b.count - a.count)

    return {
      transactions: pipelineTransactions,
      autoAssignedCount,
      unassignedDescriptions,
    }
  })

// ── Step 3b: Request AI Suggestions ──────────────────────────────────

export const requestAISuggestions = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: {
      descriptions: { description: string; count: number }[]
      accountId: number
    }) => data,
  )
  .handler(async ({ data }) => {
    if (data.descriptions.length === 0) {
      return { suggestions: [], pendingMerchants: [] as PendingMerchant[] }
    }
    return callMerchantAI({ data: { descriptions: data.descriptions, accountId: data.accountId } })
  })

// ── Step 4: Commit Import ────────────────────────────────────────────

export const commitImport = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: {
      transactions: PipelineTransaction[]
      confirmedMerchantIds: number[]
    }) => data,
  )
  .handler(async ({ data }) => {
    let merchantsConfirmed = 0

    // 1. Confirm pending merchants (edits were already saved during the merchant review step)
    for (const pendingId of data.confirmedMerchantIds) {
      const result = await confirmMerchant({ data: { id: pendingId } })
      if (result.success) {
        merchantsConfirmed++
      }
    }

    // 2. Insert transactions
    let inserted = 0
    let skipped = 0
    const errors: string[] = []

    for (const txn of data.transactions) {
      // For transactions assigned to a pending merchant that was confirmed via "modify",
      // confirmMerchant already merged it into the target. Resolve the final merchantId.
      let finalMerchantId = txn.merchantId
      if (finalMerchantId) {
        // Check if this merchant still exists (it may have been merged into a target)
        const exists = db.select({ id: merchants.id }).from(merchants).where(eq(merchants.id, finalMerchantId)).get()
        if (!exists) {
          if (txn.merchantName) {
            const target = db.select({ id: merchants.id }).from(merchants)
              .where(eq(merchants.name, txn.merchantName))
              .get()
            finalMerchantId = target?.id ?? null
          } else {
            finalMerchantId = null
          }
        }
      }

      try {
        const result = db
          .insert(transactions)
          .values({
            accountId: txn.accountId,
            date: txn.date,
            postedDate: txn.postedDate,
            description: txn.description,
            amount: txn.amount,
            transactionType: txn.transactionType,
            paymentMethod: txn.paymentMethod,
            checkNumber: txn.checkNumber,
            cardholder: txn.cardholder,
            sourceCategory: txn.sourceCategory,
            category: txn.category,
            notes: txn.notes,
            merchantId: finalMerchantId,
            ignored: txn.ignored ?? 0,
            sourceFile: txn.sourceFile,
            importHash: txn.importHash,
          })
          .onConflictDoNothing({ target: transactions.importHash })
          .run()

        if (result.changes > 0) {
          inserted++
        } else {
          skipped++
        }
      } catch (err) {
        errors.push(
          `Error inserting "${txn.description}" on ${txn.date}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    return { inserted, skipped, errors, merchantsConfirmed }
  })
