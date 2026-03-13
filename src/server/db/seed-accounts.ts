import { db } from './index'
import { accounts } from './schema'

const seedAccounts = [
  {
    name: 'American Express',
    institution: 'amex' as const,
    type: 'credit_card' as const,
  },
  {
    name: 'Capital One',
    institution: 'capital_one' as const,
    type: 'credit_card' as const,
  },
  {
    name: 'Chase',
    institution: 'chase' as const,
    type: 'credit_card' as const,
  },
  {
    name: 'Lake Ridge Checking',
    institution: 'lake_ridge' as const,
    type: 'checking' as const,
  },
  {
    name: 'Lake Ridge Savings',
    institution: 'lake_ridge' as const,
    type: 'savings' as const,
  },
  {
    name: 'Lake Ridge Spending',
    institution: 'lake_ridge' as const,
    type: 'checking' as const,
  },
]

export function seedAccountsIfEmpty() {
  const existing = db.select().from(accounts).all()
  if (existing.length > 0) {
    console.log(`Accounts table already has ${existing.length} rows, skipping seed.`)
    return
  }

  for (const account of seedAccounts) {
    db.insert(accounts).values(account).run()
  }
  console.log(`Seeded ${seedAccounts.length} accounts.`)
}
