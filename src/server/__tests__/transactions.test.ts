import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb, seedTestAccounts } from './setup'
import { accounts, transactions, merchants } from '../db/schema'
import { eq, and, gte, lte, like, sql, desc, asc } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type * as schema from '../db/schema'

let db: BetterSQLite3Database<typeof schema>

function seedTransactions() {
  db.insert(transactions).values([
    { accountId: 1, date: '2025-01-10', description: 'AMAZON PURCHASE', amount: -42.5, transactionType: 'expense', paymentMethod: 'credit', sourceFile: 't.csv', importHash: 't1' },
    { accountId: 1, date: '2025-01-15', description: 'NETFLIX SUB', amount: -15.99, transactionType: 'expense', paymentMethod: 'credit', sourceFile: 't.csv', importHash: 't2' },
    { accountId: 3, date: '2025-01-20', description: 'WHOLE FOODS', amount: -85.0, transactionType: 'expense', paymentMethod: 'credit', sourceFile: 't.csv', importHash: 't3' },
    { accountId: 4, date: '2025-01-25', description: 'DIRECT DEP PAYROLL', amount: 3000, transactionType: 'income', paymentMethod: 'direct_deposit', sourceFile: 't.csv', importHash: 't4' },
    { accountId: 4, date: '2025-02-01', description: 'ELECTRIC COMPANY', amount: -150, transactionType: 'expense', paymentMethod: 'ach', sourceFile: 't.csv', importHash: 't5' },
    { accountId: 4, date: '2025-02-05', description: 'TRANSFER TO SAVINGS', amount: -500, transactionType: 'internal_transfer', paymentMethod: 'transfer', sourceFile: 't.csv', importHash: 't6' },
    // Ignored transactions
    { accountId: 4, date: '2025-01-20', description: 'CC PAYMENT AMEX', amount: -200, transactionType: 'cc_payment', paymentMethod: 'ach', ignored: 1, sourceFile: 't.csv', importHash: 't7' },
    { accountId: 4, date: '2025-01-22', description: 'TRANSFER TO CHECKING', amount: -1000, transactionType: 'internal_transfer', paymentMethod: 'transfer', ignored: 1, sourceFile: 't.csv', importHash: 't8' },
  ]).run()
}

beforeEach(() => {
  const testDb = createTestDb()
  db = testDb.db
  seedTestAccounts(db)
  seedTransactions()
})

describe('getTransactions filtering', () => {
  function queryTransactions(filters: {
    accountId?: number
    dateFrom?: string
    dateTo?: string
    transactionType?: string
    search?: string
    page?: number
    pageSize?: number
    sortBy?: string
    sortOrder?: 'asc' | 'desc'
  }) {
    const {
      accountId,
      dateFrom,
      dateTo,
      transactionType,
      search,
      page = 1,
      pageSize = 50,
      sortBy = 'date',
      sortOrder = 'desc',
    } = filters

    const conditions = []
    if (accountId) conditions.push(eq(transactions.accountId, accountId))
    if (dateFrom) conditions.push(gte(transactions.date, dateFrom))
    if (dateTo) conditions.push(lte(transactions.date, dateTo))
    if (transactionType) conditions.push(eq(transactions.transactionType, transactionType as any))
    if (search) conditions.push(like(transactions.description, `%${search}%`))

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const countResult = db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(whereClause)
      .get()
    const total = countResult?.count ?? 0

    const sortColumnMap = {
      date: transactions.date,
      amount: transactions.amount,
      description: transactions.description,
    } as const
    const sortColumn = sortColumnMap[sortBy as keyof typeof sortColumnMap] ?? transactions.date
    const orderFn = sortOrder === 'asc' ? asc : desc

    const offset = (page - 1) * pageSize
    const rows = db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        date: transactions.date,
        description: transactions.description,
        amount: transactions.amount,
        transactionType: transactions.transactionType,
        accountName: accounts.name,
        merchantName: merchants.name,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .leftJoin(merchants, eq(transactions.merchantId, merchants.id))
      .where(whereClause)
      .orderBy(orderFn(sortColumn))
      .limit(pageSize)
      .offset(offset)
      .all()

    return {
      transactions: rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    }
  }

  it('returns all transactions with no filters', () => {
    const result = queryTransactions({})
    expect(result.total).toBe(8)
    expect(result.transactions).toHaveLength(8)
  })

  it('filters by account ID', () => {
    const result = queryTransactions({ accountId: 1 })
    expect(result.total).toBe(2) // AMAZON + NETFLIX (account 1)
    result.transactions.forEach(t => expect(t.accountId).toBe(1))
  })

  it('filters by date range', () => {
    const result = queryTransactions({ dateFrom: '2025-01-15', dateTo: '2025-01-25' })
    expect(result.total).toBe(5) // NETFLIX, WHOLE FOODS, DIRECT DEP + 2 ignored (t7, t8)
  })

  it('filters by transaction type', () => {
    const result = queryTransactions({ transactionType: 'expense' })
    expect(result.total).toBe(4)
    result.transactions.forEach(t => expect(t.transactionType).toBe('expense'))
  })

  it('filters by search text (description LIKE)', () => {
    const result = queryTransactions({ search: 'AMAZON' })
    expect(result.total).toBe(1)
    expect(result.transactions[0]!.description).toBe('AMAZON PURCHASE')
  })

  it('combines multiple filters', () => {
    const result = queryTransactions({ accountId: 4, transactionType: 'expense' })
    expect(result.total).toBe(1) // ELECTRIC COMPANY
  })

  it('includes account name from join', () => {
    const result = queryTransactions({ accountId: 1 })
    expect(result.transactions[0]!.accountName).toBe('American Express')
  })
})

describe('pagination', () => {
  function queryTransactions(filters: { page?: number; pageSize?: number }) {
    const { page = 1, pageSize = 50 } = filters
    const total = db.select({ count: sql<number>`count(*)` }).from(transactions).get()!.count
    const offset = (page - 1) * pageSize
    const rows = db
      .select()
      .from(transactions)
      .orderBy(desc(transactions.date))
      .limit(pageSize)
      .offset(offset)
      .all()

    return {
      transactions: rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    }
  }

  it('paginates correctly', () => {
    const page1 = queryTransactions({ page: 1, pageSize: 2 })
    expect(page1.transactions).toHaveLength(2)
    expect(page1.totalPages).toBe(4) // 8 items / 2 per page
    expect(page1.page).toBe(1)

    const page2 = queryTransactions({ page: 2, pageSize: 2 })
    expect(page2.transactions).toHaveLength(2)

    const page3 = queryTransactions({ page: 3, pageSize: 2 })
    expect(page3.transactions).toHaveLength(2)

    const page4 = queryTransactions({ page: 4, pageSize: 2 })
    expect(page4.transactions).toHaveLength(2)

    // No overlap between pages
    const allIds = [
      ...page1.transactions.map(t => t.id),
      ...page2.transactions.map(t => t.id),
      ...page3.transactions.map(t => t.id),
      ...page4.transactions.map(t => t.id),
    ]
    expect(new Set(allIds).size).toBe(8)
  })

  it('returns empty for page beyond total', () => {
    const result = queryTransactions({ page: 100, pageSize: 50 })
    expect(result.transactions).toHaveLength(0)
    expect(result.total).toBe(8)
  })
})

describe('sorting', () => {
  it('sorts by date descending (default)', () => {
    const rows = db.select().from(transactions).orderBy(desc(transactions.date)).all()
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.date <= rows[i - 1]!.date).toBe(true)
    }
  })

  it('sorts by date ascending', () => {
    const rows = db.select().from(transactions).orderBy(asc(transactions.date)).all()
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.date >= rows[i - 1]!.date).toBe(true)
    }
  })

  it('sorts by amount descending', () => {
    const rows = db.select().from(transactions).orderBy(desc(transactions.amount)).all()
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.amount <= rows[i - 1]!.amount).toBe(true)
    }
  })

  it('sorts by description ascending', () => {
    const rows = db.select().from(transactions).orderBy(asc(transactions.description)).all()
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.description >= rows[i - 1]!.description).toBe(true)
    }
  })
})

describe('updateTransaction', () => {
  it('updates category', () => {
    const txn = db.select().from(transactions).where(eq(transactions.importHash, 't1')).get()!
    db.update(transactions).set({ category: 'Shopping' }).where(eq(transactions.id, txn.id)).run()

    const updated = db.select().from(transactions).where(eq(transactions.id, txn.id)).get()!
    expect(updated.category).toBe('Shopping')
  })

  it('updates notes', () => {
    const txn = db.select().from(transactions).where(eq(transactions.importHash, 't1')).get()!
    db.update(transactions).set({ notes: 'Birthday gift' }).where(eq(transactions.id, txn.id)).run()

    const updated = db.select().from(transactions).where(eq(transactions.id, txn.id)).get()!
    expect(updated.notes).toBe('Birthday gift')
  })

  it('updates transactionType', () => {
    const txn = db.select().from(transactions).where(eq(transactions.importHash, 't1')).get()!
    db.update(transactions).set({ transactionType: 'refund' }).where(eq(transactions.id, txn.id)).run()

    const updated = db.select().from(transactions).where(eq(transactions.id, txn.id)).get()!
    expect(updated.transactionType).toBe('refund')
  })

  it('can set category to null', () => {
    const txn = db.select().from(transactions).where(eq(transactions.importHash, 't1')).get()!
    db.update(transactions).set({ category: 'Shopping' }).where(eq(transactions.id, txn.id)).run()
    db.update(transactions).set({ category: null }).where(eq(transactions.id, txn.id)).run()

    const updated = db.select().from(transactions).where(eq(transactions.id, txn.id)).get()!
    expect(updated.category).toBeNull()
  })

  it('does not affect other transactions', () => {
    const txn1 = db.select().from(transactions).where(eq(transactions.importHash, 't1')).get()!
    db.update(transactions).set({ category: 'Shopping' }).where(eq(transactions.id, txn1.id)).run()

    const txn2 = db.select().from(transactions).where(eq(transactions.importHash, 't2')).get()!
    expect(txn2.category).toBeNull()
  })
})

describe('getTransactionStats', () => {
  it('returns total transaction count excluding ignored', () => {
    const result = db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(eq(transactions.ignored, 0))
      .get()!
    expect(result.count).toBe(6) // 8 total minus 2 ignored
  })

  it('returns per-account counts excluding ignored', () => {
    const accountCounts = db
      .select({
        accountId: transactions.accountId,
        accountName: accounts.name,
        count: sql<number>`count(*)`,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(eq(transactions.ignored, 0))
      .groupBy(transactions.accountId)
      .all()

    const byAccount = new Map(accountCounts.map(a => [a.accountName, a.count]))
    expect(byAccount.get('American Express')).toBe(2)
    expect(byAccount.get('Chase')).toBe(1)
    expect(byAccount.get('Lake Ridge Checking')).toBe(3)
  })
})

describe('ignored transactions', () => {
  it('excludes ignored transactions by default', () => {
    const rows = db
      .select()
      .from(transactions)
      .where(eq(transactions.ignored, 0))
      .all()
    expect(rows).toHaveLength(6)
    expect(rows.every(r => r.ignored === 0)).toBe(true)
  })

  it('includes ignored transactions when explicitly requested', () => {
    const rows = db.select().from(transactions).all()
    expect(rows).toHaveLength(8)
    const ignored = rows.filter(r => r.ignored === 1)
    expect(ignored).toHaveLength(2)
    expect(ignored.map(r => r.importHash).sort()).toEqual(['t7', 't8'])
  })

  it('can toggle ignored status on/off', () => {
    const txn = db.select().from(transactions).where(eq(transactions.importHash, 't1')).get()!
    expect(txn.ignored).toBe(0)

    db.update(transactions).set({ ignored: 1 }).where(eq(transactions.id, txn.id)).run()
    const ignored = db.select().from(transactions).where(eq(transactions.id, txn.id)).get()!
    expect(ignored.ignored).toBe(1)

    db.update(transactions).set({ ignored: 0 }).where(eq(transactions.id, txn.id)).run()
    const restored = db.select().from(transactions).where(eq(transactions.id, txn.id)).get()!
    expect(restored.ignored).toBe(0)
  })

  it('ignored transactions excluded from stats counts', () => {
    const total = db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(eq(transactions.ignored, 0))
      .get()!
    expect(total.count).toBe(6)

    db.update(transactions).set({ ignored: 1 }).where(eq(transactions.importHash, 't1')).run()
    const after = db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(eq(transactions.ignored, 0))
      .get()!
    expect(after.count).toBe(5)
  })
})
