import Anthropic from '@anthropic-ai/sdk'
import { createServerFn } from '@tanstack/react-start'
import { db } from '../db'
import { accounts, merchants, merchantPatterns } from '../db/schema'
import { and, eq } from 'drizzle-orm'
import { type PatternInput } from './merchants'
import { INSTITUTION_DISPLAY_NAMES } from '../../shared/institutions'
import { categories } from '../db/schema'
import { asc } from 'drizzle-orm'

export type AISuggestion = {
  type: 'new' | 'modify'
  name: string
  existingMerchantName?: string
  patterns: PatternInput[]
  matchedDescriptions: string[]
}

export type PendingMerchant = {
  id: number
  name: string
  status: 'pending'
  modifiesMerchantId: number | null
  patterns: PatternInput[]
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
                  defaultCategory: {
                    type: 'string' as const,
                    description: 'Best-fit category for transactions matching this pattern',
                  },
                  defaultTransactionType: {
                    type: 'string' as const,
                    enum: ['expense', 'income', 'refund', 'cc_payment', 'internal_transfer'],
                    description: 'Transaction type for transactions matching this pattern',
                  },
                  defaultIgnored: {
                    type: 'boolean' as const,
                    description:
                      'Set to true for transactions that should be hidden/ignored (credit card payments, internal transfers). These are not real spending.',
                  },
                },
                required: ['pattern', 'matchType', 'defaultCategory', 'defaultTransactionType', 'defaultIgnored'],
              },
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
            'matchedDescriptions',
          ],
        },
      },
    },
    required: ['suggestions'],
  },
}

function buildSystemPrompt(categoryList: string[]): string {
  return `You are a financial transaction analyzer. Given a list of bank transaction descriptions (with occurrence counts), group them by the company/merchant they belong to and assign an appropriate category.

Categories must be assigned as a best fit from this list: ${categoryList.join(', ')}

You must classify every transaction description into one of three types:

## Type 1 — Ignored Transactions (defaultIgnored: true)
These are NOT real spending — they are money moving between the user's own accounts:
- Credit card payments (PAYMENT, AUTOPAY, THANK YOU on credit cards; payments TO credit card companies from checking like "AMERICAN EXPRESS", "CAPITAL ONE", "CHASE CARD")
- Internal transfers (TRANSFER FROM/TO, XFER FROM/TO, ONLINE TRANSFER, FUNDS TRANSFER, balance transfers)
- Use the financial institution's display name as the merchant name
- Set defaultTransactionType to "cc_payment" or "internal_transfer" as appropriate
- Set defaultIgnored to true
- Category should be left undefined, since these are hidden

## Type 2 — Institution Transactions (defaultIgnored: false)
These are real transactions from the bank/institution itself:
- Overdraft/NSF fees, maintenance fees, service charges
- Interest charges / finance charges (credit cards)
- Interest income / dividends (checking/savings)
- Checks written (CHECK #, check payments)
- Direct deposits / payroll
- Use the financial institution's display name as the merchant name
- Set appropriate category (see list of options above)
- Set defaultIgnored to false

## Type 3 — Regular Merchants (defaultIgnored: false)
Everything else — real purchases from businesses:
- Retail, restaurants, subscriptions, utilities, etc.
- Use a clean merchant name (e.g., "Amazon", "Kwik Trip", "State Farm")
- Set appropriate category and transaction type
- Set defaultIgnored to false

For each group:
- type: "new" to create a new merchant, or "modify" to add patterns to an existing merchant
- name: A clean, human-readable merchant name
- existingMerchantName: (only for type="modify") The EXACT name of the existing merchant to modify
- patterns: One or more matching rules. Each has:
  - pattern: the string to match against transaction descriptions
  - matchType: "contains", "starts_with", or "exact"
  - defaultCategory: best fit chosen from list of categories above
  - defaultTransactionType: One of "expense", "income", "refund", "cc_payment", or "internal_transfer"
  - defaultIgnored: true for Type 1 (hidden), false for Types 2 and 3
  For "modify" suggestions, include ONLY the new patterns to add — not the merchant's existing patterns.
- matchedDescriptions: Which descriptions from the input belong to this group

Each pattern can have DIFFERENT properties. For example, one pattern might be ignored while another on the same merchant is not.

Rules:
- If a description clearly belongs to an existing merchant but none of its current patterns would match it, use type="modify" with the new pattern(s) needed. Set existingMerchantName to the EXACT name from the existing merchants list.
- For descriptions that don't match any existing merchant, use type="new".
- Prefer "starts_with" for prefixes and "contains" for substrings.
- Group descriptions that come from the same company, even if the text varies significantly (e.g., "AMZN MKTP US*123" and "Amazon.com*456" are both Amazon).
- Every description in the input should appear in exactly one group's matchedDescriptions — do not skip any, even if a description only has 1 occurrence.
- Sort suggestions by the total occurrence count (sum of all matched descriptions' counts), highest first.`
}

type RawSuggestion = {
  type?: string
  name: string
  existingMerchantName?: string
  patterns: Array<{
    pattern: string
    matchType: string
    defaultCategory?: string
    defaultTransactionType?: string
    defaultIgnored?: boolean
  }>
  matchedDescriptions: string[]
}

// ── Save AI Suggestions as Pending Merchants ─────────────────────────

/**
 * Persist AI suggestions as pending merchants in the database.
 * Deduplicates by name (for "new") or modifiesMerchantId (for "modify").
 */
export function saveSuggestionsAsPending(
  suggestions: AISuggestion[],
): PendingMerchant[] {
  const created: PendingMerchant[] = []

  for (const s of suggestions) {
    const patterns: PatternInput[] = s.patterns.filter((p) => p.pattern.trim())

    if (s.type === 'modify' && s.existingMerchantName) {
      // Look up the target confirmed merchant
      const target = db
        .select()
        .from(merchants)
        .where(
          and(
            eq(merchants.name, s.existingMerchantName),
            eq(merchants.status, 'confirmed'),
          ),
        )
        .get()

      if (!target) continue // Target doesn't exist, skip

      // Check for existing pending modification of this target
      const existing = db
        .select()
        .from(merchants)
        .where(
          and(
            eq(merchants.status, 'pending'),
            eq(merchants.modifiesMerchantId, target.id),
          ),
        )
        .get()

      if (existing) {
        // Already have a pending modification for this target — return existing
        const existingPatterns = db
          .select()
          .from(merchantPatterns)
          .where(eq(merchantPatterns.merchantId, existing.id))
          .all()
        created.push({
          id: existing.id,
          name: existing.name,
          status: 'pending',
          modifiesMerchantId: existing.modifiesMerchantId,
          patterns: existingPatterns.map((p) => ({
            pattern: p.pattern,
            matchType: p.matchType as PatternInput['matchType'],
            defaultCategory: p.defaultCategory ?? null,
            defaultTransactionType: p.defaultTransactionType ?? null,
            defaultIgnored: p.defaultIgnored === 1,
          })),
        })
        continue
      }

      // Create pending modification merchant
      const merchant = db
        .insert(merchants)
        .values({
          name: s.name,
          status: 'pending',
          modifiesMerchantId: target.id,
        })
        .returning()
        .get()

      for (const p of patterns) {
        db.insert(merchantPatterns)
          .values({
            merchantId: merchant.id,
            pattern: p.pattern,
            matchType: p.matchType,
            defaultCategory: p.defaultCategory ?? null,
            defaultTransactionType: p.defaultTransactionType ?? null,
            defaultIgnored: p.defaultIgnored ? 1 : 0,
          })
          .run()
      }

      created.push({
        id: merchant.id,
        name: merchant.name,
        status: 'pending',
        modifiesMerchantId: merchant.modifiesMerchantId,
        patterns,
      })
    } else {
      // "new" type
      // Check for existing pending merchant with same name
      const existing = db
        .select()
        .from(merchants)
        .where(
          and(eq(merchants.name, s.name), eq(merchants.status, 'pending')),
        )
        .get()

      if (existing) {
        // Already have a pending merchant with this name — return existing
        const existingPatterns = db
          .select()
          .from(merchantPatterns)
          .where(eq(merchantPatterns.merchantId, existing.id))
          .all()
        created.push({
          id: existing.id,
          name: existing.name,
          status: 'pending',
          modifiesMerchantId: existing.modifiesMerchantId,
          patterns: existingPatterns.map((p) => ({
            pattern: p.pattern,
            matchType: p.matchType as PatternInput['matchType'],
            defaultCategory: p.defaultCategory ?? null,
            defaultTransactionType: p.defaultTransactionType ?? null,
            defaultIgnored: p.defaultIgnored === 1,
          })),
        })
        continue
      }

      // Create new pending merchant
      const merchant = db
        .insert(merchants)
        .values({
          name: s.name,
          status: 'pending',
          modifiesMerchantId: null,
        })
        .returning()
        .get()

      for (const p of patterns) {
        db.insert(merchantPatterns)
          .values({
            merchantId: merchant.id,
            pattern: p.pattern,
            matchType: p.matchType,
            defaultCategory: p.defaultCategory ?? null,
            defaultTransactionType: p.defaultTransactionType ?? null,
            defaultIgnored: p.defaultIgnored ? 1 : 0,
          })
          .run()
      }

      created.push({
        id: merchant.id,
        name: merchant.name,
        status: 'pending',
        modifiesMerchantId: null,
        patterns,
      })
    }
  }

  return created
}

// ── Core AI Function ─────────────────────────────────────────────────

/**
 * Call Claude to analyze transaction descriptions and suggest merchant groupings.
 * Results are automatically saved as pending merchants in the database.
 */
export const callMerchantAI = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: {
      descriptions: { description: string; count: number }[]
      accountId?: number
    }) => data,
  )
  .handler(async ({ data }): Promise<{ suggestions: AISuggestion[]; pendingMerchants: PendingMerchant[] }> => {
    const { descriptions, accountId } = data

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY environment variable is not set. Add it to your .env file to use AI suggestions.',
      )
    }

    if (descriptions.length === 0) {
      return { suggestions: [], pendingMerchants: [] }
    }

    // 1. Fetch categories from DB for the AI prompt
    const categoryRows = db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name)).all()
    const categoryList = categoryRows.map((c) => c.name)

    // 2. Gather existing merchants + their patterns (the "memory")
    const existingMerchants = db.select().from(merchants).all()
    const existingPatterns = db.select().from(merchantPatterns).all()

    let memorySection = ''
    if (existingMerchants.length > 0) {
      const lines = existingMerchants.map((m) => {
        const mPatterns = existingPatterns
          .filter((p) => p.merchantId === m.id)
          .map((p) => {
            const cat = p.defaultCategory ? ` [${p.defaultCategory}]` : ''
            const type = p.defaultTransactionType ? ` {${p.defaultTransactionType}}` : ''
            const ignored = p.defaultIgnored ? ' (IGNORED)' : ''
            return `"${p.pattern}" (${p.matchType.replace('_', ' ')}${cat}${type}${ignored})`
          })
          .join(', ')
        const statusTag = m.status === 'pending' ? ' (pending)' : ''
        return `- ${m.name}${statusTag}: ${mPatterns}`
      })
      memorySection = `## Existing Merchants (do NOT re-suggest these, but you MAY suggest "modify" to add new patterns)\n${lines.join('\n')}\n\n`
    }

    // 2. Build institution context
    let institutionContext = ''
    if (accountId) {
      const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get()
      if (account) {
        const displayName = INSTITUTION_DISPLAY_NAMES[account.institution] ?? account.institution
        const accountType = account.type.replace('_', ' ')
        institutionContext = `## Account Context\nThis is a ${accountType} account at ${displayName}. Use "${displayName}" as the merchant name for institution-related transactions (Type 1 and Type 2).\n\n`
      }
    }

    // 3. Build the descriptions list
    const descriptionLines = descriptions
      .map((d) => `${d.description} (${d.count})`)
      .join('\n')

    const userMessage = `${memorySection}${institutionContext}## Unassigned Transaction Descriptions\n${descriptionLines}`

    // 4. Call Claude Haiku
    const client = new Anthropic({ apiKey })
    let response
    try {
      response = await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 8192,
        system: buildSystemPrompt(categoryList),
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

    // 5. Parse tool use response
    const toolUseBlock = response.content.find((block) => block.type === 'tool_use')
    if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
      throw new Error('AI did not return structured suggestions')
    }

    const rawSuggestions = (
      toolUseBlock.input as { suggestions: RawSuggestion[] }
    ).suggestions

    // 6. Convert to typed suggestions (per-pattern defaults)
    const suggestions: AISuggestion[] = rawSuggestions.map((s) => ({
      type: (s.type as 'new' | 'modify') ?? 'new',
      name: s.name,
      existingMerchantName: s.existingMerchantName,
      patterns: s.patterns.map((p) => ({
        pattern: p.pattern,
        matchType: p.matchType as PatternInput['matchType'],
        defaultCategory: p.defaultCategory ?? null,
        defaultTransactionType: p.defaultTransactionType ?? null,
        defaultIgnored: p.defaultIgnored ?? false,
      })),
      matchedDescriptions: s.matchedDescriptions,
    }))

    // 7. Save as pending merchants in the database
    const pendingMerchants = saveSuggestionsAsPending(suggestions)

    return { suggestions, pendingMerchants }
  })
