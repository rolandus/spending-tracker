import { createServerFn } from '@tanstack/react-start'
import { db } from '../db'
import { accounts, transactions } from '../db/schema'
import { eq } from 'drizzle-orm'
import { getImporter } from '../importers'
import type { ImportResult } from '../importers'

/**
 * Get all accounts for the import form dropdown.
 */
export const getAccounts = createServerFn({ method: 'GET' }).handler(async () => {
  return db.select().from(accounts).where(eq(accounts.isActive, true)).all()
})

/**
 * Import a CSV file for a given account.
 * Returns counts of inserted, skipped (dedup), and errors.
 */
export const importCSV = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: { accountId: number; csvContent: string; fileName: string }) => data,
  )
  .handler(async ({ data }): Promise<ImportResult> => {
    const { accountId, csvContent, fileName } = data

    // Look up the account to determine the institution
    const account = db
      .select()
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .get()

    if (!account) {
      return { inserted: 0, skipped: 0, errors: [`Account ID ${accountId} not found`] }
    }

    const importer = getImporter(account.institution)

    let parsed
    try {
      parsed = importer(csvContent, accountId, fileName)
    } catch (err) {
      return {
        inserted: 0,
        skipped: 0,
        errors: [`Parse error: ${err instanceof Error ? err.message : String(err)}`],
      }
    }

    let inserted = 0
    let skipped = 0
    const errors: string[] = []

    for (const txn of parsed) {
      try {
        const result = db
          .insert(transactions)
          .values(txn)
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

    return { inserted, skipped, errors }
  })
