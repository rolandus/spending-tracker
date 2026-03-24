import type { ImporterFn } from './types'
import { parseCSV, parseDate, parseAmount, computeImportHash } from './utils'

/**
 * Fidelity CSV importer.
 *
 * Format: Run Date, Account, Account Number, Action, Symbol, Description, Type,
 *         Price ($), Quantity, Commission ($), Fees ($), Accrued Interest ($),
 *         Amount ($), Settlement Date
 *
 * - CSV has 2 blank leading lines before the header row
 * - Dates: MM/DD/YYYY
 * - Only imports rows where Action starts with "DIRECT DEPOSIT"
 * - Amounts are positive (money in)
 */
export const importFidelity: ImporterFn = (csvContent, accountId, sourceFile) => {
  const rows = parseCSV(csvContent)

  // Find the header row (skip blank lines)
  const headerIndex = rows.findIndex(
    (row) => row[0]?.toLowerCase().includes('run date'),
  )
  if (headerIndex === -1) {
    throw new Error('Invalid Fidelity CSV: missing expected header row')
  }

  return rows
    .slice(headerIndex + 1)
    .filter((row) => {
      const action = row[3] ?? ''
      return action.toUpperCase().startsWith('DIRECT DEPOSIT')
    })
    .map((row) => {
      const [rawDate, , , action, , , , , , , , , rawAmount] = row
      if (!rawDate || !action || rawAmount === undefined) {
        throw new Error(`Invalid Fidelity row: ${row.join(',')}`)
      }

      const date = parseDate(rawDate)
      const amount = parseAmount(rawAmount)
      const description = action.replace(/\s*\(Cash\)\s*$/, '').trim()
      const importHash = computeImportHash(accountId, date, amount, description)

      return {
        accountId,
        date,
        postedDate: null,
        description,
        amount,
        transactionType: 'unknown' as const,
        paymentMethod: 'direct_deposit' as const,
        checkNumber: null,
        cardholder: null,
        sourceCategory: null,
        category: null,
        notes: null,
        ignored: 0,
        sourceFile,
        importHash,
      }
    })
}
