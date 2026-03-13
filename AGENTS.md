# Spending Tracker — Agent Context

This document captures non-obvious design decisions, data source quirks, and project context
that won't be apparent from reading the code alone. Read this before making changes.

---

## What This App Is

A personal finance tracker for a single user (Roland Scott) that imports CSV exports from
bank and credit card institutions, normalizes them into a SQLite database, and will eventually
support spending categorization, reporting, and analytics.

The guiding principle: **the raw transaction data is the source of truth**. Everything else
(categories, reports, budgets) is built on top of it. Getting the import layer right takes
priority over everything else.

---

## Running the App

```bash
cd ~/Projects/spending-tracker
npm run dev          # starts dev server at http://localhost:3000 (accessible on home network)
npm run seed         # seeds the accounts table (safe to re-run — skips if rows exist)
```

The database lives at `./data/spending.db`. It is a SQLite file — no server needed.

### First-time setup
```bash
npm install
npx drizzle-kit migrate   # applies migrations in ./drizzle/
npm run seed               # populates the accounts table
npm run dev
```

---

## Tech Stack & Why

| Layer | Choice | Reason |
|---|---|---|
| Framework | TanStack Start | Cohesive with Router/Query/Table; simpler mental model than Next.js RSC for a heavily-interactive CRUD app |
| Routing + data loading | TanStack Router | Type-safe search params, loaders, and server functions end-to-end |
| Tables | TanStack Table | Headless, best-in-class for sortable/filterable/paginated data tables |
| Database | SQLite via `better-sqlite3` | Single-file, zero-administration, synchronous API fits perfectly |
| ORM + migrations | Drizzle ORM + drizzle-kit | Schema-as-code; `drizzle-kit generate` diffs schema changes into migration files |
| Styling | Tailwind CSS v4 | Utility-first, fast iteration |
| Language | TypeScript | Same language for importers, server functions, and UI |

**Server functions** (`createServerFn`) are the data access layer — they run on the server
and are called directly from route loaders and components. There is no separate REST API.

---

## Data Sources

CSV files live in `~/Documents/Statements/`. There are currently 5 distinct account types
across 4 institutions, with 11 CSV files covering roughly March 2024 – March 2026.

### Institution quirks — critical for the importers

#### American Express (`importers/amex.ts`)
- **Columns:** Date, Description, Card Member, Account #, Amount
- **Amount convention is inverted:** positive = a charge (money out), negative = reward/refund.
  The importer negates the raw value so our schema convention (negative = money out) holds.
- **Has a `Card Member` field** — this is the only source that identifies the cardholder.
  Stored in the `cardholder` column. Values are "ROLAND G SCOTT" and "LISA M SCOTT".
- No category column.
- Date format: MM/DD/YYYY

#### Capital One (`importers/capital-one.ts`)
- **Columns:** Transaction Date, Posted Date, Card No., Description, Category, Debit, Credit
- **Split debit/credit columns:** one is populated per row, the other is blank. Debit = charge
  (positive number), Credit = payment/refund (positive number). Importer normalizes to signed amount.
- Has both Transaction Date and Posted Date — both are stored.
- **Has a Category column** — the richest source category data. Stored in `source_category`.
  Categories include: Merchandise, Health Care, Gas/Automotive, Entertainment, Dining, Other,
  Fee/Interest Charge, Internet, Phone/Cable, Other Services.
- Date format: YYYY-MM-DD (already ISO — no conversion needed)
- Card number shown as last 4 digits; two cards exist (4880, 6593).

#### Chase (`importers/chase.ts`)
- **Columns:** Transaction Date, Post Date, Description, Category, Type, Amount, Memo
- Amount is already signed: negative = expense, positive = payment. No inversion needed.
- Has a Type field ("Sale", "Payment", "Fee") — not currently stored but available.
- Has a Category column (broader than Capital One: "Shopping", "Fees & Adjustments", etc.).
- Date format: MM/DD/YYYY

#### Lake Ridge Bank (`importers/lake-ridge.ts`)
- **Columns:** "Date","Description","Comments","Check Number","Amount","Balance"
- **All fields are quoted** in the CSV, including numeric ones. The CSV parser handles this.
- **Amount format:** prefixed with `$` and optionally a negative sign: `"-$75.87"`, `"$762.00"`.
  The `parseAmount()` utility strips `"`, `$`, and `,` before parsing.
- Has a **Check Number** column — populated for paper checks, blank otherwise. Stored in
  `check_number`; used to infer `payment_method = 'check'`.
- Has a **Balance** column (running balance) — read and discarded; not stored.
- Same CSV format for all three Lake Ridge account types. The importer infers account type
  from the filename (`savings` substring → `'savings'`, otherwise `'checking'`).
- No category column.
- Date format: MM/DD/YYYY (inside quotes)

---

## Account Structure

Six accounts are seeded into the `accounts` table by `npm run seed`:

| Name | Institution | Type |
|---|---|---|
| American Express | amex | credit_card |
| Capital One | capital_one | credit_card |
| Chase | chase | credit_card |
| Lake Ridge Checking | lake_ridge | checking |
| Lake Ridge Savings | lake_ridge | savings |
| Lake Ridge Spending | lake_ridge | checking |

### The Lake Ridge Spending Account
This account has an unusual history that affects how its transactions should be interpreted:
- **Paycheck direct deposits land here**, not in checking.
- **Earlier period:** Credit card bills for discretionary spending were paid directly from
  this account. So outflows to AmEx/Chase/Capital One from Spending = cc_payment.
- **Later period:** The strategy changed — all outgoing payments now flow from Checking.
  Money is transferred from Spending → Checking, and Checking pays the bills.
- The result: Spending account transactions are mostly `income` (direct deposit) and
  `internal_transfer` (to Checking). The `inferTransactionType()` heuristic handles this,
  but edge cases may need manual correction.

---

## Schema Design Decisions

### Amount sign convention
**Negative = money leaving your possession. Positive = money arriving.**
This is applied consistently across all sources regardless of each source's native convention.
AmEx is the notable inversion — see above.

### `transaction_type` enum
The key field for excluding transactions from spending reports:

| Value | Meaning |
|---|---|
| `expense` | Actual spending (merchant charge, utility payment, etc.) |
| `income` | Money coming in (paycheck, interest) |
| `internal_transfer` | Moving money between your own accounts |
| `cc_payment` | Paying off a credit card from a bank account |
| `refund` | Merchant refund or CC credit |
| `unknown` | Default; needs review |

**Critical for reports:** To avoid double-counting, spending reports should filter to
`transaction_type = 'expense'` only. A credit card charge at a merchant is one `expense`.
The subsequent payment from checking to the CC company is a `cc_payment` — same money,
not additional spending.

### `import_hash` deduplication
SHA-256 of `accountId|date|amount.toFixed(2)|description.trim()`.
Has a `UNIQUE` constraint — inserting a duplicate silently does nothing (`onConflictDoNothing`).
This makes imports fully idempotent: you can re-import any CSV file safely.

### `source_category` vs `category`
- `source_category`: Raw category string from the institution (Capital One, Chase). Read-only,
  never modified. Useful as a seed for auto-categorization rules.
- `category`: The user's own categorization. This is what reports will use. Null until assigned.
  Future work: bulk-assign categories by description pattern matching.

### `cardholder`
Populated only for AmEx rows (only source that provides per-card member data).
Values: "ROLAND G SCOTT", "LISA M SCOTT". Null for all other accounts.

### `posted_date`
Only Capital One and Chase provide a posted date distinct from the transaction date.
Stored when available, null otherwise. Transaction date (`date`) is always present and is
the canonical date used for sorting and filtering.

---

## Import Flow

1. User selects an account from the dropdown on `/import`
2. User selects one or more CSV files
3. Files are read client-side (`file.text()`) and sent via server function `importCSV`
4. Server looks up the account's `institution` and dispatches to the matching importer
5. Each importer parses its CSV, normalizes to `NormalizedTransaction[]`
6. Each row is inserted with `onConflictDoNothing` — duplicates are silently skipped
7. Results (inserted count, skipped count, errors) are returned and displayed

**Each importer is responsible for:**
- Parsing the raw CSV format
- Normalizing dates to `YYYY-MM-DD`
- Normalizing amounts to signed floats (negative = out)
- Calling `inferTransactionType()` and `inferPaymentMethod()` from `utils.ts`
- Computing the `importHash`

**The importer does NOT need to know the account type** — it receives `accountId` and the
`institution` is already known from the account record. However, the Lake Ridge importer
infers `savings` vs `checking` from the filename since both use the same importer function.

---

## What's Built (Phase 1)

- [x] Database schema with Drizzle ORM and migration
- [x] Account seed data (6 accounts)
- [x] All 4 institution importers (AmEx, Capital One, Chase, Lake Ridge)
- [x] Idempotent import via SHA-256 deduplication
- [x] `inferTransactionType()` heuristic (auto-detects income, transfers, CC payments)
- [x] `inferPaymentMethod()` heuristic (credit, ACH, check, cash, transfer, direct deposit)
- [x] Web UI: Dashboard with transaction count by account
- [x] Web UI: Transaction list with filtering (account, type, date range, description search) and pagination
- [x] Web UI: CSV import page

---

## What's Next (Phase 2+)

- [ ] **Category assignment UI** — most important next step. Probably: click a category badge
  inline in the transaction table to assign. Also: bulk-assign by description pattern
  (e.g., "all rows where description contains 'NETFLIX' → 'Subscriptions'").
- [ ] **Spending reports** — monthly spending by category, payment method breakdown,
  year-over-year comparison. Filter to `transaction_type = 'expense'` only.
- [ ] **Merchant normalization** — raw descriptions like "AMZN MKTP US*AB1CD2EF3" should
  map to a clean merchant name "Amazon". A separate `merchants` table with pattern matching.
- [ ] **Transaction detail / edit view** — click a row to see full details, edit category,
  add notes, manually override transaction_type if the heuristic got it wrong.
- [ ] **Recurring transaction detection** — identify subscriptions and regular bills.
- [ ] **Budget targets** — set monthly budget per category, track actual vs target.

---

## Drizzle Migration Workflow

When you change `src/server/db/schema.ts`:

```bash
npx drizzle-kit generate   # generates a new SQL migration file in ./drizzle/
npx drizzle-kit migrate    # applies pending migrations to ./data/spending.db
```

Migration files are in `./drizzle/` and should be committed to version control.
Never edit the database schema directly with `ALTER TABLE` — always go through Drizzle.

---

## File Map

```
src/
├── server/
│   ├── db/
│   │   ├── index.ts           — db connection (better-sqlite3 + drizzle)
│   │   ├── schema.ts          — canonical schema (accounts + transactions tables)
│   │   └── seed-accounts.ts   — seeds the 6 known accounts
│   ├── functions/
│   │   ├── import.ts          — getAccounts(), importCSV() server functions
│   │   └── transactions.ts    — getTransactions(), getTransactionStats() server functions
│   └── importers/
│       ├── types.ts           — NormalizedTransaction, ImporterFn, ImportResult
│       ├── utils.ts           — parseDate, parseAmount, computeImportHash,
│       │                        inferTransactionType, inferPaymentMethod, parseCSV
│       ├── amex.ts
│       ├── capital-one.ts
│       ├── chase.ts
│       ├── lake-ridge.ts
│       └── index.ts           — importer registry (institution string → ImporterFn)
├── routes/
│   ├── __root.tsx             — layout, nav bar
│   ├── index.tsx              — dashboard (stats)
│   ├── transactions.tsx       — transaction list with filters + TanStack Table
│   └── import.tsx             — CSV upload UI
└── router.tsx                 — router setup

data/
└── spending.db                — the SQLite database (source of truth)

drizzle/                       — migration files (committed to version control)
drizzle.config.ts              — Drizzle config (schema path, db path, dialect)
```
