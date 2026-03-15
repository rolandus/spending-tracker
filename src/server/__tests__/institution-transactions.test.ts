import { describe, it, expect } from 'vitest'
import {
  detectInstitutionTransaction,
  INSTITUTION_DISPLAY_NAMES,
} from '../functions/institution-transactions'

// ── Pure Detection Function Tests (no DB needed) ─────────────────────

describe('detectInstitutionTransaction', () => {
  describe('overdraft/NSF fees', () => {
    it('detects overdraft fee on checking', () => {
      const result = detectInstitutionTransaction({
        description: 'OVERDRAFT FEE',
        paymentMethod: 'ach',
        checkNumber: null,
        accountType: 'checking',
        transactionType: 'expense',
        amount: -35,
      })
      expect(result).toEqual({ kind: 'overdraft_fee', category: 'Fees/Interest' })
    })

    it('detects NSF fee on checking', () => {
      const result = detectInstitutionTransaction({
        description: 'NSF FEE CHARGE',
        paymentMethod: 'ach',
        checkNumber: null,
        accountType: 'checking',
        transactionType: 'expense',
        amount: -25,
      })
      expect(result).toEqual({ kind: 'overdraft_fee', category: 'Fees/Interest' })
    })

    it('detects OD FEE on savings', () => {
      const result = detectInstitutionTransaction({
        description: 'OD FEE',
        paymentMethod: 'ach',
        checkNumber: null,
        accountType: 'savings',
        transactionType: 'expense',
        amount: -30,
      })
      expect(result).toEqual({ kind: 'overdraft_fee', category: 'Fees/Interest' })
    })

    it('detects INSUFFICIENT FUND on checking', () => {
      const result = detectInstitutionTransaction({
        description: 'INSUFFICIENT FUND CHG',
        paymentMethod: 'ach',
        checkNumber: null,
        accountType: 'checking',
        transactionType: 'expense',
        amount: -35,
      })
      expect(result).toEqual({ kind: 'overdraft_fee', category: 'Fees/Interest' })
    })

    it('does not detect overdraft fee on credit card', () => {
      const result = detectInstitutionTransaction({
        description: 'OVERDRAFT FEE',
        paymentMethod: 'credit',
        checkNumber: null,
        accountType: 'credit_card',
        transactionType: 'expense',
        amount: -35,
      })
      // Should not match overdraft on credit_card — falls through
      expect(result).toBeNull()
    })
  })

  describe('interest charges (credit card)', () => {
    it('detects INTEREST CHARGE on credit card', () => {
      const result = detectInstitutionTransaction({
        description: 'INTEREST CHARGE ON PURCHASES',
        paymentMethod: 'credit',
        checkNumber: null,
        accountType: 'credit_card',
        transactionType: 'expense',
        amount: -42.15,
      })
      expect(result).toEqual({ kind: 'interest_charge', category: 'Fees/Interest' })
    })

    it('detects FINANCE CHARGE on credit card', () => {
      const result = detectInstitutionTransaction({
        description: 'FINANCE CHARGE',
        paymentMethod: 'credit',
        checkNumber: null,
        accountType: 'credit_card',
        transactionType: 'expense',
        amount: -18.50,
      })
      expect(result).toEqual({ kind: 'interest_charge', category: 'Fees/Interest' })
    })

    it('does not detect INTEREST CHARGE on checking', () => {
      const result = detectInstitutionTransaction({
        description: 'INTEREST CHARGE ON PURCHASES',
        paymentMethod: 'ach',
        checkNumber: null,
        accountType: 'checking',
        transactionType: 'expense',
        amount: -42.15,
      })
      // Not a credit card, so not an interest charge — falls through
      expect(result).toBeNull()
    })
  })

  describe('interest income (checking/savings)', () => {
    it('detects INTEREST on savings with positive amount', () => {
      const result = detectInstitutionTransaction({
        description: 'INTEREST PAYMENT',
        paymentMethod: 'ach',
        checkNumber: null,
        accountType: 'savings',
        transactionType: 'income',
        amount: 1.23,
      })
      expect(result).toEqual({ kind: 'interest_income', category: 'Fees/Interest' })
    })

    it('detects DIVIDEND on checking with positive amount', () => {
      const result = detectInstitutionTransaction({
        description: 'DIVIDEND PAYMENT',
        paymentMethod: 'ach',
        checkNumber: null,
        accountType: 'checking',
        transactionType: 'income',
        amount: 0.50,
      })
      expect(result).toEqual({ kind: 'interest_income', category: 'Fees/Interest' })
    })

    it('does not detect interest income on savings with negative amount', () => {
      const result = detectInstitutionTransaction({
        description: 'INTEREST PAYMENT',
        paymentMethod: 'ach',
        checkNumber: null,
        accountType: 'savings',
        transactionType: 'expense',
        amount: -10,
      })
      // Negative amount on savings with INTEREST — doesn't match interest income
      expect(result).toBeNull()
    })
  })

  describe('checks', () => {
    it('detects check by paymentMethod on checking', () => {
      const result = detectInstitutionTransaction({
        description: 'CHECK #1234',
        paymentMethod: 'check',
        checkNumber: '1234',
        accountType: 'checking',
        transactionType: 'expense',
        amount: -500,
      })
      expect(result).toEqual({ kind: 'check', category: 'Other' })
    })

    it('detects check by description pattern "Check #" on checking', () => {
      const result = detectInstitutionTransaction({
        description: 'Check #1076',
        paymentMethod: 'ach',
        checkNumber: null,
        accountType: 'checking',
        transactionType: 'expense',
        amount: -972.52,
      })
      expect(result).toEqual({ kind: 'check', category: 'Other' })
    })

    it('detects check by checkNumber alone on checking', () => {
      const result = detectInstitutionTransaction({
        description: 'WITHDRAWAL',
        paymentMethod: 'ach',
        checkNumber: '5678',
        accountType: 'checking',
        transactionType: 'expense',
        amount: -200,
      })
      expect(result).toEqual({ kind: 'check', category: 'Other' })
    })

    it('does not detect check on credit card', () => {
      const result = detectInstitutionTransaction({
        description: 'CHECK PAYMENT',
        paymentMethod: 'check',
        checkNumber: '1234',
        accountType: 'credit_card',
        transactionType: 'expense',
        amount: -100,
      })
      expect(result).toBeNull()
    })

    it('does not detect check on savings', () => {
      const result = detectInstitutionTransaction({
        description: 'CHECK #1234',
        paymentMethod: 'check',
        checkNumber: '1234',
        accountType: 'savings',
        transactionType: 'expense',
        amount: -300,
      })
      expect(result).toBeNull()
    })
  })

  describe('non-matching transactions', () => {
    it('returns null for regular expense', () => {
      const result = detectInstitutionTransaction({
        description: 'AMAZON PURCHASE',
        paymentMethod: 'credit',
        checkNumber: null,
        accountType: 'credit_card',
        transactionType: 'expense',
        amount: -42.50,
      })
      expect(result).toBeNull()
    })

    it('returns null for regular checking expense', () => {
      const result = detectInstitutionTransaction({
        description: 'WHOLE FOODS MARKET',
        paymentMethod: 'ach',
        checkNumber: null,
        accountType: 'checking',
        transactionType: 'expense',
        amount: -85,
      })
      expect(result).toBeNull()
    })

    it('returns null for income (non-interest)', () => {
      const result = detectInstitutionTransaction({
        description: 'DIRECT DEP PAYROLL',
        paymentMethod: 'direct_deposit',
        checkNumber: null,
        accountType: 'checking',
        transactionType: 'income',
        amount: 3000,
      })
      expect(result).toBeNull()
    })
  })
})

describe('INSTITUTION_DISPLAY_NAMES', () => {
  it('has correct display names for all institutions', () => {
    expect(INSTITUTION_DISPLAY_NAMES.amex).toBe('American Express')
    expect(INSTITUTION_DISPLAY_NAMES.capital_one).toBe('Capital One')
    expect(INSTITUTION_DISPLAY_NAMES.chase).toBe('Chase')
    expect(INSTITUTION_DISPLAY_NAMES.lake_ridge).toBe('Lake Ridge Bank')
  })
})
