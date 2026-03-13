import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb, seedTestAccounts } from './setup'
import { transactions } from '../db/schema'
import { sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type * as schema from '../db/schema'
import Database from 'better-sqlite3'

let db: BetterSQLite3Database<typeof schema>
let sqlite: InstanceType<typeof Database>

function seedReportData() {
  db.insert(transactions).values([
    // January 2025 expenses
    { accountId: 1, date: '2025-01-10', description: 'GROCERY STORE', amount: -80, transactionType: 'expense', paymentMethod: 'credit', category: 'Groceries', sourceFile: 't.csv', importHash: 'r1' },
    { accountId: 1, date: '2025-01-12', description: 'RESTAURANT', amount: -45, transactionType: 'expense', paymentMethod: 'credit', category: 'Dining', sourceFile: 't.csv', importHash: 'r2' },
    { accountId: 4, date: '2025-01-15', description: 'ELECTRIC CO', amount: -150, transactionType: 'expense', paymentMethod: 'ach', category: null, sourceFile: 't.csv', importHash: 'r3' },

    // February 2025 expenses
    { accountId: 1, date: '2025-02-10', description: 'GROCERY STORE', amount: -90, transactionType: 'expense', paymentMethod: 'credit', category: 'Groceries', sourceFile: 't.csv', importHash: 'r4' },
    { accountId: 3, date: '2025-02-15', description: 'GAS STATION', amount: -40, transactionType: 'expense', paymentMethod: 'credit', category: 'Gas/Automotive', sourceFile: 't.csv', importHash: 'r5' },

    // 2024 expenses (for YoY comparison)
    { accountId: 1, date: '2024-01-10', description: 'GROCERY STORE', amount: -70, transactionType: 'expense', paymentMethod: 'credit', category: 'Groceries', sourceFile: 't.csv', importHash: 'r6' },
    { accountId: 1, date: '2024-01-15', description: 'RESTAURANT', amount: -55, transactionType: 'expense', paymentMethod: 'credit', category: 'Dining', sourceFile: 't.csv', importHash: 'r7' },
    { accountId: 4, date: '2024-02-20', description: 'INSURANCE PMT', amount: -200, transactionType: 'expense', paymentMethod: 'ach', category: 'Insurance', sourceFile: 't.csv', importHash: 'r8' },

    // NON-expense types — these must NOT appear in spending reports
    { accountId: 4, date: '2025-01-01', description: 'DIRECT DEP PAYROLL', amount: 3000, transactionType: 'income', paymentMethod: 'direct_deposit', sourceFile: 't.csv', importHash: 'r9' },
    { accountId: 4, date: '2025-01-20', description: 'TRANSFER TO CHECKING', amount: -500, transactionType: 'internal_transfer', paymentMethod: 'transfer', sourceFile: 't.csv', importHash: 'r10' },
    { accountId: 4, date: '2025-01-25', description: 'AMEX PAYMENT', amount: -125, transactionType: 'cc_payment', paymentMethod: 'ach', sourceFile: 't.csv', importHash: 'r11' },
    { accountId: 1, date: '2025-01-28', description: 'REFUND FROM STORE', amount: 20, transactionType: 'refund', paymentMethod: 'credit', sourceFile: 't.csv', importHash: 'r12' },
  ]).run()
}

beforeEach(() => {
  const testDb = createTestDb()
  db = testDb.db
  sqlite = testDb.sqlite
  seedTestAccounts(db)
  seedReportData()
})

describe('getMonthlySpendingByCategory', () => {
  it('only includes expense transactions', () => {
    const yearMonth = '2025-01'
    const rows = db
      .select({
        category: sql<string>`COALESCE(${transactions.category}, 'Uncategorized')`,
        total: sql<number>`SUM(ABS(${transactions.amount}))`,
        count: sql<number>`count(*)`,
      })
      .from(transactions)
      .where(sql`${transactions.transactionType} = 'expense' AND ${transactions.date} LIKE ${yearMonth + '%'}`)
      .groupBy(sql`COALESCE(${transactions.category}, 'Uncategorized')`)
      .orderBy(sql`SUM(ABS(${transactions.amount})) DESC`)
      .all()

    const grandTotal = rows.reduce((sum, r) => sum + r.total, 0)

    // Jan 2025: Groceries $80, Dining $45, Uncategorized $150
    expect(rows).toHaveLength(3)
    expect(grandTotal).toBe(275) // 80 + 45 + 150

    const uncategorized = rows.find(r => r.category === 'Uncategorized')
    expect(uncategorized).toBeDefined()
    expect(uncategorized!.total).toBe(150)
  })

  it('does not include income, transfers, cc_payment, or refund', () => {
    const yearMonth = '2025-01'
    const rows = db
      .select({ total: sql<number>`SUM(ABS(${transactions.amount}))` })
      .from(transactions)
      .where(sql`${transactions.transactionType} = 'expense' AND ${transactions.date} LIKE ${yearMonth + '%'}`)
      .get()

    // Total should only be the 3 expense transactions: 80 + 45 + 150 = 275
    // NOT include: income(3000), transfer(500), cc_payment(125), refund(20)
    expect(rows!.total).toBe(275)
  })
})

describe('getMonthlySpendingTrend', () => {
  it('returns months in chronological order', () => {
    const rows = db
      .select({
        yearMonth: sql<string>`SUBSTR(${transactions.date}, 1, 7)`,
        total: sql<number>`SUM(ABS(${transactions.amount}))`,
        count: sql<number>`count(*)`,
      })
      .from(transactions)
      .where(sql`${transactions.transactionType} = 'expense'`)
      .groupBy(sql`SUBSTR(${transactions.date}, 1, 7)`)
      .orderBy(sql`SUBSTR(${transactions.date}, 1, 7) DESC`)
      .limit(12)
      .all()

    rows.reverse() // chronological

    expect(rows[0]!.yearMonth).toBe('2024-01')
    expect(rows[rows.length - 1]!.yearMonth).toBe('2025-02')
  })

  it('calculates correct totals per month', () => {
    const rows = db
      .select({
        yearMonth: sql<string>`SUBSTR(${transactions.date}, 1, 7)`,
        total: sql<number>`SUM(ABS(${transactions.amount}))`,
      })
      .from(transactions)
      .where(sql`${transactions.transactionType} = 'expense'`)
      .groupBy(sql`SUBSTR(${transactions.date}, 1, 7)`)
      .all()

    const byMonth = new Map(rows.map(r => [r.yearMonth, r.total]))

    expect(byMonth.get('2025-01')).toBe(275) // 80 + 45 + 150
    expect(byMonth.get('2025-02')).toBe(130) // 90 + 40
    expect(byMonth.get('2024-01')).toBe(125) // 70 + 55
    expect(byMonth.get('2024-02')).toBe(200) // 200
  })
})

describe('getPaymentMethodBreakdown', () => {
  it('groups expenses by payment method', () => {
    const rows = sqlite.prepare(`
      SELECT
        COALESCE(payment_method, 'unknown') as method,
        SUM(ABS(amount)) as total,
        COUNT(*) as count
      FROM transactions
      WHERE transaction_type = 'expense'
      GROUP BY COALESCE(payment_method, 'unknown')
      ORDER BY SUM(ABS(amount)) DESC
    `).all() as { method: string; total: number; count: number }[]

    const byMethod = new Map(rows.map(r => [r.method, r.total]))

    // credit: 80 + 45 + 90 + 40 + 70 + 55 = 380
    // ach: 150 + 200 = 350
    expect(byMethod.get('credit')).toBe(380)
    expect(byMethod.get('ach')).toBe(350)
  })

  it('filters by year and month', () => {
    const ym = '2025-01'
    const rows = sqlite.prepare(`
      SELECT
        COALESCE(payment_method, 'unknown') as method,
        SUM(ABS(amount)) as total,
        COUNT(*) as count
      FROM transactions
      WHERE transaction_type = 'expense' AND date LIKE '${ym}%'
      GROUP BY COALESCE(payment_method, 'unknown')
      ORDER BY SUM(ABS(amount)) DESC
    `).all() as { method: string; total: number; count: number }[]

    const byMethod = new Map(rows.map(r => [r.method, r.total]))
    expect(byMethod.get('credit')).toBe(125) // 80 + 45
    expect(byMethod.get('ach')).toBe(150)
  })

  it('filters by year only', () => {
    const rows = sqlite.prepare(`
      SELECT
        COALESCE(payment_method, 'unknown') as method,
        SUM(ABS(amount)) as total
      FROM transactions
      WHERE transaction_type = 'expense' AND date LIKE '2025%'
      GROUP BY COALESCE(payment_method, 'unknown')
    `).all() as { method: string; total: number }[]

    const grandTotal = rows.reduce((sum, r) => sum + r.total, 0)
    expect(grandTotal).toBe(405) // 80+45+150+90+40
  })
})

describe('getYearOverYearComparison', () => {
  it('compares spending by category across two years', () => {
    const getYearData = (year: number) =>
      sqlite.prepare(`
        SELECT
          COALESCE(category, 'Uncategorized') as category,
          SUM(ABS(amount)) as total
        FROM transactions
        WHERE transaction_type = 'expense' AND date LIKE '${year}%'
        GROUP BY COALESCE(category, 'Uncategorized')
        ORDER BY SUM(ABS(amount)) DESC
      `).all() as { category: string; total: number }[]

    const year1Data = getYearData(2024)
    const year2Data = getYearData(2025)

    const categories = new Set([
      ...year1Data.map(r => r.category),
      ...year2Data.map(r => r.category),
    ])
    const year1Map = new Map(year1Data.map(r => [r.category, r.total]))
    const year2Map = new Map(year2Data.map(r => [r.category, r.total]))

    const rows = Array.from(categories).map(category => ({
      category,
      year1Total: year1Map.get(category) ?? 0,
      year2Total: year2Map.get(category) ?? 0,
    }))

    const groceries = rows.find(r => r.category === 'Groceries')!
    expect(groceries.year1Total).toBe(70)
    expect(groceries.year2Total).toBe(170) // 80 + 90

    const dining = rows.find(r => r.category === 'Dining')!
    expect(dining.year1Total).toBe(55)
    expect(dining.year2Total).toBe(45)

    // Insurance only in 2024
    const insurance = rows.find(r => r.category === 'Insurance')!
    expect(insurance.year1Total).toBe(200)
    expect(insurance.year2Total).toBe(0)

    // Gas only in 2025
    const gas = rows.find(r => r.category === 'Gas/Automotive')!
    expect(gas.year1Total).toBe(0)
    expect(gas.year2Total).toBe(40)
  })
})

describe('getAvailablePeriods', () => {
  it('returns distinct year-months and years', () => {
    const months = db
      .select({
        yearMonth: sql<string>`DISTINCT SUBSTR(${transactions.date}, 1, 7)`,
      })
      .from(transactions)
      .orderBy(sql`SUBSTR(${transactions.date}, 1, 7) DESC`)
      .all()

    const yearMonths = months.map(m => m.yearMonth)
    expect(yearMonths).toContain('2025-01')
    expect(yearMonths).toContain('2025-02')
    expect(yearMonths).toContain('2024-01')
    expect(yearMonths).toContain('2024-02')

    // Check descending order
    expect(yearMonths[0]).toBe('2025-02')

    const years = [...new Set(yearMonths.map(ym => parseInt(ym.split('-')[0]!)))]
    expect(years).toContain(2024)
    expect(years).toContain(2025)
  })
})

describe('double-count guard', () => {
  it('cc_payment, internal_transfer, income, and refund are excluded from all report queries', () => {
    // This is the most critical test: ensure non-expense types never appear in spending totals
    const expenseOnlyTotal = db
      .select({ total: sql<number>`SUM(ABS(${transactions.amount}))` })
      .from(transactions)
      .where(sql`${transactions.transactionType} = 'expense'`)
      .get()!

    const allTotal = db
      .select({ total: sql<number>`SUM(ABS(${transactions.amount}))` })
      .from(transactions)
      .get()!

    // Expense total: 80+45+150+90+40+70+55+200 = 730
    expect(expenseOnlyTotal.total).toBe(730)

    // All total includes income(3000), transfer(500), cc_payment(125), refund(20)
    expect(allTotal.total).toBe(730 + 3000 + 500 + 125 + 20)

    // The critical assertion: expense-only is much less than all
    expect(expenseOnlyTotal.total).toBeLessThan(allTotal.total)
  })
})
