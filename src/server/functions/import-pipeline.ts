import { createServerFn } from '@tanstack/react-start'
import { db } from '../db'
import { accounts, transactions, merchants, merchantPatterns } from '../db/schema'
import { eq, sql } from 'drizzle-orm'
import { getImporter } from '../importers'
import type { NormalizedTransaction, PipelineTransaction } from '../importers'
import {
  matchesAnyPattern,
  type PatternInput,
  confirmMerchant,
} from './merchants'
import { callMerchantAI, type PendingMerchant } from './ai-merchants'
import {
  detectInstitutionTransaction,
  INSTITUTION_DISPLAY_NAMES,
} from './institution-transactions'

// ── Helper: Get or Create Institution Merchant ───────────────────────

function getOrCreateInstitutionMerchant(institution: string): { id: number; name: string } {
  const name = INSTITUTION_DISPLAY_NAMES[institution]
  if (!name) {
    throw new Error(`Unknown institution: ${institution}`)
  }

  const existing = db.select().from(merchants).where(eq(merchants.name, name)).get()
  if (existing) {
    return { id: existing.id, name: existing.name }
  }

  const created = db
    .insert(merchants)
    .values({ name, defaultCategory: null })
    .returning()
    .get()

  return { id: created.id, name: created.name }
}

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

// ── Step 2b: Assign Institution Transactions ─────────────────────────

export const assignInstitutionTransactions = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: { transactions: NormalizedTransaction[]; accountId: number }) => data,
  )
  .handler(async ({ data }) => {
    const { transactions: txns, accountId } = data

    const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get()
    if (!account) {
      return {
        transactions: txns.map((t) => ({ ...t, merchantId: null, merchantName: null })) as PipelineTransaction[],
        institutionAssignedCount: 0,
      }
    }

    let institutionAssignedCount = 0
    let institutionMerchant: { id: number; name: string } | null = null
    const pipelineTransactions: PipelineTransaction[] = []

    for (const txn of txns) {
      if (txn.ignored) {
        pipelineTransactions.push({ ...txn, merchantId: null, merchantName: null })
        continue
      }

      const detection = detectInstitutionTransaction({
        description: txn.description,
        paymentMethod: txn.paymentMethod ?? null,
        checkNumber: txn.checkNumber ?? null,
        accountType: account.type,
        transactionType: txn.transactionType ?? 'unknown',
        amount: txn.amount,
      })

      if (detection) {
        if (!institutionMerchant) {
          institutionMerchant = getOrCreateInstitutionMerchant(account.institution)
        }

        pipelineTransactions.push({
          ...txn,
          merchantId: institutionMerchant.id,
          merchantName: institutionMerchant.name,
          category: txn.category ?? detection.category,
        })
        institutionAssignedCount++
      } else {
        pipelineTransactions.push({ ...txn, merchantId: null, merchantName: null })
      }
    }

    return {
      transactions: pipelineTransactions,
      institutionAssignedCount,
    }
  })

// ── Step 3: Assign Existing Merchants ────────────────────────────────

export const assignExistingMerchants = createServerFn({ method: 'POST' })
  .inputValidator((data: { transactions: PipelineTransaction[] }) => data)
  .handler(async ({ data }) => {
    // Load all merchants (confirmed + pending) and their patterns
    const allMerchants = db.select().from(merchants).all()
    const allPatterns = db.select().from(merchantPatterns).all()

    // Build a lookup: merchant -> its patterns
    // Sort confirmed first so they take priority over pending
    const merchantRules = allMerchants
      .map((m) => ({
        id: m.id,
        name: m.name,
        defaultCategory: m.defaultCategory,
        status: m.status as 'confirmed' | 'pending',
        patterns: allPatterns
          .filter((p) => p.merchantId === m.id)
          .map((p) => ({ pattern: p.pattern, matchType: p.matchType })) as PatternInput[],
      }))
      .sort((a, b) => (a.status === 'confirmed' ? 0 : 1) - (b.status === 'confirmed' ? 0 : 1))

    let autoAssignedCount = 0
    const pipelineTransactions: PipelineTransaction[] = []
    const unassignedDescMap = new Map<string, number>()

    for (const txn of data.transactions) {
      // Skip ignored transactions and those already assigned (e.g. institution transactions)
      if (txn.ignored || txn.merchantId) {
        pipelineTransactions.push(txn)
        continue
      }

      let matched = false
      for (const rule of merchantRules) {
        if (matchesAnyPattern(txn.description, rule.patterns)) {
          pipelineTransactions.push({
            ...txn,
            merchantId: rule.id,
            merchantName: rule.name,
            merchantStatus: rule.status,
            category: txn.category ?? rule.defaultCategory ?? null,
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
    (data: { descriptions: { description: string; count: number }[] }) => data,
  )
  .handler(async ({ data }) => {
    if (data.descriptions.length === 0) {
      return { suggestions: [], pendingMerchants: [] as PendingMerchant[] }
    }
    return callMerchantAI({ data: { descriptions: data.descriptions } })
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

    // 1. Confirm pending merchants that the user approved
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
          // The pending merchant was merged — look up what target it pointed to
          // The transactions were already reassigned by confirmMerchant, so we can skip
          // the merchantId lookup. But for import transactions not yet in DB, we need
          // to find the right target. Query by merchant name.
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
