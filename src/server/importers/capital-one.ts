import type { ImporterFn } from './types'
import { parseCSV, parseDate, computeImportHash, inferTransactionType, inferPaymentMethod } from './utils'

/**
 * Capital One CSV importer.
 *
 * Format: Transaction Date, Posted Date, Card No., Description, Category, Debit, Credit
 * - Dates: YYYY-MM-DD
 * - Debit column has the amount for charges (positive number), Credit column for payments
 * - Has a Category column
 */
export const importCapitalOne: ImporterFn = (csvContent, accountId, sourceFile) => {
  const rows = parseCSV(csvContent)
  const header = rows[0]
  if (!header || !header[0]?.toLowerCase().includes('transaction')) {
    throw new Error('Invalid Capital One CSV: missing expected header row')
  }

  return rows.slice(1).map((row) => {
    const [rawTxnDate, rawPostedDate, _cardNo, description, category, rawDebit, rawCredit] = row
    if (!rawTxnDate || !description) {
      throw new Error(`Invalid Capital One row: ${row.join(',')}`)
    }

    const date = parseDate(rawTxnDate)
    const postedDate = rawPostedDate ? parseDate(rawPostedDate) : null

    // Debit = money spent (make negative), Credit = money received (positive)
    const debit = rawDebit?.trim() ? parseFloat(rawDebit.trim()) : 0
    const credit = rawCredit?.trim() ? parseFloat(rawCredit.trim()) : 0
    const amount = credit > 0 ? credit : -debit

    const transactionType = inferTransactionType(description, amount, 'credit_card')
    const paymentMethod = inferPaymentMethod('credit_card', description)
    const importHash = computeImportHash(accountId, date, amount, description)

    return {
      accountId,
      date,
      postedDate,
      description: description.trim(),
      amount,
      transactionType,
      paymentMethod: paymentMethod ?? null,
      checkNumber: null,
      cardholder: null,
      sourceCategory: category?.trim() || null,
      category: null,
      notes: null,
      sourceFile,
      importHash,
    }
  })
}
