import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'

/**
 * Create a fresh in-memory SQLite database with the full schema applied.
 * Each test (or test suite) gets its own isolated DB — no shared state.
 *
 * NOTE: If a future migration transforms existing data (not just DDL),
 * add a dedicated migration test that applies the migration to fixture data
 * and asserts the transformation is correct.
 */
export function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  // Apply migrations in order
  sqlite.exec(`
    CREATE TABLE accounts (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      name text NOT NULL,
      institution text NOT NULL,
      type text NOT NULL,
      last4 text,
      is_active integer DEFAULT 1 NOT NULL
    );

    CREATE TABLE transactions (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      account_id integer NOT NULL,
      date text NOT NULL,
      posted_date text,
      description text NOT NULL,
      amount real NOT NULL,
      transaction_type text DEFAULT 'unknown' NOT NULL,
      payment_method text,
      check_number text,
      cardholder text,
      source_category text,
      category text,
      notes text,
      merchant_id integer,
      source_file text NOT NULL,
      import_hash text NOT NULL,
      created_at text DEFAULT (datetime('now')) NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON UPDATE no action ON DELETE no action,
      FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    );

    CREATE UNIQUE INDEX transactions_import_hash_unique ON transactions (import_hash);

    CREATE TABLE category_rules (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      pattern text NOT NULL,
      match_type text DEFAULT 'contains' NOT NULL,
      category text NOT NULL,
      priority integer DEFAULT 0 NOT NULL,
      created_at text DEFAULT (datetime('now')) NOT NULL
    );

    CREATE TABLE merchants (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      name text NOT NULL,
      default_category text,
      created_at text DEFAULT (datetime('now')) NOT NULL
    );

    CREATE TABLE merchant_patterns (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      merchant_id integer NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      pattern text NOT NULL,
      match_type text DEFAULT 'contains' NOT NULL,
      created_at text DEFAULT (datetime('now')) NOT NULL
    );
  `)

  const db = drizzle(sqlite, { schema })
  return { db, sqlite }
}

/**
 * Seed standard test accounts matching the production seed data.
 */
export function seedTestAccounts(db: BetterSQLite3Database<typeof schema>) {
  db.insert(schema.accounts).values([
    { id: 1, name: 'American Express', institution: 'amex', type: 'credit_card' },
    { id: 2, name: 'Capital One', institution: 'capital_one', type: 'credit_card' },
    { id: 3, name: 'Chase', institution: 'chase', type: 'credit_card' },
    { id: 4, name: 'Lake Ridge Checking', institution: 'lake_ridge', type: 'checking' },
    { id: 5, name: 'Lake Ridge Savings', institution: 'lake_ridge', type: 'savings' },
    { id: 6, name: 'Lake Ridge Spending', institution: 'lake_ridge', type: 'checking' },
  ]).run()
}
