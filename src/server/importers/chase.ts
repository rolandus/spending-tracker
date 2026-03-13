import type { ImporterFn } from './types'
import { parseCSV, parseDate, computeImportHash, inferTransactionType, inferPaymentMethod } from './utils'

/**
 * Chase CSV importer.
 *
 * Format: Transaction Date, Post Date, Description, Category, Type, Amount, Memo
 * - Dates: MM/DD/YYYY
 * - Amounts already signed: negative = expense, positive = payment/credit
 * - Has Category and Type columns
 */
export const importChase: ImporterFn = (csvContent, accountId, sourceFile) => {
  const rows = parseCSV(csvContent)
  const header = rows[0]
  if (!header || !header[0]?.toLowerCase().includes('transaction')) {
    throw new Error('Invalid Chase CSV: missing expected header row')
  }

  return rows.slice(1).map((row) => {
    const [rawTxnDate, rawPostDate, description, category, _type, rawAmount, _memo] = row
    if (!rawTxnDate || !description || rawAmount === undefined) {
      throw new Error(`Invalid Chase row: ${row.join(',')}`)
    }

    const date = parseDate(rawTxnDate)
    const postedDate = rawPostDate ? parseDate(rawPostDate) : null
    const amount = parseFloat(rawAmount.replace(/,/g, ''))

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
