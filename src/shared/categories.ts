/**
 * Predefined category list for transaction categorization.
 * The `category` column on transactions is free text, so users
 * can also type custom values — this list provides suggestions.
 */
export const CATEGORIES = [
  'Groceries',
  'Dining',
  'Gas/Automotive',
  'Shopping',
  'Entertainment',
  'Subscriptions',
  'Utilities',
  'Health Care',
  'Insurance',
  'Rent/Mortgage',
  'Travel',
  'Education',
  'Internet/Phone',
  'Personal Care',
  'Home Improvement',
  'Gifts/Donations',
  'Fees/Interest',
  'Other',
] as const

export type Category = (typeof CATEGORIES)[number]
