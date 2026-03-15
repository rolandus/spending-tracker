export type PatternInput = { pattern: string; matchType: 'contains' | 'starts_with' | 'exact' }

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
 * Test a description against multiple patterns (OR'd).
 */
export function matchesAnyPattern(
  description: string,
  patterns: PatternInput[],
): boolean {
  return patterns.some((p) => matchesPattern(description, p.pattern, p.matchType))
}
