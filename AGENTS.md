# AGENTS.md

Agent-oriented notes for this codebase. Only non-obvious things that cannot be discovered by reading the code are recorded here.

---

## Testing Requirement

Any code that affects data correctness must be covered by automated tests. This is non-negotiable and includes:

- **Import logic** — CSV parsing, amount normalization, date parsing, hash computation, deduplication
- **Business logic** — `inferTransactionType()`, `inferPaymentMethod()`, amount sign conventions
- **Data migrations** — every Drizzle migration must have a test that applies it to a known state and verifies the result
- **Report queries** — any query used in spending reports must be tested against fixture data to verify correct filtering, grouping, and aggregation
- **Categorization rules** — pattern-matching logic for bulk category assignment

The consequence of untested logic here is silently wrong financial data. Do not ship changes to any of the above without tests.

---

## Non-Obvious Behaviors

### AmEx amount sign is inverted at source
AmEx CSVs use positive = charge, negative = refund. The importer negates raw values so the stored amount follows our convention (negative = money out). This is the only institution with an inverted sign. Tests for the AmEx importer must assert this inversion explicitly.

### `transaction_type = 'expense'` is the spending filter
Reports must filter to `expense` only to avoid double-counting. A credit card charge is `expense`; the subsequent bank payment to the CC company is `cc_payment`. Both exist in the database. Summing without this filter produces nonsense.

### Import is idempotent by design
`import_hash` has a `UNIQUE` constraint. Re-importing a CSV file is always safe — duplicates are silently skipped via `onConflictDoNothing`. Do not add logic that breaks this guarantee.
