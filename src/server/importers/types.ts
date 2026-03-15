import type { NewTransaction } from '../db/schema'

/**
 * A parsed transaction ready for insertion.
 * Same shape as NewTransaction but without id/createdAt (those are auto-generated).
 */
export type NormalizedTransaction = Omit<NewTransaction, 'id' | 'createdAt'>

/**
 * An importer function takes raw CSV text + metadata and returns normalized transactions.
 */
export type ImporterFn = (
  csvContent: string,
  accountId: number,
  sourceFile: string,
) => NormalizedTransaction[]

/**
 * A transaction moving through the import pipeline with merchant assignment.
 */
export type PipelineTransaction = NormalizedTransaction & {
  merchantId: number | null
  merchantName: string | null
  merchantStatus?: 'confirmed' | 'pending'
}

/**
 * Result of an import operation.
 */
export interface ImportResult {
  inserted: number
  skipped: number
  errors: string[]
}
