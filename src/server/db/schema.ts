import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  institution: text('institution', {
    enum: ['amex', 'capital_one', 'chase', 'fidelity', 'lake_ridge'],
  }).notNull(),
  type: text('type', {
    enum: ['checking', 'savings', 'credit_card', 'brokerage'],
  }).notNull(),
  last4: text('last4'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
})

export const transactions = sqliteTable('transactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id')
    .notNull()
    .references(() => accounts.id),
  date: text('date').notNull(), // YYYY-MM-DD
  postedDate: text('posted_date'), // YYYY-MM-DD, nullable
  description: text('description').notNull(),
  amount: real('amount').notNull(), // negative = money out, positive = money in
  transactionType: text('transaction_type', {
    enum: [
      'expense',
      'income',
      'internal_transfer',
      'cc_payment',
      'refund',
      'unknown',
    ],
  })
    .notNull()
    .default('unknown'),
  paymentMethod: text('payment_method', {
    enum: ['credit', 'ach', 'check', 'cash', 'transfer', 'direct_deposit'],
  }),
  checkNumber: text('check_number'),
  cardholder: text('cardholder'),
  sourceCategory: text('source_category'),
  category: text('category'),
  notes: text('notes'),
  merchantId: integer('merchant_id').references(() => merchants.id),
  ignored: integer('ignored').notNull().default(0),
  sourceFile: text('source_file').notNull(),
  importHash: text('import_hash').notNull().unique(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
})

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
})

export type CategoryRecord = typeof categories.$inferSelect

export const categoryRules = sqliteTable('category_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pattern: text('pattern').notNull(),
  matchType: text('match_type', {
    enum: ['contains', 'starts_with', 'exact'],
  })
    .notNull()
    .default('contains'),
  category: text('category').notNull(),
  priority: integer('priority').notNull().default(0),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
})

export type CategoryRule = typeof categoryRules.$inferSelect
export type NewCategoryRule = typeof categoryRules.$inferInsert

export const merchants = sqliteTable('merchants', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  status: text('status', { enum: ['confirmed', 'pending'] })
    .notNull()
    .default('confirmed'),
  modifiesMerchantId: integer('modifies_merchant_id').references(
    (): any => merchants.id,
  ),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
})

export const merchantPatterns = sqliteTable('merchant_patterns', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  merchantId: integer('merchant_id')
    .notNull()
    .references(() => merchants.id),
  pattern: text('pattern').notNull(),
  matchType: text('match_type', {
    enum: ['contains', 'starts_with', 'exact'],
  })
    .notNull()
    .default('contains'),
  defaultCategory: text('default_category'),
  defaultTransactionType: text('default_transaction_type'),
  defaultIgnored: integer('default_ignored').notNull().default(0),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
})

export type Merchant = typeof merchants.$inferSelect
export type NewMerchant = typeof merchants.$inferInsert
export type MerchantPattern = typeof merchantPatterns.$inferSelect
export type NewMerchantPattern = typeof merchantPatterns.$inferInsert

// Type exports for use throughout the app
export type Account = typeof accounts.$inferSelect
export type NewAccount = typeof accounts.$inferInsert
export type Transaction = typeof transactions.$inferSelect
export type NewTransaction = typeof transactions.$inferInsert
