import Anthropic from '@anthropic-ai/sdk'
import { createServerFn } from '@tanstack/react-start'
import { db } from '../db'
import { merchants, merchantPatterns, transactions } from '../db/schema'
import { sql, isNull } from 'drizzle-orm'
import { buildMultiPatternWhere, type PatternInput } from './merchants'
import { CATEGORIES } from '../../shared/categories'

export type AISuggestion = {
  name: string
  patterns: PatternInput[]
  defaultCategory: string
  matchedDescriptions: string[]
  count: number
}

const TOOL_SCHEMA = {
  name: 'suggest_merchants' as const,
  description: 'Submit grouped merchant suggestions based on transaction descriptions',
  input_schema: {
    type: 'object' as const,
    properties: {
      suggestions: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            name: { type: 'string' as const, description: 'Clean, human-readable merchant name' },
            patterns: {
              type: 'array' as const,
              items: {
                type: 'object' as const,
                properties: {
                  pattern: { type: 'string' as const },
                  matchType: { type: 'string' as const, enum: ['contains', 'starts_with', 'exact'] },
                },
                required: ['pattern', 'matchType'],
              },
            },
            defaultCategory: { type: 'string' as const, description: 'Best-fit category' },
            matchedDescriptions: {
              type: 'array' as const,
              items: { type: 'string' as const },
              description: 'Which input descriptions belong to this group',
            },
          },
          required: ['name', 'patterns', 'defaultCategory', 'matchedDescriptions'],
        },
      },
    },
    required: ['suggestions'],
  },
}

const SYSTEM_PROMPT = `You are a financial transaction analyzer. Given a list of bank transaction descriptions (with occurrence counts), group them by the company/merchant they belong to.

For each group:
- name: A clean, human-readable merchant name (e.g., "Amazon", "Kwik Trip", "State Farm")
- patterns: One or more matching rules. Each has a \`pattern\` string and \`matchType\` ("contains", "starts_with", or "exact"). The patterns should be broad enough to catch all variants but specific enough to avoid false positives.
- defaultCategory: Best-fit category from this list: ${CATEGORIES.join(', ')}
- matchedDescriptions: Which descriptions from the input belong to this group

Rules:
- Do NOT suggest merchants that already exist (provided as context below).
- Prefer "starts_with" for prefixes and "contains" for substrings.
- Group descriptions that come from the same company, even if the text varies significantly (e.g., "AMZN MKTP US*123" and "Amazon.com*456" are both Amazon).
- Every description in the input should appear in exactly one group's matchedDescriptions — do not skip any, even if a description only has 1 occurrence.
- Sort suggestions by the total occurrence count (sum of all matched descriptions' counts), highest first.`

/**
 * Use Claude to analyze unassigned transaction descriptions and suggest merchant groupings.
 */
export const suggestMerchantsAI = createServerFn({ method: 'POST' }).handler(async () => {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY environment variable is not set. Add it to your .env file to use AI suggestions.',
    )
  }

  // 1. Gather distinct unassigned descriptions with counts
  const descriptions = db
    .select({
      description: transactions.description,
      count: sql<number>`count(*)`,
    })
    .from(transactions)
    .where(isNull(transactions.merchantId))
    .groupBy(transactions.description)
    .orderBy(sql`count(*) DESC`)
    .all()

  if (descriptions.length === 0) {
    return { suggestions: [] as AISuggestion[] }
  }

  // 2. Gather existing merchants + their patterns (the "memory")
  const existingMerchants = db.select().from(merchants).all()
  const existingPatterns = db.select().from(merchantPatterns).all()

  let memorySection = ''
  if (existingMerchants.length > 0) {
    const lines = existingMerchants.map((m) => {
      const mPatterns = existingPatterns
        .filter((p) => p.merchantId === m.id)
        .map((p) => `"${p.pattern}" (${p.matchType.replace('_', ' ')})`)
        .join(', ')
      const cat = m.defaultCategory ? ` [${m.defaultCategory}]` : ''
      return `- ${m.name}${cat}: ${mPatterns}`
    })
    memorySection = `## Existing Merchants (do NOT re-suggest these)\n${lines.join('\n')}\n\n`
  }

  // 3. Build the descriptions list
  const descriptionLines = descriptions
    .map((d) => `${d.description} (${d.count})`)
    .join('\n')

  const userMessage = `${memorySection}## Unassigned Transaction Descriptions\n${descriptionLines}`

  // 4. Call Claude Sonnet
  const client = new Anthropic({ apiKey })
  let response
  try {
    response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      tools: [TOOL_SCHEMA],
      tool_choice: { type: 'tool', name: 'suggest_merchants' },
      messages: [{ role: 'user', content: userMessage }],
    })
  } catch (err: unknown) {
    if (err instanceof Anthropic.APIError) {
      // Extract the human-readable message from the error body if available
      const body = err.error as { error?: { message?: string } } | undefined
      const detail = body?.error?.message ?? err.message
      throw new Error(`Anthropic API error: ${detail}`)
    }
    throw err
  }

  // 5. Parse tool use response
  const toolUseBlock = response.content.find((block) => block.type === 'tool_use')
  if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
    throw new Error('AI did not return structured suggestions')
  }

  const rawSuggestions = (toolUseBlock.input as { suggestions: Array<{
    name: string
    patterns: Array<{ pattern: string; matchType: string }>
    defaultCategory: string
    matchedDescriptions: string[]
  }> }).suggestions

  // 6. Calculate actual DB match counts for each suggestion
  const suggestions: AISuggestion[] = rawSuggestions.map((s) => {
    const patterns: PatternInput[] = s.patterns.map((p) => ({
      pattern: p.pattern,
      matchType: p.matchType as PatternInput['matchType'],
    }))

    const whereClause = buildMultiPatternWhere(patterns)
    let count = 0
    if (whereClause) {
      const result = db
        .select({ count: sql<number>`count(*)` })
        .from(transactions)
        .where(sql`(${whereClause}) AND merchant_id IS NULL`)
        .get()
      count = result?.count ?? 0
    }

    return {
      name: s.name,
      patterns,
      defaultCategory: s.defaultCategory,
      matchedDescriptions: s.matchedDescriptions,
      count,
    }
  })

  // Sort by count descending
  suggestions.sort((a, b) => b.count - a.count)

  return { suggestions }
})
