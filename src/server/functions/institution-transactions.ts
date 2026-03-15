// ── Institution Display Names ────────────────────────────────────────

export const INSTITUTION_DISPLAY_NAMES: Record<string, string> = {
  amex: 'American Express',
  capital_one: 'Capital One',
  chase: 'Chase',
  lake_ridge: 'Lake Ridge Bank',
}

// ── Detection Logic (pure function, no DB) ───────────────────────────

export type InstitutionDetectionResult = {
  kind: 'overdraft_fee' | 'interest_charge' | 'interest_income' | 'check'
  category: string
}

export function detectInstitutionTransaction(params: {
  description: string
  paymentMethod: string | null
  checkNumber: string | null
  accountType: string // 'checking' | 'savings' | 'credit_card'
  transactionType: string
  amount: number
}): InstitutionDetectionResult | null {
  const { description, paymentMethod, checkNumber, accountType, transactionType, amount } = params
  const desc = description.toUpperCase()

  // 1. Overdraft/NSF fees (checking/savings)
  if (accountType === 'checking' || accountType === 'savings') {
    if (
      desc.includes('OVERDRAFT') ||
      desc.includes('NSF') ||
      desc.includes('OD FEE') ||
      desc.includes('INSUFFICIENT FUND')
    ) {
      return { kind: 'overdraft_fee', category: 'Fees/Interest' }
    }
  }

  // 2. Interest charges (credit cards)
  if (accountType === 'credit_card') {
    if (
      desc.includes('INTEREST CHARGE') ||
      desc.includes('FINANCE CHARGE') ||
      desc.includes('INTEREST CHARGED')
    ) {
      return { kind: 'interest_charge', category: 'Fees/Interest' }
    }
  }

  // 3. Interest income (checking/savings, positive amount)
  if ((accountType === 'checking' || accountType === 'savings') && amount > 0) {
    if (desc.includes('INTEREST') || desc.includes('DIVIDEND')) {
      return { kind: 'interest_income', category: 'Fees/Interest' }
    }
  }

  // 4. Checks (checking only)
  if (accountType === 'checking') {
    if (
      paymentMethod === 'check' ||
      (checkNumber && checkNumber.trim() !== '') ||
      /^CHECK\s*#/i.test(description.trim())
    ) {
      return { kind: 'check', category: 'Other' }
    }
  }

  return null
}
