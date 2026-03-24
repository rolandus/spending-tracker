import { createServerFn } from '@tanstack/react-start'
import { db } from '../db'
import { transactions } from '../db/schema'
import { sql, eq } from 'drizzle-orm'

/**
 * Monthly spending grouped by category.
 * Filters to expenses only.
 */
export const getMonthlySpendingByCategory = createServerFn({ method: 'GET' })
  .inputValidator((data: { year: number; month: number }) => data)
  .handler(async ({ data }) => {
    const yearMonth = `${data.year}-${String(data.month).padStart(2, '0')}`

    const rows = db
      .select({
        category: sql<string>`COALESCE(${transactions.category}, 'Uncategorized')`,
        total: sql<number>`SUM(ABS(${transactions.amount}))`,
        count: sql<number>`count(*)`,
      })
      .from(transactions)
      .where(
        sql`${transactions.transactionType} = 'expense' AND ${transactions.ignored} = 0 AND ${transactions.date} LIKE ${yearMonth + '%'}`,
      )
      .groupBy(sql`COALESCE(${transactions.category}, 'Uncategorized')`)
      .orderBy(sql`SUM(ABS(${transactions.amount})) DESC`)
      .all()

    const grandTotal = rows.reduce((sum, r) => sum + r.total, 0)

    return { rows, grandTotal, year: data.year, month: data.month }
  })

/**
 * Monthly spending trend for the last N months.
 */
export const getMonthlySpendingTrend = createServerFn({ method: 'GET' })
  .inputValidator((data: { months?: number }) => data)
  .handler(async ({ data }) => {
    const months = data.months ?? 12

    const rows = db
      .select({
        yearMonth: sql<string>`SUBSTR(${transactions.date}, 1, 7)`,
        total: sql<number>`SUM(ABS(${transactions.amount}))`,
        count: sql<number>`count(*)`,
      })
      .from(transactions)
      .where(sql`${transactions.transactionType} = 'expense' AND ${transactions.ignored} = 0`)
      .groupBy(sql`SUBSTR(${transactions.date}, 1, 7)`)
      .orderBy(sql`SUBSTR(${transactions.date}, 1, 7) DESC`)
      .limit(months)
      .all()

    // Reverse to chronological order
    rows.reverse()

    const maxTotal = rows.length > 0 ? Math.max(...rows.map((r) => r.total)) : 0

    return { rows, maxTotal }
  })

/**
 * Payment method breakdown for expenses.
 */
export const getPaymentMethodBreakdown = createServerFn({ method: 'GET' })
  .inputValidator((data: { year?: number; month?: number }) => data)
  .handler(async ({ data }) => {
    let dateFilter = ''
    if (data.year && data.month) {
      const ym = `${data.year}-${String(data.month).padStart(2, '0')}`
      dateFilter = ` AND date LIKE '${ym}%'`
    } else if (data.year) {
      dateFilter = ` AND date LIKE '${data.year}%'`
    }

    const rows = db.all<{ method: string; total: number; count: number }>(
      sql.raw(`
        SELECT
          COALESCE(payment_method, 'unknown') as method,
          SUM(ABS(amount)) as total,
          COUNT(*) as count
        FROM transactions
        WHERE transaction_type = 'expense' AND ignored = 0${dateFilter}
        GROUP BY COALESCE(payment_method, 'unknown')
        ORDER BY SUM(ABS(amount)) DESC
      `),
    )

    const grandTotal = rows.reduce((sum, r) => sum + r.total, 0)

    return { rows, grandTotal }
  })

/**
 * Year-over-year comparison by category.
 */
export const getYearOverYearComparison = createServerFn({ method: 'GET' })
  .inputValidator((data: { year1: number; year2: number }) => data)
  .handler(async ({ data }) => {
    const getYearData = (year: number) =>
      db.all<{ category: string; total: number }>(
        sql.raw(`
          SELECT
            COALESCE(category, 'Uncategorized') as category,
            SUM(ABS(amount)) as total
          FROM transactions
          WHERE transaction_type = 'expense' AND ignored = 0 AND date LIKE '${year}%'
          GROUP BY COALESCE(category, 'Uncategorized')
          ORDER BY SUM(ABS(amount)) DESC
        `),
      )

    const year1Data = getYearData(data.year1)
    const year2Data = getYearData(data.year2)

    // Merge into a combined view
    const categories = new Set([
      ...year1Data.map((r) => r.category),
      ...year2Data.map((r) => r.category),
    ])

    const year1Map = new Map(year1Data.map((r) => [r.category, r.total]))
    const year2Map = new Map(year2Data.map((r) => [r.category, r.total]))

    const rows = Array.from(categories).map((category) => ({
      category,
      year1Total: year1Map.get(category) ?? 0,
      year2Total: year2Map.get(category) ?? 0,
    }))

    // Sort by total of both years
    rows.sort((a, b) => (b.year1Total + b.year2Total) - (a.year1Total + a.year2Total))

    return {
      rows,
      year1: data.year1,
      year2: data.year2,
      year1GrandTotal: year1Data.reduce((sum, r) => sum + r.total, 0),
      year2GrandTotal: year2Data.reduce((sum, r) => sum + r.total, 0),
    }
  })

/**
 * Monthly average income by category across all available data.
 * Only includes non-ignored income transactions.
 */
export const getIncomeAverages = createServerFn({ method: 'GET' }).handler(async () => {
  // Get the distinct months that have income data
  const monthRows = db.all<{ yearMonth: string }>(
    sql.raw(`
      SELECT DISTINCT SUBSTR(date, 1, 7) as yearMonth
      FROM transactions
      WHERE transaction_type = 'income' AND ignored = 0
      ORDER BY yearMonth ASC
    `),
  )

  if (monthRows.length === 0) {
    return { rows: [], grandTotal: 0, totalMonthlyAverage: 0, oldestMonth: null, newestMonth: null }
  }

  const numMonths = monthRows.length
  const oldestMonth = monthRows[0]!.yearMonth
  const newestMonth = monthRows[monthRows.length - 1]!.yearMonth

  // Get total income per category
  const rows = db.all<{ category: string; total: number }>(
    sql.raw(`
      SELECT
        COALESCE(category, 'Uncategorized') as category,
        SUM(ABS(amount)) as total
      FROM transactions
      WHERE transaction_type = 'income' AND ignored = 0
      GROUP BY COALESCE(category, 'Uncategorized')
      ORDER BY SUM(ABS(amount)) DESC
    `),
  )

  const rowsWithAverage = rows.map((r) => ({
    category: r.category,
    total: r.total,
    monthlyAverage: r.total / numMonths,
  }))

  // Sort by monthly average descending
  rowsWithAverage.sort((a, b) => b.monthlyAverage - a.monthlyAverage)

  const grandTotal = rows.reduce((sum, r) => sum + r.total, 0)
  const totalMonthlyAverage = grandTotal / numMonths

  return { rows: rowsWithAverage, grandTotal, totalMonthlyAverage, oldestMonth, newestMonth }
})

/**
 * Monthly average expenses by category across all available data.
 * Only includes non-ignored expense transactions.
 */
export const getExpenseAverages = createServerFn({ method: 'GET' }).handler(async () => {
  const monthRows = db.all<{ yearMonth: string }>(
    sql.raw(`
      SELECT DISTINCT SUBSTR(date, 1, 7) as yearMonth
      FROM transactions
      WHERE transaction_type = 'expense' AND ignored = 0
      ORDER BY yearMonth ASC
    `),
  )

  if (monthRows.length === 0) {
    return { rows: [], grandTotal: 0, totalMonthlyAverage: 0, oldestMonth: null, newestMonth: null }
  }

  const numMonths = monthRows.length
  const oldestMonth = monthRows[0]!.yearMonth
  const newestMonth = monthRows[monthRows.length - 1]!.yearMonth

  const rows = db.all<{ category: string; total: number }>(
    sql.raw(`
      SELECT
        COALESCE(category, 'Uncategorized') as category,
        SUM(ABS(amount)) as total
      FROM transactions
      WHERE transaction_type = 'expense' AND ignored = 0
      GROUP BY COALESCE(category, 'Uncategorized')
      ORDER BY SUM(ABS(amount)) DESC
    `),
  )

  const rowsWithAverage = rows.map((r) => ({
    category: r.category,
    total: r.total,
    monthlyAverage: r.total / numMonths,
  }))

  rowsWithAverage.sort((a, b) => b.monthlyAverage - a.monthlyAverage)

  const grandTotal = rows.reduce((sum, r) => sum + r.total, 0)
  const totalMonthlyAverage = grandTotal / numMonths

  return { rows: rowsWithAverage, grandTotal, totalMonthlyAverage, oldestMonth, newestMonth }
})

/**
 * Get available years and months from transaction data.
 */
export const getAvailablePeriods = createServerFn({ method: 'GET' }).handler(async () => {
  const months = db
    .select({
      yearMonth: sql<string>`DISTINCT SUBSTR(${transactions.date}, 1, 7)`,
    })
    .from(transactions)
    .where(eq(transactions.ignored, 0))
    .orderBy(sql`SUBSTR(${transactions.date}, 1, 7) DESC`)
    .all()

  const years = [...new Set(months.map((m) => parseInt(m.yearMonth.split('-')[0]!)))]

  return { months: months.map((m) => m.yearMonth), years }
})
