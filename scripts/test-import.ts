import { readFileSync, readdirSync } from 'fs'
import { resolve } from 'path'
import { db } from '../src/server/db'
import { accounts, transactions } from '../src/server/db/schema'
import { eq } from 'drizzle-orm'
import { getImporter } from '../src/server/importers'

const STATEMENTS_DIR = resolve(process.env.HOME!, 'Documents/Statements')

// Map filenames to account names for auto-detection
function detectAccount(fileName: string): { institution: string; accountName: string } | null {
  const lower = fileName.toLowerCase()
  if (lower.startsWith('american-express') || lower.startsWith('amex')) {
    return { institution: 'amex', accountName: 'American Express' }
  }
  if (lower.startsWith('capital-one')) {
    return { institution: 'capital_one', accountName: 'Capital One' }
  }
  if (lower.startsWith('chase')) {
    return { institution: 'chase', accountName: 'Chase' }
  }
  if (lower.includes('checking')) {
    return { institution: 'lake_ridge', accountName: 'Lake Ridge Checking' }
  }
  if (lower.includes('savings')) {
    return { institution: 'lake_ridge', accountName: 'Lake Ridge Savings' }
  }
  if (lower.includes('spending')) {
    return { institution: 'lake_ridge', accountName: 'Lake Ridge Spending' }
  }
  return null
}

const allAccounts = db.select().from(accounts).all()
const files = readdirSync(STATEMENTS_DIR).filter((f) => f.endsWith('.csv'))

console.log(`Found ${files.length} CSV files\n`)

let totalInserted = 0
let totalSkipped = 0
let totalErrors = 0

for (const fileName of files) {
  const detected = detectAccount(fileName)
  if (!detected) {
    console.log(`⚠ Skipping ${fileName}: cannot detect account`)
    continue
  }

  const account = allAccounts.find((a) => a.name === detected.accountName)
  if (!account) {
    console.log(`⚠ Skipping ${fileName}: account "${detected.accountName}" not found in DB`)
    continue
  }

  const filePath = resolve(STATEMENTS_DIR, fileName)
  const csvContent = readFileSync(filePath, 'utf-8')

  const importer = getImporter(detected.institution)

  let parsed
  try {
    parsed = importer(csvContent, account.id, fileName)
  } catch (err) {
    console.log(`✗ ${fileName}: parse error: ${err instanceof Error ? err.message : err}`)
    totalErrors++
    continue
  }

  let inserted = 0
  let skipped = 0
  const errors: string[] = []

  for (const txn of parsed) {
    try {
      const result = db
        .insert(transactions)
        .values(txn)
        .onConflictDoNothing({ target: transactions.importHash })
        .run()

      if (result.changes > 0) {
        inserted++
      } else {
        skipped++
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }

  totalInserted += inserted
  totalSkipped += skipped
  totalErrors += errors.length

  const status = errors.length > 0 ? '⚠' : '✓'
  console.log(
    `${status} ${fileName}: ${inserted} inserted, ${skipped} skipped${errors.length > 0 ? `, ${errors.length} errors` : ''}`,
  )
  if (errors.length > 0) {
    errors.slice(0, 3).forEach((e) => console.log(`    ${e}`))
  }
}

console.log(`\n=== Summary ===`)
console.log(`Inserted: ${totalInserted}`)
console.log(`Skipped:  ${totalSkipped}`)
console.log(`Errors:   ${totalErrors}`)
