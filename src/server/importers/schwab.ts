import type { ImporterFn } from './types'
import { parseCSV, parseDate, parseAmount, computeImportHash } from './utils'

/**
 * Charles Schwab CSV importer.
 *
 * Format: Date, Action, Symbol, Description, Quantity, Price, Fees & Comm, Amount
 *
 * - Header is on the first line
 * - Dates: MM/DD/YYYY (some rows have "as of" suffix — stripped before parsing)
 * - All fields are quoted
 * - Only imports rows where Action is "MoneyLink Deposit"
 * - Amounts are positive with a "$" prefix (money in)
 */
export const importSchwab: ImporterFn = (csvContent, accountId, sourceFile) => {
  const rows = parseCSV(csvContent)

  if (rows.length === 0 || !rows[0]![0]?.toLowerCase().includes('date')) {
    throw new Error('Invalid Schwab CSV: missing expected header row')
  }

  return rows
    .slice(1)
    .filter((row) => {
      const action = row[1] ?? ''
      return action === 'MoneyLink Deposit'
    })
    .map((row) => {
      const [rawDate, , , description, , , , rawAmount] = row
      if (!rawDate || rawAmount === undefined) {
        throw new Error(`Invalid Schwab row: ${row.join(',')}`)
      }

      // Strip "as of MM/DD/YYYY" suffix from date if present
      const dateStr = rawDate.replace(/\s+as of\s+\d{2}\/\d{2}\/\d{4}/, '').trim()
      const date = parseDate(dateStr)
      const amount = parseAmount(rawAmount)
      const desc = (description ?? 'MoneyLink Deposit').trim()
      const importHash = computeImportHash(accountId, date, amount, desc)

      return {
        accountId,
        date,
        postedDate: null,
        description: desc,
        amount,
        transactionType: 'unknown' as const,
        paymentMethod: 'ach' as const,
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
