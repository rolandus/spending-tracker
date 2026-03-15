import type { ImporterFn } from './types'
import { parseCSV, parseDate, parseAmount, computeImportHash, inferTransactionType, inferPaymentMethod } from './utils'

/**
 * Lake Ridge Bank CSV importer.
 * Handles Checking, Savings, and Spending accounts (same format).
 *
 * Format: "Date","Description","Comments","Check Number","Amount","Balance"
 * - All fields quoted
 * - Dates: MM/DD/YYYY
 * - Amounts: prefixed with $ sign, negative for outflows ("-$75.87", "$762.00")
 * - Has Check Number and Balance columns
 */
export const importLakeRidge: ImporterFn = (csvContent, accountId, sourceFile) => {
  const rows = parseCSV(csvContent)
  const header = rows[0]
  if (!header || !header[0]?.toLowerCase().includes('date')) {
    throw new Error('Invalid Lake Ridge CSV: missing expected header row')
  }

  // Determine account type from filename
  let accountType = 'checking'
  const fileLower = sourceFile.toLowerCase()
  if (fileLower.includes('savings')) {
    accountType = 'savings'
  }

  return rows.slice(1).map((row) => {
    const [rawDate, description, _comments, checkNumber, rawAmount, _balance] = row
    if (!rawDate || !description || rawAmount === undefined) {
      throw new Error(`Invalid Lake Ridge row: ${row.join(',')}`)
    }

    const date = parseDate(rawDate)
    const amount = parseAmount(rawAmount)
    const cleanCheckNum = checkNumber?.replace(/"/g, '').trim() || null

    const transactionType = inferTransactionType(description, amount, accountType)
    const paymentMethod = inferPaymentMethod(accountType, description, cleanCheckNum)
    const importHash = computeImportHash(accountId, date, amount, description)
    const ignored = transactionType === 'cc_payment' || transactionType === 'internal_transfer' ? 1 : 0

    return {
      accountId,
      date,
      postedDate: null,
      description: description.replace(/"/g, '').trim(),
      amount,
      transactionType,
      paymentMethod: paymentMethod ?? null,
      checkNumber: cleanCheckNum,
      cardholder: null,
      sourceCategory: null,
      category: null,
      notes: null,
      ignored,
      sourceFile,
      importHash,
    }
  })
}
