export type PatternInput = {
  pattern: string
  matchType: 'contains' | 'starts_with' | 'exact'
  defaultCategory?: string | null
  defaultTransactionType?: string | null
  defaultIgnored?: boolean | null
}

/**
 * In-memory pattern matching — JS equivalent of SQL LIKE logic.
 * Case-insensitive to match SQLite's default LIKE behavior.
 */
export function matchesPattern(
  description: string,
  pattern: string,
  matchType: 'contains' | 'starts_with' | 'exact',
): boolean {
  const desc = description.toUpperCase()
  const pat = pattern.toUpperCase()
  switch (matchType) {
    case 'contains':
      return desc.includes(pat)
    case 'starts_with':
      return desc.startsWith(pat)
    case 'exact':
      return desc === pat
  }
}

/**
 * Find the first pattern that matches a description.
 * Returns the full PatternInput (with its defaults) so callers know which pattern matched.
 */
export function findMatchingPattern(
  description: string,
  patterns: PatternInput[],
): PatternInput | null {
  return patterns.find((p) => matchesPattern(description, p.pattern, p.matchType)) ?? null
}

/**
 * Test a description against multiple patterns (OR'd).
 */
export function matchesAnyPattern(
  description: string,
  patterns: PatternInput[],
): boolean {
  return findMatchingPattern(description, patterns) !== null
}
