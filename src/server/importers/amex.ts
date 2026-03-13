import type { ImporterFn } from './types'
import { parseCSV, parseDate, computeImportHash, inferTransactionType, inferPaymentMethod } from './utils'

/**
 * American Express CSV importer.
 *
 * Format: Date, Description, Card Member, Account #, Amount
 * - Dates: MM/DD/YYYY
 * - Amounts: positive = expense (yes, reversed), negative = reward/refund
 * - No category column
 */
export const importAmex: ImporterFn = (csvContent, accountId, sourceFile) => {
  const rows = parseCSV(csvContent)
  const header = rows[0]
  if (!header || !header[0]?.toLowerCase().includes('date')) {
    throw new Error('Invalid AmEx CSV: missing expected header row')
  }

  return rows.slice(1).map((row) => {
    const [rawDate, description, cardMember, _accountNum, rawAmount] = row
    if (!rawDate || !description || !rawAmount) {
      throw new Error(`Invalid AmEx row: ${row.join(',')}`)
    }

    const date = parseDate(rawDate)
    // AmEx amounts: positive = charge (should be negative in our schema),
    // negative = reward/refund (should be positive in our schema)
    const rawAmountNum = parseFloat(rawAmount.replace(/,/g, ''))
    const amount = -rawAmountNum

    const transactionType = inferTransactionType(description, amount, 'credit_card')
    const paymentMethod = inferPaymentMethod('credit_card', description)
    const importHash = computeImportHash(accountId, date, amount, description)

    return {
      accountId,
      date,
      postedDate: null,
      description: description.trim(),
      amount,
      transactionType,
      paymentMethod: paymentMethod ?? null,
      checkNumber: null,
      cardholder: cardMember?.trim() ?? null,
      sourceCategory: null,
      category: null,
      notes: null,
      sourceFile,
      importHash,
    }
  })
}
