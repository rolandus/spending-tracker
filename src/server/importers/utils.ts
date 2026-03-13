import { createHash } from 'crypto'

/**
 * Parse a date string in various formats to YYYY-MM-DD.
 */
export function parseDate(raw: string): string {
  const cleaned = raw.replace(/"/g, '').trim()

  // YYYY-MM-DD (Capital One format) — already good
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return cleaned
  }

  // MM/DD/YYYY (AmEx, Chase, Lake Ridge format)
  const mdyMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdyMatch) {
    const [, month, day, year] = mdyMatch
    return `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`
  }

  throw new Error(`Cannot parse date: "${raw}"`)
}

/**
 * Parse a dollar amount from various formats to a number.
 * Handles: "$1,234.56", "-$75.87", "1234.56", "-1234.56", quoted values, etc.
 */
export function parseAmount(raw: string): number {
  const cleaned = raw.replace(/"/g, '').replace(/\$/g, '').replace(/,/g, '').trim()
  if (cleaned === '' || cleaned === '-') return 0
  const value = parseFloat(cleaned)
  if (isNaN(value)) {
    throw new Error(`Cannot parse amount: "${raw}"`)
  }
  return value
}

/**
 * Compute a SHA-256 hash for deduplication.
 * Uses accountId + date + amount + description to fingerprint a transaction.
 */
export function computeImportHash(
  accountId: number,
  date: string,
  amount: number,
  description: string,
): string {
  const payload = `${accountId}|${date}|${amount.toFixed(2)}|${description.trim()}`
  return createHash('sha256').update(payload).digest('hex')
}

/**
 * Infer the transaction type from context clues.
 */
export function inferTransactionType(
  description: string,
  amount: number,
  accountType: string,
): 'expense' | 'income' | 'internal_transfer' | 'cc_payment' | 'refund' | 'unknown' {
  const desc = description.toUpperCase()

  // Direct deposit / payroll
  if (desc.includes('DIRECT DEP') || desc.includes('PAYROLL') || desc.includes('DIR DEP')) {
    return 'income'
  }

  // Internal transfers between own accounts
  if (
    desc.includes('TRANSFER FROM') ||
    desc.includes('TRANSFER TO') ||
    desc.includes('XFER FROM') ||
    desc.includes('XFER TO') ||
    desc.includes('ONLINE TRANSFER') ||
    desc.includes('FUNDS TRANSFER')
  ) {
    return 'internal_transfer'
  }

  // Credit card payments (from a bank account to a CC company)
  if (
    accountType === 'checking' &&
    (desc.includes('AMERICAN EXPRESS') ||
      desc.includes('AMEX') ||
      desc.includes('CAPITAL ONE') ||
      desc.includes('CHASE CARD') ||
      desc.includes('CHASE CREDIT'))
  ) {
    return 'cc_payment'
  }

  // Payments received on credit cards
  if (accountType === 'credit_card' && amount > 0) {
    // Positive amount on a CC is either a payment or refund
    if (desc.includes('PAYMENT') || desc.includes('AUTOPAY')) {
      return 'cc_payment'
    }
    if (desc.includes('REFUND') || desc.includes('RETURN') || desc.includes('CREDIT') || desc.includes('REWARD')) {
      return 'refund'
    }
  }

  // Interest income (savings accounts)
  if (desc.includes('INTEREST') || desc.includes('DIVIDEND')) {
    return 'income'
  }

  // If it's a credit card charge (negative amount on credit card)
  if (accountType === 'credit_card' && amount < 0) {
    return 'expense'
  }

  // If it's a bank account outflow that hasn't matched anything above
  if ((accountType === 'checking' || accountType === 'savings') && amount < 0) {
    return 'expense'
  }

  return 'unknown'
}

/**
 * Infer the payment method from context.
 */
export function inferPaymentMethod(
  accountType: string,
  description: string,
  checkNumber?: string | null,
): 'credit' | 'ach' | 'check' | 'cash' | 'transfer' | 'direct_deposit' | undefined {
  if (accountType === 'credit_card') {
    return 'credit'
  }

  if (checkNumber && checkNumber.trim() !== '') {
    return 'check'
  }

  const desc = description.toUpperCase()

  if (desc.includes('DIRECT DEP') || desc.includes('PAYROLL') || desc.includes('DIR DEP')) {
    return 'direct_deposit'
  }

  if (
    desc.includes('TRANSFER') ||
    desc.includes('XFER')
  ) {
    return 'transfer'
  }

  if (desc.includes('ACH') || desc.includes('ELECTRONIC') || desc.includes('AUTOPAY')) {
    return 'ach'
  }

  if (desc.includes('ATM') || desc.includes('CASH') || desc.includes('WITHDRAWAL')) {
    return 'cash'
  }

  return 'ach' // Default for bank transactions
}

/**
 * Simple CSV parser that handles quoted fields with commas.
 * Returns an array of string arrays (rows of fields).
 */
export function parseCSV(content: string): string[][] {
  const rows: string[][] = []
  const lines = content.split('\n')

  for (const line of lines) {
    if (line.trim() === '') continue

    const fields: string[] = []
    let current = ''
    let inQuotes = false

    for (let i = 0; i < line.length; i++) {
      const char = line[i]!

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          // Escaped quote
          current += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if (char === ',' && !inQuotes) {
        fields.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    fields.push(current.trim())
    rows.push(fields)
  }

  return rows
}
