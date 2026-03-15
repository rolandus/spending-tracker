import Anthropic from '@anthropic-ai/sdk'
import { createServerFn } from '@tanstack/react-start'
import { db } from '../db'
import { merchants, merchantPatterns, transactions } from '../db/schema'
import { sql, isNull, and, lt, notInArray, eq } from 'drizzle-orm'
import { buildMultiPatternWhere, type PatternInput } from './merchants'
import { CATEGORIES } from '../../shared/categories'

function getAICachePath() {
  const path = require('node:path')
  return path.join(process.cwd(), 'ai-suggestions-cache.json')
}

export type AISuggestion = {
  type: 'new' | 'modify'
  name: string
  existingMerchantName?: string
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
            type: {
              type: 'string' as const,
              enum: ['new', 'modify'],
              description:
                'Whether to create a new merchant ("new") or add patterns to an existing one ("modify")',
            },
            name: {
              type: 'string' as const,
              description: 'Clean, human-readable merchant name',
            },
            existingMerchantName: {
              type: 'string' as const,
              description:
                'For type="modify": the exact name of the existing merchant to add patterns to',
            },
            patterns: {
              type: 'array' as const,
              items: {
                type: 'object' as const,
                properties: {
                  pattern: { type: 'string' as const },
                  matchType: {
                    type: 'string' as const,
                    enum: ['contains', 'starts_with', 'exact'],
                  },
                },
                required: ['pattern', 'matchType'],
              },
            },
            defaultCategory: {
              type: 'string' as const,
              description: 'Best-fit category',
            },
            matchedDescriptions: {
              type: 'array' as const,
              items: { type: 'string' as const },
              description: 'Which input descriptions belong to this group',
            },
          },
          required: [
            'type',
            'name',
            'patterns',
            'defaultCategory',
            'matchedDescriptions',
          ],
        },
      },
    },
    required: ['suggestions'],
  },
}

const SYSTEM_PROMPT = `You are a financial transaction analyzer. Given a list of bank transaction descriptions (with occurrence counts), group them by the company/merchant they belong to.

For each group:
- type: "new" to create a new merchant, or "modify" to add patterns to an existing merchant
- name: A clean, human-readable merchant name (e.g., "Amazon", "Kwik Trip", "State Farm")
- existingMerchantName: (only for type="modify") The EXACT name of the existing merchant to modify
- patterns: One or more matching rules. Each has a \`pattern\` string and \`matchType\` ("contains", "starts_with", or "exact"). For "modify" suggestions, include ONLY the new patterns to add — not the merchant's existing patterns.
- defaultCategory: Best-fit category from this list: ${CATEGORIES.join(', ')}
- matchedDescriptions: Which descriptions from the input belong to this group

Rules:
- If a description clearly belongs to an existing merchant but none of its current patterns would match it, use type="modify" with the new pattern(s) needed. Set existingMerchantName to the EXACT name from the existing merchants list.
- For descriptions that don't match any existing merchant, use type="new".
- Prefer "starts_with" for prefixes and "contains" for substrings.
- Group descriptions that come from the same company, even if the text varies significantly (e.g., "AMZN MKTP US*123" and "Amazon.com*456" are both Amazon).
- Every description in the input should appear in exactly one group's matchedDescriptions — do not skip any, even if a description only has 1 occurrence.
- Sort suggestions by the total occurrence count (sum of all matched descriptions' counts), highest first.`

type RawSuggestion = {
  type?: string
  name: string
  existingMerchantName?: string
  patterns: Array<{ pattern: string; matchType: string }>
  defaultCategory: string
  matchedDescriptions: string[]
}

/**
 * Core AI function — reusable by both the standalone merchants page and the import pipeline.
 */
export const callMerchantAI = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: {
      descriptions: { description: string; count: number }[]
      skipCache?: boolean
    }) => data,
  )
  .handler(async ({ data }): Promise<{ suggestions: AISuggestion[]; fromCache: boolean }> => {
    const { descriptions } = data
    const options = { skipCache: data.skipCache };
  // 0. Check cache (unless skipCache is set)
  if (!options?.skipCache) {
    const fs = require('node:fs')
    const cachePath = getAICachePath()
    if (fs.existsSync(cachePath)) {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as {
        suggestions: RawSuggestion[]
      }
      const suggestions = calculateCounts(cached.suggestions)
      return { suggestions, fromCache: true }
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY environment variable is not set. Add it to your .env file to use AI suggestions.',
    )
  }

  if (descriptions.length === 0) {
    return { suggestions: [], fromCache: false }
  }

  // 1. Gather existing merchants + their patterns (the "memory")
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
    memorySection = `## Existing Merchants (do NOT re-suggest these, but you MAY suggest "modify" to add new patterns)\n${lines.join('\n')}\n\n`
  }

  // 2. Build the descriptions list
  const descriptionLines = descriptions
    .map((d) => `${d.description} (${d.count})`)
    .join('\n')

  const userMessage = `${memorySection}## Unassigned Transaction Descriptions\n${descriptionLines}`

  // 3. Call Claude Sonnet
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
      const body = err.error as { error?: { message?: string } } | undefined
      const detail = body?.error?.message ?? err.message
      throw new Error(`Anthropic API error: ${detail}`)
    }
    throw err
  }

  // 4. Parse tool use response
  const toolUseBlock = response.content.find((block) => block.type === 'tool_use')
  if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
    throw new Error('AI did not return structured suggestions')
  }

  const rawSuggestions = (
    toolUseBlock.input as { suggestions: RawSuggestion[] }
  ).suggestions

  // 5. Save raw AI response to cache file (unless skipCache)
  if (!options?.skipCache) {
    const fs = require('node:fs')
    fs.writeFileSync(
      getAICachePath(),
      JSON.stringify({ suggestions: rawSuggestions }, null, 2),
    )
  }

  // 6. Calculate actual DB match counts
  const suggestions = calculateCounts(rawSuggestions)

  return { suggestions, fromCache: false }
})

/**
 * Convert raw AI suggestions to typed AISuggestions with live DB counts.
 */
function calculateCounts(rawSuggestions: RawSuggestion[]): AISuggestion[] {
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
        .where(sql`(${whereClause}) AND merchant_id IS NULL AND ignored = 0`)
        .get()
      count = result?.count ?? 0
    }

    return {
      type: (s.type as 'new' | 'modify') ?? 'new',
      name: s.name,
      existingMerchantName: s.existingMerchantName,
      patterns,
      defaultCategory: s.defaultCategory,
      matchedDescriptions: s.matchedDescriptions,
      count,
    }
  })

  suggestions.sort((a, b) => b.count - a.count)
  return suggestions
}

/**
 * Standalone server function for the merchants page.
 * Uses expense-only filtering and cache.
 */
export const suggestMerchantsAI = createServerFn({ method: 'POST' }).handler(
  async () => {
    // Gather distinct unassigned descriptions with expense-only filters
    const descriptions = db
      .select({
        description: transactions.description,
        count: sql<number>`count(*)`,
      })
      .from(transactions)
      .where(
        and(
          isNull(transactions.merchantId),
          eq(transactions.ignored, 0),
          lt(transactions.amount, 0),
          notInArray(transactions.transactionType, [
            'internal_transfer',
            'cc_payment',
          ]),
        ),
      )
      .groupBy(transactions.description)
      .orderBy(sql`count(*) DESC`)
      .all()

    return callMerchantAI({ data: { descriptions } })
  },
)
