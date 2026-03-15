import { createServerFn } from '@tanstack/react-start'
import { db } from '../db'
import { accounts, transactions, merchants, merchantPatterns } from '../db/schema'
import { eq, sql } from 'drizzle-orm'
import { getImporter } from '../importers'
import type { NormalizedTransaction, PipelineTransaction } from '../importers'
import {
  matchesAnyPattern,
  type PatternInput,
  createMerchant,
  addMerchantPatterns,
} from './merchants'
import { callMerchantAI, type AISuggestion } from './ai-merchants'

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
  .inputValidator((data: { transactions: NormalizedTransaction[] }) => data)
  .handler(async ({ data }) => {
    // Load all merchants and their patterns
    const allMerchants = db.select().from(merchants).all()
    const allPatterns = db.select().from(merchantPatterns).all()

    // Build a lookup: merchant -> its patterns
    const merchantRules = allMerchants.map((m) => ({
      id: m.id,
      name: m.name,
      defaultCategory: m.defaultCategory,
      patterns: allPatterns
        .filter((p) => p.merchantId === m.id)
        .map((p) => ({ pattern: p.pattern, matchType: p.matchType })) as PatternInput[],
    }))

    let autoAssignedCount = 0
    const pipelineTransactions: PipelineTransaction[] = []
    const unassignedDescMap = new Map<string, number>()

    for (const txn of data.transactions) {
      // Skip merchant matching for ignored transactions (cc_payment, internal_transfer)
      if (txn.ignored) {
        pipelineTransactions.push({ ...txn, merchantId: null, merchantName: null })
        continue
      }

      let matched = false
      for (const rule of merchantRules) {
        if (matchesAnyPattern(txn.description, rule.patterns)) {
          pipelineTransactions.push({
            ...txn,
            merchantId: rule.id,
            merchantName: rule.name,
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
      return { suggestions: [] as AISuggestion[], fromCache: false }
    }
    return callMerchantAI({ data: { descriptions: data.descriptions, skipCache: true } })
  })

// ── Step 4: Commit Import ────────────────────────────────────────────

type ApprovedNewMerchant = {
  name: string
  patterns: PatternInput[]
  defaultCategory: string | null
}

type ApprovedModification = {
  existingMerchantName: string
  patterns: PatternInput[]
}

export const commitImport = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: {
      transactions: PipelineTransaction[]
      newMerchants: ApprovedNewMerchant[]
      modifiedMerchants: ApprovedModification[]
    }) => data,
  )
  .handler(async ({ data }) => {
    let merchantsCreated = 0
    let merchantsModified = 0

    // 1. Create new merchants (captures real IDs)
    const nameToIdMap = new Map<string, number>()
    for (const nm of data.newMerchants) {
      const result = await createMerchant({
        data: {
          name: nm.name,
          patterns: nm.patterns,
          defaultCategory: nm.defaultCategory,
        },
      })
      nameToIdMap.set(nm.name, result.merchant.id)
      merchantsCreated++
    }

    // 2. Add patterns to existing merchants
    for (const mod of data.modifiedMerchants) {
      const existing = db
        .select()
        .from(merchants)
        .where(eq(merchants.name, mod.existingMerchantName))
        .get()

      if (existing) {
        await addMerchantPatterns({
          data: { merchantId: existing.id, patterns: mod.patterns },
        })
        nameToIdMap.set(mod.existingMerchantName, existing.id)
        merchantsModified++
      }
    }

    // 3. Insert transactions
    let inserted = 0
    let skipped = 0
    const errors: string[] = []

    for (const txn of data.transactions) {
      // Resolve merchant ID: use real DB ID if merchant was just created/modified
      let finalMerchantId = txn.merchantId
      if (txn.merchantName && (!finalMerchantId || finalMerchantId === -1)) {
        finalMerchantId = nameToIdMap.get(txn.merchantName) ?? null
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

    return { inserted, skipped, errors, merchantsCreated, merchantsModified }
  })
