import Database from 'better-sqlite3'
import { resolve } from 'path'

const DB_PATH = resolve(process.cwd(), 'data', 'spending.db')
const sqlite = new Database(DB_PATH)

sqlite.pragma('foreign_keys = OFF')

// Delete in dependency order (children before parents)
const tables = [
  'merchant_patterns',
  'category_rules',
  'transactions',
  'merchants',
  'accounts',
]

for (const table of tables) {
  sqlite.exec(`DELETE FROM "${table}"`)
  console.log(`  Cleared ${table}`)
}

sqlite.pragma('foreign_keys = ON')
console.log('\nDatabase reset complete. All tables are empty.')
