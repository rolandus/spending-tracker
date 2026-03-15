import { createServerFn } from '@tanstack/react-start'
import { db } from '../db'
import { transactions, accounts, merchants } from '../db/schema'
import { eq, and, gte, lte, like, sql, desc, asc } from 'drizzle-orm'
import type { Transaction } from '../db/schema'

export interface TransactionFilters {
  accountId?: number
  dateFrom?: string
  dateTo?: string
  transactionType?: string
  search?: string
  showIgnored?: boolean
  page?: number
  pageSize?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export interface TransactionWithAccount extends Transaction {
  accountName: string
  accountInstitution: string
  merchantName: string | null
}

export interface TransactionListResult {
  transactions: TransactionWithAccount[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

/**
 * Fetch transactions with filtering, pagination, and sorting.
 */
export const getTransactions = createServerFn({ method: 'GET' })
  .inputValidator((data: TransactionFilters) => data)
  .handler(async ({ data }): Promise<TransactionListResult> => {
    const {
      accountId,
      dateFrom,
      dateTo,
      transactionType,
      search,
      showIgnored,
      page = 1,
      pageSize = 50,
      sortBy = 'date',
      sortOrder = 'desc',
    } = data

    // Build WHERE conditions
    const conditions = []

    // Exclude ignored transactions unless explicitly requested
    if (!showIgnored) {
      conditions.push(eq(transactions.ignored, 0))
    }

    if (accountId) {
      conditions.push(eq(transactions.accountId, accountId))
    }
    if (dateFrom) {
      conditions.push(gte(transactions.date, dateFrom))
    }
    if (dateTo) {
      conditions.push(lte(transactions.date, dateTo))
    }
    if (transactionType) {
      conditions.push(eq(transactions.transactionType, transactionType as Transaction['transactionType']))
    }
    if (search) {
      conditions.push(like(transactions.description, `%${search}%`))
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    // Get total count
    const countResult = db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(whereClause)
      .get()
    const total = countResult?.count ?? 0

    // Sort column mapping
    const sortColumnMap = {
      date: transactions.date,
      amount: transactions.amount,
      description: transactions.description,
    } as const
    const sortColumn = sortColumnMap[sortBy as keyof typeof sortColumnMap] ?? transactions.date
    const orderFn = sortOrder === 'asc' ? asc : desc

    // Fetch paginated results with account info
    const offset = (page - 1) * pageSize
    const rows = db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        date: transactions.date,
        postedDate: transactions.postedDate,
        description: transactions.description,
        amount: transactions.amount,
        transactionType: transactions.transactionType,
        paymentMethod: transactions.paymentMethod,
        checkNumber: transactions.checkNumber,
        cardholder: transactions.cardholder,
        sourceCategory: transactions.sourceCategory,
        category: transactions.category,
        notes: transactions.notes,
        merchantId: transactions.merchantId,
        ignored: transactions.ignored,
        sourceFile: transactions.sourceFile,
        importHash: transactions.importHash,
        createdAt: transactions.createdAt,
        accountName: accounts.name,
        accountInstitution: accounts.institution,
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
  })

/**
 * Get summary stats for the dashboard.
 */
/**
 * Fetch a single transaction by ID with account info.
 */
export const getTransaction = createServerFn({ method: 'GET' })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    const row = db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        date: transactions.date,
        postedDate: transactions.postedDate,
        description: transactions.description,
        amount: transactions.amount,
        transactionType: transactions.transactionType,
        paymentMethod: transactions.paymentMethod,
        checkNumber: transactions.checkNumber,
        cardholder: transactions.cardholder,
        sourceCategory: transactions.sourceCategory,
        category: transactions.category,
        notes: transactions.notes,
        merchantId: transactions.merchantId,
        ignored: transactions.ignored,
        sourceFile: transactions.sourceFile,
        importHash: transactions.importHash,
        createdAt: transactions.createdAt,
        accountName: accounts.name,
        accountInstitution: accounts.institution,
        merchantName: merchants.name,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .leftJoin(merchants, eq(transactions.merchantId, merchants.id))
      .where(eq(transactions.id, data.id))
      .get()

    if (!row) {
      throw new Error(`Transaction ${data.id} not found`)
    }

    return row
  })

/**
 * Update mutable fields on a transaction (category, notes, transactionType).
 */
export const updateTransaction = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: {
      id: number
      category?: string | null
      notes?: string | null
      transactionType?: Transaction['transactionType']
      ignored?: number
    }) => data,
  )
  .handler(async ({ data }) => {
    const { id, ...fields } = data
    const updates: Record<string, unknown> = {}

    if ('category' in fields) updates.category = fields.category
    if ('notes' in fields) updates.notes = fields.notes
    if ('transactionType' in fields) updates.transactionType = fields.transactionType
    if ('ignored' in fields) updates.ignored = fields.ignored

    if (Object.keys(updates).length === 0) {
      throw new Error('No fields to update')
    }

    db.update(transactions).set(updates).where(eq(transactions.id, id)).run()

    return { success: true }
  })

/**
 * Get summary stats for the dashboard.
 */
export const getTransactionStats = createServerFn({ method: 'GET' }).handler(async () => {
  const totalResult = db
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(eq(transactions.ignored, 0))
    .get()

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

  return {
    totalTransactions: totalResult?.count ?? 0,
    byAccount: accountCounts,
  }
})
